"""Contract with backend/inference-server: shared modules stay identical, views stay readable."""
from pathlib import Path
import unittest
from uuid import uuid4

from common.worker_transport import Request
from inference.inference_dispatch import normalize

SERVER = Path(__file__).resolve().parents[3] / "inference-server"
SHARED = ("worker_transport.py", "model_contract.py", "score_contract.py")


def text(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


class InferenceContractTests(unittest.TestCase):
    def test_shared_contract_modules_are_identical_copies(self):
        backend = Path(__file__).resolve().parents[1] / "common"
        for name in SHARED:
            with self.subTest(name=name):
                self.assertEqual(text(backend / name), text(SERVER / "common" / name))

    def test_acceptance_view_of_inference_server_is_understood(self):
        # Same view as inference-server tests/test_inference_server.py acceptance test.
        request = Request(7, "binary", str(uuid4()), 1, "demo-random-v1", "demo-input-v1", str(uuid4()))
        view = dict(request.identity(), status="ACCEPTED", revision=1, error_code=None,
                    notification_delivered=False, attempts=0, model_failures=0, transfer_failures=0)
        self.assertEqual(normalize(request, view, "dev/", 3)["status"], "ACCEPTED")


if __name__ == "__main__":
    unittest.main()
