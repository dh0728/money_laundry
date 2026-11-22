"""reset_prod_rds: host-side ordering; the shared in-container SQL is tested in test_reset_dev_rds."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import unittest.mock
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("reset_prod_rds", ROOT / "reset_prod_rds.py")
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)

TABLES = {"users": [], "banks": [], "bank_reporting_periods": [], "fx_rates": []}


class Engine:
    def __init__(self, name, calls):
        self.name, self.calls = name, calls

    def compose(self, meta, *arguments, data=None):
        self.calls.append((self.name, arguments[0]))
        return ""


class ResetProdTests(unittest.TestCase):
    def run_main(self, argv):
        calls = []
        engines = {"prod": (Engine("prod", calls), {}), "dev": (Engine("dev", calls), {})}

        def inner(engine, meta, action, payload=None, database=reset.dev.DATABASE):
            calls.append((engine.name, action, database))
            return {"backup": json.dumps(TABLES), "wipe": "EMPTIED"}.get(action, "{}")

        with unittest.mock.patch.object(reset, "load_engine", side_effect=engines.get), \
                unittest.mock.patch.object(reset.dev, "inner", side_effect=inner), redirect_stdout(io.StringIO()):
            reset.main(argv)
        return calls

    def test_inspection_alone_changes_nothing(self):
        self.assertEqual(self.run_main([]), [("prod", "inspect", "aml_prod")])

    def test_apply_stops_production_api_before_wiping_aml_prod(self):
        self.assertEqual(self.run_main(["--apply"]), [
            ("prod", "inspect", "aml_prod"), ("prod", "stop"), ("prod", "wipe", "aml_prod")])

    def test_copy_reads_dev_and_writes_only_aml_prod(self):
        self.assertEqual(self.run_main(["--copy-config-from-dev"]), [
            ("dev", "backup", "aml_dev_v3"), ("prod", "restore", "aml_prod"), ("prod", "grant", "aml_prod")])


if __name__ == "__main__":
    unittest.main()
