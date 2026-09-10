import unittest
import analysis_entry


class EntryTests(unittest.TestCase):
    def test_unconnected_stages_never_succeed(self):
        for stage in ("FEATURES", "INFERENCE", "SCORES", "ALERTS"):
            with self.subTest(stage=stage):
                self.assertEqual(78, analysis_entry.main([
                    "--job-id", "1", "--stage", stage,
                    "--execution-id", "00000000-0000-0000-0000-000000000001",
                ]))


if __name__ == "__main__":
    unittest.main()
