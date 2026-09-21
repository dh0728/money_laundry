"""Explicit deterministic test peer, never an actual trained inference model."""
import io
import threading
import time
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq

from worker_transport import (ProtocolError, StoreUnavailable, Timing, decode, encode,
                              descriptor, immutable, read_files, table, tx_ids)


class DummyPeer:
    def __init__(self, store, *, monotonic=time.monotonic, timing=Timing()):
        self.store, self.clock, self.timing = store, monotonic, timing
        self.executions = 0

    def run(self, request, processing=None):
        if request.run_id is not None:
            raise ProtocolError("Legacy dummy peer does not implement v2 cancellation")
        # Conditional initial status prevents repeated claims. Crash recovery is not
        # implemented; this demo does not claim distributed exactly-once inference.
        existing = self.store.get(request.output + "result.json")
        if existing is not None:
            result = decode(existing)
            request.check(result)
            return result
        raw = self.store.get(request.manifest)
        if raw is None:
            return None
        manifest = decode(raw)
        request.check(manifest)
        existing = self.store.get(request.output + "status.json")
        if existing is not None:
            state = decode(existing)
            request.check(state, versions=False)
            return state
        try:
            if request.model_version != "dummy-v1" or request.feature_version != "dummy-input-v1":
                raise ProtocolError("Dummy peer supports only explicit dummy versions")
            inputs = read_files(self.store, manifest.get("files"), request.inputs)
            if "targets" not in inputs:
                raise ProtocolError("Dummy peer requires targets input")
            targets = table(inputs["targets"])
            ids = tx_ids(targets)
            if type(manifest.get("target_row_count")) is not int or len(ids) != manifest["target_row_count"]:
                raise ProtocolError("Dummy target count mismatch")
        except (ProtocolError, StoreUnavailable) as error:
            state = dict(request.identity(), status="FAILED", revision=1,
                         updated_at=datetime.now(timezone.utc).isoformat(),
                         error=dict(code="INPUT_INVALID" if isinstance(error, ProtocolError) else "S3_UNAVAILABLE",
                                    retryable=isinstance(error, StoreUnavailable), message="Dummy input validation failed"))
            if not self.store.put(request.output + "status.json", encode(state), absent=True):
                state = decode(self.store.get(request.output + "status.json"))
                request.check(state, versions=False)
            return state
        started = datetime.now(timezone.utc).isoformat()
        state = dict(request.identity(), status="RUNNING", revision=1,
                     started_at=started, updated_at=started)
        if not self.store.put(request.output + "status.json", encode(state), absent=True):
            existing = decode(self.store.get(request.output + "status.json"))
            request.check(existing, versions=False)
            return existing
        self.executions += 1
        last_heartbeat = self.clock()
        stop, lock = threading.Event(), threading.Lock()

        def heartbeat():
            nonlocal last_heartbeat
            with lock:
                now = self.clock()
                if not stop.is_set() and now - last_heartbeat >= self.timing.heartbeat:
                    state.update(revision=state["revision"] + 1,
                                 updated_at=datetime.now(timezone.utc).isoformat())
                    self.store.put(request.output + "status.json", encode(state))
                    last_heartbeat = now

        def pulse():
            while not stop.wait(self.timing.heartbeat):
                try:
                    heartbeat()
                except StoreUnavailable:
                    # Completion still verifies its own writes; observers classify read outages.
                    pass

        thread = threading.Thread(target=pulse, name="dummy-inference-heartbeat")
        thread.start()
        try:
            if processing is not None:
                processing(heartbeat)
            values = {"tx_id": pa.array(sorted(ids), type=pa.int64())}
            if request.model_kind == "binary":
                values["p_laundering"] = pa.array([0.75] * len(ids), type=pa.float64())
            else:
                values.update({f"p_{code}": pa.array([0.2 if code == 0 else 0.1] * len(ids), type=pa.float64())
                               for code in range(9)})
            output = io.BytesIO()
            pq.write_table(pa.table(values), output)
            data = output.getvalue()
            key = request.output + "scores.parquet"
            immutable(self.store, key, data)
            stop.set()
            thread.join()
            result = dict(request.identity(), **request.versions(), status="COMPLETED", row_count=len(ids),
                          files=[descriptor("scores", self.store.object_key(key), data)], started_at=started,
                          finished_at=datetime.now(timezone.utc).isoformat())
            immutable(self.store, request.output + "result.json", encode(result))
            return result
        except Exception as error:
            stop.set()
            thread.join()
            state.update(status="FAILED", revision=state["revision"] + 1,
                         updated_at=datetime.now(timezone.utc).isoformat(),
                         error=dict(code="S3_UNAVAILABLE" if isinstance(error, StoreUnavailable) else "DUMMY_EXECUTION_FAILED",
                                    retryable=isinstance(error, StoreUnavailable), message="Dummy peer processing failed"))
            self.store.put(request.output + "status.json", encode(state))
            return state
        finally:
            stop.set()
            thread.join()


def main():
    import argparse
    from worker_transport import LocalStore, Request
    parser = argparse.ArgumentParser(description="Explicit local dummy peer; no actual model")
    parser.add_argument("--store-root", required=True)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    store = LocalStore(args.store_root, args.prefix)
    try:
        raw = store.get(args.manifest)
        if raw is None:
            raise ProtocolError("Manifest missing")
        manifest = decode(raw)
        request = Request(**{key: manifest[key] for key in ("job_id", "model_kind", "request_id", "execution_round", "model_version", "feature_version")})
        if args.manifest != request.manifest:
            raise ProtocolError("Manifest identity path mismatch")
        peer = DummyPeer(store)
        result = peer.run(request)
        print(encode(dict(status=result["status"], executions=peer.executions)).decode())
        return 0 if result["status"] == "COMPLETED" else 1
    except (ProtocolError, StoreUnavailable, KeyError):
        print('{"status":"FAILED","code":"DUMMY_PROTOCOL_ERROR"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
