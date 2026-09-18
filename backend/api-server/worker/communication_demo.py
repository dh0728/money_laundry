"""Run in the aml environment: python -B worker/communication_demo.py.

Separate Python peers exchange only disposable local objects. No Java, DB or AWS.
"""
import json
import tempfile
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from worker_transport import LocalStore, Observer, Request, publish


def run_demo(model_versions=None):
    versions = model_versions or {"binary": "dummy-v1", "type": "dummy-v1"}
    with tempfile.TemporaryDirectory(prefix="aml-communication-demo-") as directory:
        root = Path(directory)
        pq.write_table(pa.table({"tx_id": pa.array([101, 102], type=pa.int64())}), root / "targets.parquet")
        (root / "model-input.bin").write_bytes(b"explicit dummy model input")
        files = [{"name": "targets", "relative_path": "targets.parquet"},
                 {"name": "model_specific_input", "relative_path": "model-input.bin"}]
        store = LocalStore(root / "objects", "demo")
        requests, observers, executions, processes = {}, {}, {}, []
        try:
            for kind, version in versions.items():
                request = Request(1, kind, model_version=version)
                requests[kind] = request
                publish(store, request, root, files, 2)
                observers[kind] = Observer(store, request, {101, 102})
                executions[kind] = 0
            for _ in range(2):
                active = []
                for kind, request in requests.items():
                    command = [sys.executable, "-B", str(Path(__file__).with_name("dummy_inference_peer.py")),
                               "--store-root", str(root / "objects"), "--prefix", "demo", "--manifest", request.manifest]
                    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    processes.append(process)
                    active.append((kind, process))
                for kind, process in active:
                    output, _ = process.communicate(timeout=20)
                    response = json.loads(output)
                    executions[kind] += response.get("executions", 0)
            summaries = []
            for kind, observer in observers.items():
                result = observer.poll()
                summaries.append(dict(model_kind=kind, model_version=versions[kind],
                                      status=result["status"], row_count=result.get("row_count", 0),
                                      executions=executions[kind]))
            return summaries
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.communicate()


def main():
    for result in run_demo():
        print(json.dumps(result))


if __name__ == "__main__":
    main()
