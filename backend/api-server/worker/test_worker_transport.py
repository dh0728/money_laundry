import tempfile
import unittest
import dataclasses
import io
import threading
from uuid import uuid4
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from worker_transport import (LocalStore, S3Store, Request, publish, Observer, ProtocolError,
                              StoreUnavailable, Timing, encode, decode, descriptor)
from dummy_inference_peer import DummyPeer


class TransportTests(unittest.TestCase):
    def test_variable_bundle_roundtrip_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "input.parquet"
            pq.write_table(pa.table({"tx_id": pa.array([11, 22], type=pa.int64())}), target)
            other = root / "extra.bin"
            other.write_bytes(b"arbitrary model input")
            store = LocalStore(root / "objects", "dev")
            for kind in ("binary", "type"):
                request = Request(1, kind)
                publish(store, request, root, [{"name": "targets", "relative_path": "input.parquet"}, {"name": "extra", "relative_path": "extra.bin"}], 2)
                peer = DummyPeer(store)
                peer.run(request)
                peer.run(request)
                self.assertEqual(1, peer.executions)
                result = Observer(store, request, {11, 22}).poll()
                self.assertEqual("COMPLETED", result["status"])


class Clock:
    def __init__(self):
        self.now = 0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.store = LocalStore(self.root / "objects", "dev/")
        self.request = Request(9, "binary")
        self.files = [{"name": "targets", "relative_path": "targets.parquet"}]
        pq.write_table(pa.table({"tx_id": pa.array([1, 2], type=pa.int64())}), self.root / "targets.parquet")
        self.clock = Clock()

    def publish(self, request=None, files=None):
        return publish(self.store, request or self.request, self.root, files or self.files, 2)

    def status(self, revision, **changes):
        state = dict(self.request.identity(), status="RUNNING", revision=revision,
                     started_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-01T00:00:00+00:00")
        state.update(changes)
        self.store.put(self.request.output + "status.json", encode(state))

    def observer(self):
        return Observer(self.store, self.request, {1, 2}, monotonic=self.clock)

    def test_manifest_published_last_and_input_bundle_immutable_across_rounds(self):
        writes = []
        original = self.store.put
        def record(key, data, **kwargs):
            writes.append(key)
            return original(key, data, **kwargs)
        self.store.put = record
        self.publish()
        self.assertEqual(self.request.manifest, writes[-1])
        before = self.store.get(self.request.manifest)
        self.publish()
        self.assertEqual(before, self.store.get(self.request.manifest))
        second = dataclasses.replace(self.request, execution_round=2)
        self.publish(second)
        (self.root / "extra").write_bytes(b"extra")
        with self.assertRaises(ProtocolError):
            self.publish(dataclasses.replace(self.request, execution_round=3), self.files + [{"name": "new", "relative_path": "extra"}])

    def test_different_immutable_bytes_rejected(self):
        self.publish()
        (self.root / "targets.parquet").write_bytes(b"changed")
        with self.assertRaises(ProtocolError):
            self.publish()

    def test_escape_and_duplicate_file_names_and_paths_rejected(self):
        for path in ("../escape", "/absolute", "C:/windows", "C:relative", "a\\b", "a/../b"):
            with self.subTest(path=path), self.assertRaises(ProtocolError):
                self.publish(files=[{"name": "x", "relative_path": path}])
        for files in (self.files * 2, self.files + [{"name": "different", "relative_path": "targets.parquet"}]):
            with self.assertRaises(ProtocolError):
                self.publish(files=files)
        with self.assertRaises(ProtocolError):
            self.store.get("../escape")

    def test_checksum_failure_is_terminal_peer_response_not_silence(self):
        self.publish()
        self.store.put(self.request.inputs + "targets.parquet", b"bad")
        peer = DummyPeer(self.store)
        self.assertEqual("FAILED", peer.run(self.request)["status"])
        self.assertEqual("INPUT_INVALID", self.observer().poll()["code"])
        peer.run(self.request)
        self.assertEqual(0, peer.executions)

    def test_no_response_three_observations_and_no_automatic_restart(self):
        observer = self.observer()
        self.assertEqual("WAITING", observer.poll()["status"])
        for elapsed, count in ((300, 1), (329, 1), (330, 2), (449, 2), (450, 3)):
            self.clock.now = elapsed
            self.assertEqual(count, observer.poll()["consecutive_failures"])
        self.publish()
        DummyPeer(self.store).run(self.request)
        self.assertEqual("ACTION_REQUIRED", observer.poll()["status"])

    def test_same_and_older_revisions_do_not_reset_timeout(self):
        observer = self.observer()
        self.status(2)
        observer.poll()
        self.clock.advance(100)
        observer.poll()
        self.status(1)
        self.clock.advance(20)
        self.assertEqual(1, observer.poll()["consecutive_failures"])
        self.status(3)
        self.assertEqual("RUNNING", observer.poll()["status"])
        self.clock.advance(120)
        self.assertEqual(1, observer.poll()["consecutive_failures"])

    def test_new_heartbeat_keeps_long_computation_alive_without_global_deadline(self):
        observer = self.observer()
        for revision in range(1, 241):
            self.status(revision)
            self.clock.advance(30)
            self.assertEqual("RUNNING", observer.poll()["status"])
        self.assertIsNone(observer.terminal)

    def test_result_first_and_result_over_failed_status(self):
        self.publish()
        DummyPeer(self.store).run(self.request)
        self.status(99, status="FAILED", error={"code": "OLD", "retryable": False, "message": "old"})
        self.assertEqual("COMPLETED", self.observer().poll()["status"])

    def test_result_during_no_response_recheck_recovers(self):
        observer = self.observer()
        self.clock.advance(300)
        self.assertEqual(1, observer.poll()["consecutive_failures"])
        self.publish()
        DummyPeer(self.store).run(self.request)
        self.assertEqual("COMPLETED", observer.poll()["status"])

    def test_storage_errors_are_distinct_and_count_at_30_120_seconds(self):
        observer = self.observer()
        original = self.store.get
        def fail(key):
            raise StoreUnavailable("fixture")
        self.store.get = fail
        for elapsed, count in ((0, 1), (29, 1), (30, 2), (149, 2), (150, 3)):
            self.clock.now = elapsed
            result = observer.poll()
            self.assertEqual("S3_UNAVAILABLE", result["code"])
            self.assertEqual(count, result["consecutive_failures"])
        self.store.get = original
        self.assertEqual("ACTION_REQUIRED", observer.poll()["status"])

    def test_storage_recovery_keeps_original_remote_silence_timer(self):
        observer = self.observer()
        self.status(1)
        observer.poll()
        original = self.store.get
        self.store.get = lambda key: (_ for _ in ()).throw(StoreUnavailable("fixture"))
        self.clock.advance(100)
        self.assertEqual("S3_UNAVAILABLE", observer.poll()["code"])
        self.store.get = original
        self.clock.advance(20)
        self.assertEqual("INFERENCE_UNRESPONSIVE", observer.poll()["code"])

    def test_old_round_or_wrong_versions_are_rejected(self):
        self.publish()
        result = DummyPeer(self.store).run(self.request)
        for field, value in (("execution_round", 2), ("request_id", str(__import__("uuid").uuid4())), ("model_version", "other"), ("feature_version", "other")):
            modified = dict(result, **{field: value})
            self.store.put(self.request.output + "result.json", encode(modified))
            with self.subTest(field=field), self.assertRaises(ProtocolError):
                self.observer().poll()

    def test_bad_scores_target_ids_types_and_probabilities_are_rejected(self):
        self.publish()
        original = DummyPeer(self.store).run(self.request)
        for ids, probabilities, dtype in (([1, 1], [0.5, 0.5], pa.float64()), ([1, 3], [0.5, 0.5], pa.float64()), ([1, 2], [float("nan"), 0.5], pa.float64()), ([1, 2], [1.01, 0.5], pa.float64()), ([1, 2], [0.5, 0.5], pa.float32())):
            data = io.BytesIO()
            pq.write_table(pa.table({"tx_id": pa.array(ids, type=pa.int64()), "p_laundering": pa.array(probabilities, type=dtype)}), data)
            key = self.request.output + "scores.parquet"
            self.store.put(key, data.getvalue())
            result = dict(original, files=[descriptor("scores", self.store.object_key(key), data.getvalue())])
            self.store.put(self.request.output + "result.json", encode(result))
            with self.assertRaises(ProtocolError):
                self.observer().poll()

    def test_result_hash_and_missing_file_rejected(self):
        self.publish()
        result = DummyPeer(self.store).run(self.request)
        result["files"][0]["sha256"] = "0" * 64
        self.store.put(self.request.output + "result.json", encode(result))
        with self.assertRaises(ProtocolError):
            self.observer().poll()
        result["files"][0]["key"] = self.store.object_key(self.request.output + "missing.parquet")
        self.store.put(self.request.output + "result.json", encode(result))
        with self.assertRaises(ProtocolError):
            self.observer().poll()

    def test_remote_retry_wait_progress_and_configurable_rechecks(self):
        observer = Observer(self.store, self.request, {1, 2}, monotonic=self.clock,
                            timing=Timing(retry_first=3, retry_second=7))
        self.status(1, status="RETRY_WAIT", next_retry_at="2026-01-01T00:01:00+00:00")
        result = observer.poll()
        self.assertEqual("RETRY_WAIT", result["status"])
        self.assertEqual("2026-01-01T00:01:00+00:00", result["next_retry_at"])
        self.clock.advance(10)
        self.status(1, status="RETRY_WAIT", next_retry_at="2026-01-01T00:02:00+00:00")
        self.assertEqual(result, observer.poll())
        self.clock.advance(110)
        self.assertEqual(1, observer.poll()["consecutive_failures"])
        self.clock.advance(3)
        self.assertEqual(2, observer.poll()["consecutive_failures"])
        self.clock.advance(7)
        self.assertEqual("ACTION_REQUIRED", observer.poll()["status"])

    def test_malformed_failed_repeated_poll_does_not_change_observation(self):
        observer = self.observer()
        self.clock.advance(300)
        observer.poll()
        before = (observer.revision, observer.last_progress, observer.failure_code,
                  observer.failure_count, observer.next_check)
        self.status(1, status="FAILED", error={"code": "BROKEN"})
        for _ in range(2):
            with self.assertRaises(ProtocolError):
                observer.poll()
        self.assertEqual(before, (observer.revision, observer.last_progress, observer.failure_code,
                                 observer.failure_count, observer.next_check))

    def test_versions_are_strings_and_dummy_never_claims_real_model(self):
        for version in (1, True, "", " "):
            with self.assertRaises(ProtocolError):
                dataclasses.replace(self.request, model_version=version)
        real = dataclasses.replace(self.request, model_version="real-v1")
        self.publish(real)
        result = DummyPeer(self.store).run(real)
        self.assertEqual("FAILED", result["status"])
        self.assertEqual("INPUT_INVALID", result["error"]["code"])

    def test_descriptors_are_actual_prefixed_object_keys(self):
        manifest = self.publish()
        self.assertEqual("targets", manifest["files"][0]["name"])
        self.assertEqual("dev/" + self.request.inputs + "targets.parquet", manifest["files"][0]["key"])
        with self.assertRaises(ProtocolError):
            self.store.relative_key("prod/requests/x")
        self.assertEqual("x", LocalStore(self.root / "plain").object_key("x"))

    def test_independent_heartbeat_thread_and_shutdown(self):
        self.publish()
        observed = threading.Event()
        original = self.store.put
        def put(key, data, **kwargs):
            result = original(key, data, **kwargs)
            if key.endswith("status.json") and decode(data)["revision"] > 1:
                observed.set()
            return result
        self.store.put = put
        def compute(unused_heartbeat):
            self.assertTrue(observed.wait(2), "Independent heartbeat was not observed")
        self.assertEqual("COMPLETED", DummyPeer(self.store, timing=Timing(heartbeat=0.01)).run(self.request, compute)["status"])
        self.assertFalse(any(thread.name == "dummy-inference-heartbeat" for thread in threading.enumerate()))

    def test_poll_interval_uses_injected_sleep(self):
        observer = self.observer()
        sleeps = []
        def sleep(seconds):
            sleeps.append(seconds)
            self.clock.advance(seconds)
        self.assertEqual("ACTION_REQUIRED", observer.wait(sleep=sleep)["status"])
        self.assertEqual({5}, set(sleeps))


class ProcessBoundaryTests(unittest.TestCase):
    def test_one_model_failure_does_not_block_other_result(self):
        from communication_demo import run_demo
        results = {row["model_kind"]: row for row in run_demo({"binary": "unsupported", "type": "dummy-v1"})}
        self.assertEqual("FAILED", results["binary"]["status"])
        self.assertEqual("COMPLETED", results["type"]["status"])
        self.assertEqual(1, results["type"]["executions"])


class S3AdapterTests(unittest.TestCase):
    def test_missing_permission_and_conditional_conflict_are_distinct(self):
        class ClientError(Exception):
            def __init__(self, code):
                self.response = {"Error": {"Code": code}}
        class Client:
            code = "NoSuchKey"
            def get_object(self, **kwargs):
                raise ClientError(self.code)
            def put_object(self, **kwargs):
                self.kwargs = kwargs
                raise ClientError("PreconditionFailed")
        client = Client()
        store = S3Store(client, "fixture", "dev/")
        self.assertIsNone(store.get("x"))
        client.code = "AccessDenied"
        with self.assertRaises(StoreUnavailable):
            store.get("x")
        self.assertFalse(store.put("x", b"value", absent=True))
        self.assertEqual("*", client.kwargs["IfNoneMatch"])
        self.assertEqual("dev/x", client.kwargs["Key"])


class RunContractTests(unittest.TestCase):
    def setUp(self):
        from demo_calculator import FEATURE_VERSION, MODEL_VERSION
        self.temporary = tempfile.TemporaryDirectory(prefix="aml-v2-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.store = LocalStore(self.root / "objects", "dev/")
        self.request = Request(7, "type", model_version=MODEL_VERSION,
                               feature_version=FEATURE_VERSION, run_id=str(uuid4()))

    def result(self, request=None, change=None):
        from demo_calculator import build_targets, calculate
        request = request or self.request
        scores = calculate(build_targets([1, 2]), request.model_kind,
                           model_version=request.model_version, feature_version=request.feature_version)
        if change:
            scores = change(scores)
        stream = io.BytesIO()
        pq.write_table(scores, stream)
        data = stream.getvalue()
        key = request.output + "scores.parquet"
        self.store.put(key, data)
        return dict(request.identity(), **request.versions(), status="COMPLETED", row_count=2,
                    started_at="2026-09-21T00:00:00+00:00", finished_at="2026-09-21T00:00:01+00:00",
                    files=[descriptor("scores", self.store.object_key(key), data)])

    def test_v2_identity_and_paths_match_spring_cancellation(self):
        identity = self.request.identity()
        self.assertEqual(identity["contract_version"], 2)
        self.assertEqual(identity["model_kind"], "TYPE")
        self.assertEqual(identity["run_id"], self.request.run_id)
        self.assertEqual(self.request.output,
                         f"results/7/TYPE/{self.request.request_id}/rounds/1/")
        self.assertEqual(Request(7, "type").identity()["contract_version"], 1)

    def test_missing_or_other_run_and_round_are_rejected(self):
        for changes in (dict(run_id=str(uuid4())), dict(run_id=None),
                        dict(execution_round=2), dict(contract_version=1), dict(model_kind="type")):
            with self.subTest(changes=changes), self.assertRaises(ProtocolError):
                self.request.check(dict(self.request.identity(), **self.request.versions(), **changes))

    def test_same_request_cannot_publish_for_another_run(self):
        from demo_calculator import build_targets
        pq.write_table(build_targets([1, 2]), self.root / "targets.parquet")
        files = [{"name": "targets", "relative_path": "targets.parquet"}]
        document = publish(self.store, self.request, self.root, files, 2)
        self.assertEqual(document["run_id"], self.request.run_id)
        with self.assertRaises(ProtocolError):
            publish(self.store, dataclasses.replace(self.request, run_id=str(uuid4())), self.root, files, 2)

    def test_demo_result_is_validated_with_type_sum(self):
        from worker_transport import validate_result
        validate_result(self.store, self.request, self.result(), {1, 2})
        bad = self.result(change=lambda scores: scores.set_column(1, "p_0", pa.array([0.9, 0.9])))
        with self.assertRaises(ProtocolError):
            validate_result(self.store, self.request, bad, {1, 2})

    def test_v1_cannot_claim_demo_v2_result_support(self):
        from worker_transport import validate_result
        request = dataclasses.replace(self.request, run_id=None)
        with self.assertRaises(ProtocolError):
            validate_result(self.store, request, self.result(request), {1, 2})

    def test_invalid_run_and_legacy_peer_are_rejected(self):
        for run in ("invalid", True, ""):
            with self.subTest(run=run), self.assertRaises(ProtocolError):
                dataclasses.replace(self.request, run_id=run)
        with self.assertRaises(ProtocolError):
            DummyPeer(self.store).run(self.request)


if __name__ == "__main__":
    unittest.main()
