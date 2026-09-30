import unittest
import pyarrow as pa
from demo_calculator import (build_label_targets, build_targets, calculate, validate_scores,
                             LABEL_MODEL_VERSION, LABEL_FEATURE_VERSION, MODEL_VERSION, FEATURE_VERSION, FIXED_LABEL_MODEL_VERSION)
from worker_transport import ProtocolError


class DemoLabelsTests(unittest.TestCase):
    versions = dict(model_version=FIXED_LABEL_MODEL_VERSION, feature_version=LABEL_FEATURE_VERSION)

    def test_random_scores_have_bounds_variation_and_label_tendency(self):
        versions = dict(model_version=LABEL_MODEL_VERSION, feature_version=LABEL_FEATURE_VERSION)
        table = build_label_targets([(i, i % 2 == 0, 3 if i % 2 == 0 else 0) for i in range(1, 10001)])
        scores = calculate(table, 'binary', **versions)
        values = scores['p_laundering'].to_pylist()
        normal, laundering = values[::2], values[1::2]
        self.assertTrue(all(.01 <= v <= .99 for v in normal))
        self.assertTrue(all(.3 <= v <= .99 for v in laundering))
        self.assertGreater(len(set(values)), 9900)
        self.assertGreater(sum(v >= .7 for v in laundering) / len(laundering), .90)
        self.assertGreater(sum(v < .7 for v in normal) / len(normal), .90)
        self.assertTrue(any(v < .7 for v in laundering))
        self.assertTrue(any(v >= .7 for v in normal))
        self.assertFalse(any(v in (.01, .3, .7, .99) for v in values))
        typed = calculate(table, 'type', **versions)
        validate_scores(typed, range(1, 10001), 'type', **versions)
        rows = typed.to_pylist()
        matches = sum(max(range(9), key=lambda k: r[f'p_{k}']) == (3 if r['tx_id'] % 2 == 0 else 0) for r in rows)
        self.assertGreater(matches / len(rows), .85)
        self.assertLess(matches, len(rows))

    def test_random_outputs_are_stable_across_order_chunks_and_retries(self):
        versions = dict(model_version=LABEL_MODEL_VERSION, feature_version=LABEL_FEATURE_VERSION)
        table = build_label_targets([(i, True, i % 9) for i in range(1, 20)])
        for kind in ('binary', 'type'):
            expected = calculate(table, kind, **versions)
            self.assertTrue(expected.equals(calculate(table, kind, **versions)))
            self.assertTrue(expected.equals(calculate(table.take(list(reversed(range(19)))), kind, **versions)))
            chunks = pa.concat_tables([calculate(table.slice(0, 7), kind, **versions), calculate(table.slice(7), kind, **versions)])
            self.assertTrue(expected.equals(chunks))

    def test_labels_not_id_determine_both_models(self):
        for ids in ([1, 2, 3], [10001, 20002, 30003]):
            table = build_label_targets([(ids[0], True, 3), (ids[1], False, 0), (ids[2], True, 0)])
            binary = calculate(table, 'binary', **self.versions)
            typed = calculate(table, 'type', **self.versions)
            self.assertEqual(binary['p_laundering'].to_pylist(), [.95, .05, .95])
            self.assertEqual(typed['p_3'].to_pylist(), [.92, .01, .01])
            self.assertEqual(typed['p_0'].to_pylist(), [.01, .92, .92])
            validate_scores(binary, ids, 'binary', **self.versions)
            validate_scores(typed, ids, 'type', **self.versions)

    def test_annotation_validation_and_version_separation(self):
        for rows in ([(1, False, 3)], [(1, None, 0)], [(1, True, 9)], [(1, True, 2), (1, True, 2)]):
            with self.assertRaises(ProtocolError):
                build_label_targets(rows)
        table = build_label_targets([(1, True, 2)])
        with self.assertRaises(ProtocolError):
            calculate(table, 'binary', model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
        with self.assertRaises(ProtocolError):
            calculate(build_targets([1]), 'binary', **self.versions)
        with self.assertRaises(ProtocolError):
            calculate(table.set_column(1, 'demo_label', pa.array([1])), 'binary', **self.versions)
