import io
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

from demo_calculator import (FEATURE_VERSION, MODEL_VERSION, build_targets,
                             calculate, validate_scores)
from worker_transport import ProtocolError

VERSIONS = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)


class DemoCalculatorTests(unittest.TestCase):
    def test_approved_formula_boundaries_and_parquet_roundtrip(self):
        targets = build_targets([100, 99, 1, 2**63 - 1])
        binary = calculate(targets, "binary", **VERSIONS)
        self.assertEqual(binary.column("p_laundering").to_pylist(),
                         [0.015, 0.995, 0.005, 0.075])
        typed = calculate(targets, "type", **VERSIONS)
        self.assertEqual(typed.column("p_0").to_pylist(), [0.05, 0.6, 0.6, 0.05])
        self.assertEqual(typed.column("p_7").to_pylist(), [0.05, 0.05, 0.05, 0.6])
        for kind, scores in [("binary", binary), ("type", typed)]:
            stream = io.BytesIO()
            pq.write_table(scores, stream)
            restored = pq.read_table(io.BytesIO(stream.getvalue()))
            validate_scores(restored, [100, 99, 1, 2**63 - 1], kind, **VERSIONS)

    def test_order_and_repeated_calculation_do_not_change_results(self):
        targets = build_targets(range(1, 101))
        reversed_targets = targets.take(pa.array(list(reversed(range(100)))))
        for kind in ("binary", "type"):
            first = calculate(targets, kind, **VERSIONS)
            self.assertTrue(first.equals(calculate(reversed_targets, kind, **VERSIONS)))
            self.assertTrue(first.equals(calculate(targets, kind, **VERSIONS)))
            validate_scores(first, range(1, 101), kind, **VERSIONS)

    def test_empty_duplicate_and_invalid_targets_rejected(self):
        for ids in ([], [1, 1], [None], [True], [1.0], [0], [-1], [2**63]):
            with self.subTest(ids=ids), self.assertRaises(ProtocolError):
                build_targets(ids)

    def test_raw_columns_wrong_values_and_input_types_rejected(self):
        targets = build_targets([1, 2])
        for bad in (
            targets.append_column("Is Laundering", pa.array([0, 1])),
            targets.set_column(1, "demo_value", pa.array([1, 3], type=pa.int64())),
            targets.set_column(1, "demo_value", pa.array([1, None], type=pa.int64())),
            targets.set_column(1, "demo_value", pa.array([1., 2.])),
            targets.set_column(0, "tx_id", pa.array([1., 2.])),
        ):
            with self.subTest(schema=bad.schema), self.assertRaises(ProtocolError):
                calculate(bad, "binary", **VERSIONS)
        self.assertEqual(targets.column_names, ["tx_id", "demo_value"])

    def test_missing_extra_duplicate_and_null_result_ids_rejected(self):
        for ids in ([1], [1, 2, 3], [1, 1], [1, None]):
            scores = pa.table({"tx_id": pa.array(ids, type=pa.int64()),
                               "p_laundering": pa.array([0.5] * len(ids))})
            with self.subTest(ids=ids), self.assertRaises(ProtocolError):
                validate_scores(scores, [1, 2], "binary", **VERSIONS)

    def test_nonfinite_out_of_range_null_and_wrong_dtype_rejected(self):
        scores = calculate(build_targets([1]), "binary", **VERSIONS)
        for values in (pa.array([float("nan")]), pa.array([float("inf")]),
                       pa.array([-0.01]), pa.array([1.01]),
                       pa.array([None], type=pa.float64()),
                       pa.array([0.5], type=pa.float32())):
            with self.subTest(values=values), self.assertRaises(ProtocolError):
                validate_scores(scores.set_column(1, "p_laundering", values),
                                [1], "binary", **VERSIONS)

    def test_type_sum_tolerance(self):
        scores = calculate(build_targets([1]), "type", **VERSIONS)
        for delta, accepted in [(5e-10, True), (2e-9, False), (0.1, False)]:
            altered = scores.set_column(1, "p_0", pa.array([0.05 + delta]))
            if accepted:
                validate_scores(altered, [1], "type", **VERSIONS)
            else:
                with self.assertRaises(ProtocolError):
                    validate_scores(altered, [1], "type", **VERSIONS)

    def test_version_and_model_mixing_rejected(self):
        targets = build_targets([1])
        scores = calculate(targets, "binary", **VERSIONS)
        for versions in (dict(VERSIONS, model_version="dummy-v1"),
                         dict(VERSIONS, feature_version="dummy-input-v1")):
            with self.assertRaises(ProtocolError):
                calculate(targets, "binary", **versions)
            with self.assertRaises(ProtocolError):
                validate_scores(scores, [1], "binary", **versions)
        with self.assertRaises(ProtocolError):
            calculate(targets, "unknown", **VERSIONS)
        with self.assertRaises(ProtocolError):
            validate_scores(scores, [1], "type", **VERSIONS)


if __name__ == "__main__":
    unittest.main()
