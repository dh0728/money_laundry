"""Durable single-node inference lifecycle and completion outbox."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
from uuid import uuid4

import httpx

from inference_compute import atomic_json
from worker_transport import encode


class Conflict(ValueError):
    pass


class NotFound(LookupError):
    pass


IDENTITY = ("contract_version", "job_id", "run_id", "model_kind", "request_id", "execution_round")


def identity(payload):
    return {key: payload[key] for key in IDENTITY}


def fingerprint(payload):
    return encode({key: payload[key] for key in (*IDENTITY, "model_version", "feature_version", "manifest_sha256")}).decode()


@dataclass(frozen=True)
class Settings:
    directory: Path
    token: str
    object_base_url: str
    callback_url: str | None = None
    callback_token: str | None = None
    max_input_bytes: int = 256 * 1024 * 1024
    allow_loopback: bool = False


class InferenceService:
    def __init__(self, settings):
        self.settings = settings
        self.root = settings.directory.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.mutex = threading.RLock()
        self.stop = threading.Event()
        self.process = None
        self.active = None
        self.engine = self.notifier = None
        self.lease = None
        self.db = None

    def start(self):
        self.lease = (self.root / "worker.lock").open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.lease.seek(0)
                if self.lease.read(1) == b"":
                    self.lease.write(b"0")
                    self.lease.flush()
                self.lease.seek(0)
                msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.db = sqlite3.connect(self.root / "state.sqlite3", check_same_thread=False)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("""CREATE TABLE IF NOT EXISTS requests (
                request_id TEXT NOT NULL, round INTEGER NOT NULL, identity TEXT NOT NULL,
                fingerprint TEXT, payload TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL,
                cancel TEXT, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                retry_at REAL NOT NULL DEFAULT 0, event TEXT, notified INTEGER NOT NULL DEFAULT 0,
                notify_attempts INTEGER NOT NULL DEFAULT 0, notify_at REAL NOT NULL DEFAULT 0,
                PRIMARY KEY(request_id,round))""")
            # Do not assume an orphaned model process has stopped after a server crash.
            for row in self.db.execute("SELECT * FROM requests WHERE status IN ('RUNNING','CANCEL_REQUESTED')").fetchall():
                self._finish((row["request_id"], row["round"]), "FAILED", error="RECOVERY_REQUIRED")
            self.db.commit()
            self.engine = threading.Thread(target=self._run, name="inference-execution")
            self.notifier = threading.Thread(target=self._notify, name="inference-outbox")
            self.engine.start()
            self.notifier.start()
        except Exception:
            if self.db is not None:
                self.db.close()
            self.lease.close()
            raise

    def _row(self, key):
        row = self.db.execute("SELECT * FROM requests WHERE request_id=? AND round=?", key).fetchone()
        if row is None:
            raise NotFound()
        return row

    def _view(self, row):
        view = dict(json.loads(row["identity"]), status=row["status"], revision=row["revision"],
                    error_code=row["error"], notification_delivered=bool(row["notified"]))
        if row["result"]:
            view["result"] = json.loads(row["result"])
        if row["cancel"]:
            view["cancel_id"] = json.loads(row["cancel"])["cancel_id"]
            if row["status"] == "STOPPED":
                view["cancellation_status"] = "STOPPED"
            elif row["status"] == "COMPLETED":
                view["cancellation_status"] = "ALREADY_FINISHED"
        return view

    def get(self, key):
        with self.mutex:
            return self._view(self._row(key))

    def _lineage(self, payload, starting=False):
        rows = self.db.execute("SELECT * FROM requests WHERE request_id=? ORDER BY round DESC",
                               (payload["request_id"],)).fetchall()
        for row in rows:
            previous = json.loads(row["identity"])
            if any(previous[key] != payload[key] for key in IDENTITY if key != "execution_round"):
                raise Conflict()
        if starting and rows:
            if payload["execution_round"] <= rows[0]["round"]:
                raise Conflict()
            if any(row["status"] not in ("STOPPED", "COMPLETED", "FAILED")
                   or row["error"] == "RECOVERY_REQUIRED" for row in rows):
                raise Conflict()
            for row in rows:
                if row["payload"]:
                    previous = json.loads(row["payload"])
                    if any(previous[key] != payload[key] for key in ("model_version", "feature_version")):
                        raise Conflict()

    def submit(self, payload):
        key = (payload["request_id"], payload["execution_round"])
        ident, immutable = encode(identity(payload)).decode(), fingerprint(payload)
        with self.mutex, self.db:
            self._lineage(payload)
            try:
                row = self._row(key)
            except NotFound:
                self._lineage(payload, starting=True)
                self.db.execute("""INSERT INTO requests(request_id,round,identity,fingerprint,payload,status,revision)
                    VALUES(?,?,?,?,?,'ACCEPTED',1)""", (*key, ident, immutable, json.dumps(payload)))
                return self._view(self._row(key)), True
            if row["identity"] != ident or (row["fingerprint"] and row["fingerprint"] != immutable):
                raise Conflict()
            # A pre-arrival cancellation remains terminal. URLs may refresh without restarting a model.
            if row["status"] in ("ACCEPTED", "RUNNING", "RETRY_WAIT"):
                self.db.execute("UPDATE requests SET payload=? WHERE request_id=? AND round=?",
                                (json.dumps(payload), *key))
            return self._view(self._row(key)), False

    def cancel(self, payload):
        key = (payload["request_id"], payload["execution_round"])
        ident, cancellation = encode(identity(payload)).decode(), encode(payload).decode()
        with self.mutex, self.db:
            self._lineage(payload)
            try:
                row = self._row(key)
            except NotFound:
                self.db.execute("""INSERT INTO requests(request_id,round,identity,status,revision,cancel)
                    VALUES(?,?,?,'STOPPED',0,?)""", (*key, ident, cancellation))
                self._finish(key, "STOPPED")
                return self._view(self._row(key))
            if row["identity"] != ident or (row["cancel"] and row["cancel"] != cancellation):
                raise Conflict()
            self.db.execute("UPDATE requests SET cancel=? WHERE request_id=? AND round=?", (cancellation, *key))
            if row["status"] in ("ACCEPTED", "RETRY_WAIT"):
                self._finish(key, "STOPPED")
            elif row["status"] == "RUNNING":
                self.db.execute("UPDATE requests SET status='CANCEL_REQUESTED',revision=revision+1 WHERE request_id=? AND round=?", key)
            elif row["status"] == "FAILED" and row["error"] != "RECOVERY_REQUIRED":
                self._finish(key, "STOPPED")
            return self._view(self._row(key))

    def _finish(self, key, status, result=None, error=None):
        row = self._row(key)
        event = dict(json.loads(row["identity"]), event_id=str(uuid4()),
                     status=status, revision=row["revision"] + 1, error_code=error)
        if result:
            event["result"] = result
        if row["cancel"]:
            event["cancel_id"] = json.loads(row["cancel"])["cancel_id"]
        self.db.execute("""UPDATE requests SET status=?,revision=revision+1,result=?,error=?,event=?,
            notified=0,notify_attempts=0,notify_at=0 WHERE request_id=? AND round=?""",
                        (status, json.dumps(result) if result else None, error, json.dumps(event), *key))

    def _run(self):
        while not self.stop.wait(0.1):
            with self.mutex:
                if self.process is not None:
                    row = self._row(self.active)
                    if row["status"] == "CANCEL_REQUESTED":
                        self.process.terminate()
                        self.process.wait(timeout=5)
                        with self.db:
                            self._finish(self.active, "STOPPED")
                        self.process = self.active = None
                    elif self.process.poll() is not None:
                        directory = self.root / self.active[0] / str(self.active[1])
                        try:
                            outcome = json.loads((directory / "outcome.json").read_text(encoding="utf-8"))
                        except (OSError, ValueError):
                            outcome = dict(status="FAILED", error_code="MODEL_PROCESS_FAILED", retryable=False)
                        with self.db:
                            if outcome["status"] == "COMPLETED":
                                self._finish(self.active, "COMPLETED", result=outcome["result"])
                            elif outcome.get("retryable") and row["attempts"] < 3:
                                self.db.execute("""UPDATE requests SET status='RETRY_WAIT',revision=revision+1,
                                    error=?,retry_at=? WHERE request_id=? AND round=?""",
                                    (outcome["error_code"], time.time() + (30 if row["attempts"] == 1 else 120), *self.active))
                            else:
                                self._finish(self.active, "FAILED", error=outcome["error_code"])
                        self.process = self.active = None
                if self.process is None:
                    row = self.db.execute("""SELECT * FROM requests WHERE status='ACCEPTED'
                        OR (status='RETRY_WAIT' AND retry_at<=?) ORDER BY rowid LIMIT 1""", (time.time(),)).fetchone()
                    if row is not None:
                        key = (row["request_id"], row["round"])
                        directory = self.root / key[0] / str(key[1])
                        try:
                            directory.mkdir(parents=True, exist_ok=True)
                            (directory / "outcome.json").unlink(missing_ok=True)
                            payload = json.loads(row["payload"])
                            payload.update(object_base_url=self.settings.object_base_url,
                                           max_input_bytes=self.settings.max_input_bytes)
                            atomic_json(directory / "request.json", payload)
                            with self.db:
                                self.db.execute("UPDATE requests SET status='RUNNING',revision=revision+1,attempts=attempts+1 WHERE request_id=? AND round=?", key)
                            self.process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("inference_compute.py")), str(directory)],
                                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            self.active = key
                        except OSError:
                            with self.db:
                                self._finish(key, "FAILED", error="MODEL_PROCESS_UNAVAILABLE")

    def _notify(self):
        while not self.stop.wait(0.2):
            if not self.settings.callback_url:
                continue
            with self.mutex:
                row = self.db.execute("""SELECT * FROM requests WHERE event IS NOT NULL AND notified=0
                    AND notify_attempts<3 AND notify_at<=? ORDER BY rowid LIMIT 1""", (time.time(),)).fetchone()
                if row is None:
                    continue
                event = row["event"]
            delivered = False
            try:
                with httpx.Client(timeout=5, follow_redirects=False, trust_env=False) as client:
                    response = client.post(self.settings.callback_url, content=event,
                                           headers={"Authorization": "Bearer " + self.settings.callback_token,
                                                    "Content-Type": "application/json"})
                    delivered = response.status_code in (200, 202)
            except httpx.HTTPError:
                pass
            with self.mutex, self.db:
                self.db.execute("""UPDATE requests SET notified=?,notify_attempts=notify_attempts+1,notify_at=?
                    WHERE request_id=? AND round=? AND event=?""",
                    (int(delivered), time.time() + (30 if row["notify_attempts"] == 0 else 120),
                     row["request_id"], row["round"], event))

    def close(self):
        self.stop.set()
        if self.engine:
            self.engine.join(timeout=10)
        if self.notifier:
            self.notifier.join(timeout=10)
        with self.mutex:
            if self.process is not None:
                self.process.terminate()
                self.process.wait(timeout=5)
                with self.db:
                    self._finish(self.active, "STOPPED" if self._row(self.active)["cancel"] else "FAILED",
                                 error=None if self._row(self.active)["cancel"] else "WORKER_SHUTDOWN")
            self.db.close()
            self.lease.close()
