"""CPU-only feature-loading prototype audit; never imports training or writes its inputs."""
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timezone
import ast
import gc
import hashlib
import json
import tracemalloc

import numpy as np

ROOT = Path(__file__).resolve().parent
PROJECT = (ROOT / 'project').resolve()
G = PROJECT / 'experiments/v10_goal65_20261024/cache/gnn'


def source_method(path, class_name, method_name, namespace):
    tree = ast.parse(path.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == method_name)
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[method_name]


settings = {}
for node in ast.parse((ROOT / 'fraudgt_lab/config.py').read_text()).body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in ['EDGE_INDICES', 'FORMAT_NAMES']:
                settings[target.id] = ast.literal_eval(node.value)
namespace = {'np': np, **settings}
indices = np.array(settings['EDGE_INDICES'])
assert 7 in indices and 16 not in indices


class CountedArray:
    def __init__(self, values):
        self.values, self.read_calls = values, 0

    def __getitem__(self, key):
        self.read_calls += 1
        return self.values[key]


class Inputs(SimpleNamespace):
    pass


class Adapter(SimpleNamespace):
    pass


Inputs.edges = source_method(PROJECT / 'experiments/v10_gnn_verify_20261025/graph_runtime.py',
                             'HIInputs', 'edges', namespace)
Adapter.current = source_method(ROOT / 'fraudgt_lab/data.py', 'FeatureAdapter', 'edge_features', namespace)


def candidate(adapter, ids, chunk_size=8192):
    """Prototype: selected columns only, bounded temporaries, original output order."""
    ordered, restore = np.unique(ids, return_inverse=True)
    width = len(indices)
    values = np.empty((len(ordered), width + len(settings['FORMAT_NAMES'])), np.float32)
    inputs = adapter.inputs
    for first in range(0, len(ordered), chunk_size):
        selected = ordered[first:first + chunk_size]
        ok = selected < len(inputs.edge)
        if ok.any():
            ok[ok] = inputs.present[selected[ok]] != 0
        numeric = np.empty((len(selected), width), np.float32)
        if ok.any():
            numeric[ok] = inputs.edge[selected[ok, None], indices[None, :]]
        if (~ok).any():
            # Keep the original missing/test-feature checks and fallback semantics.
            numeric[~ok] = inputs.edges(selected[~ok])[:, indices]
        numeric[:, int(np.flatnonzero(indices == 7)[0])] = inputs.pz[selected]
        block = values[first:first + len(selected)]
        block[:, :width] = numeric
        block[:, width:] = 0
        code = np.asarray(adapter.formats[selected], np.int64)
        code = np.where((code >= 0) & (code < 7), code, 7)
        block[np.arange(len(selected)), width + code] = 1
    return np.ascontiguousarray(values[restore], dtype=np.float32)


def measured(fn):
    gc.collect()
    tracemalloc.start()
    value = fn()
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return value, peak


def main():
    rng = np.random.default_rng(42)
    edge = rng.normal(size=(120_000, 17)).astype(np.float32)
    inputs = Inputs(edge=edge, present=np.ones(len(edge), np.uint8),
                    z=CountedArray(rng.normal(size=len(edge)).astype(np.float32)),
                    pz=rng.normal(size=len(edge)).astype(np.float32))
    adapter = Adapter(inputs=inputs, formats=rng.integers(-1, 9, len(edge)))
    ids = rng.integers(0, len(edge), 150_000)
    expected, old_peak = measured(lambda: adapter.current(ids))
    before = inputs.z.read_calls
    actual, new_peak = measured(lambda: candidate(adapter, ids))
    assert np.array_equal(expected, actual, equal_nan=True)
    assert inputs.z.read_calls == before
    assert candidate(adapter, np.array([], np.int64)).shape == (0, 22)
    synthetic = {'rows': len(ids), 'exact_output_match': True,
                 'current_peak_bytes': old_peak, 'candidate_peak_bytes': new_peak,
                 'peak_reduction_percent': 100 * (old_peak - new_peak) / old_peak,
                 'current_z_read_calls': before, 'candidate_extra_z_read_calls': inputs.z.read_calls - before}
    del adapter, inputs, edge, ids, expected, actual
    gc.collect()

    load = lambda path: np.load(path, mmap_mode='r')
    inputs = Inputs(edge=load(PROJECT / 'experiments/gnn36_structural_v8/cache/edges/x.npy'),
                    present=load(PROJECT / 'experiments/gnn36_structural_v8/cache/edges/present.npy'),
                    z=CountedArray(load(G / 'z.npy')),
                    pz=load(PROJECT / 'experiments/v10_gnn_verify_20261025/cache/hi/paid_z.npy'))
    adapter = Adapter(inputs=inputs, formats=load(G / 'fmt.npy'))
    real_checks = []
    for split in ['train', 'val']:
        population = load(ROOT / 'assets' / f'{split}_ids.npy')
        ids = np.asarray(population[np.linspace(0, len(population) - 1, 24, dtype=np.int64)], np.int64)
        ids = np.r_[ids[::-1], ids[:8], ids[:8]]
        expected = adapter.current(ids)
        before = inputs.z.read_calls
        actual = candidate(adapter, ids, chunk_size=7)
        assert np.array_equal(expected, actual, equal_nan=True)
        assert inputs.z.read_calls == before
        real_checks.append({'split': split, 'rows': len(ids), 'duplicates_and_reverse_order': True,
                            'exact_output_match': True, 'candidate_z_read_calls': 0})

    verification = json.loads((ROOT / 'verification.json').read_text())
    unchanged = all(hashlib.sha256((ROOT / n).read_bytes()).hexdigest() == h
                    for n, h in verification['source_sha256'].items())
    assert unchanged
    report = {'utc': datetime.now(timezone.utc).isoformat(), 'status': 'pass',
              'scope': 'Feature-loader prototype only; not installed in live training',
              'synthetic_allocation_check': synthetic, 'real_feature_checks': real_checks,
              'training_source_unchanged': unchanged, 'torch_imported': False,
              'training_interrupted': False,
              'limitations': ['Does not establish the owner of the running process anonymous memory.',
                              'Full model, missing/test fallback and long-run memory behavior need validation before adoption.']}
    (ROOT / 'feature_memory_candidate_verification_20261028.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
