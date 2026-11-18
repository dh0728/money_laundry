"""Population, loss, resume, metrics, and real daily-graph preflight."""
import io
import time
import unittest

import numpy as np
import torch

from .config import ROOT, GRAPH, FEATURES
from .prepare import prepare
from .storage import read_json, write_json, sha, utc
from .data import DailyData, cohort, tensors, date, cleanup
from .model import DailySALT, model_kwargs
from .training import microbatch_loss, loss_denominator
from .extra_features import INPUT_PATHS
from .shared_validation import check_union
from graph_runtime import Topology


def validate(device='cpu'):
    protocol = prepare()
    torch.set_num_threads(1)
    if device == 'cuda':
        torch.cuda.set_per_process_memory_fraction(protocol['training']['cuda_memory_fraction'])
    suite = unittest.defaultTestLoader.discover(str(ROOT/'tests'))
    output = io.StringIO()
    tests = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    (ROOT/'unit_tests.log').write_text(output.getvalue())
    assert tests.wasSuccessful(), output.getvalue()
    loader = DailyData(device=device)
    reference_topology = Topology('hi', cap=100)
    calibration = read_json(ROOT/'calibration.json')
    assert calibration['calibration_date'] == '2022-09-25'
    records = []
    for scope, day in [('train_gnn', 7), ('train_gnn', 55), ('monitor', 56),
                       ('validation', 69), ('test', 74), ('test', 91)]:
        data = cohort(scope)
        span = next(s for s in data.meta['spans'] if s['day'] == day)
        labels = data['y'][span['start']:span['stop']]
        positions = np.array([np.flatnonzero(labels == 0)[0], np.flatnonzero(labels > 0)[0]]) + span['start']
        loader.set_day(day)
        begin = time.monotonic(); arrays, graph = loader.materialize(data['ids'][positions])
        assert arrays[2].shape[1] == arrays[4].shape[1] == 24
        original = loader.inputs.materialize(data['ids'][positions], graph)
        np.testing.assert_array_equal(arrays[0], original[0])
        np.testing.assert_array_equal(arrays[2][:, :14], original[2][:, loader.edge_indices])
        np.testing.assert_array_equal(arrays[4][:, :14], original[4][:, loader.edge_indices])
        for features, ids in ((arrays[2], graph[1]), (arrays[4], data['ids'][positions])):
            codes = np.asarray(loader.extra_features.formats[ids], dtype=np.int64)
            expected = np.where((codes >= 0) & (codes < 7), codes, 7)
            np.testing.assert_array_equal(features[:, 14:22].sum(1), np.ones(len(ids)))
            np.testing.assert_array_equal(features[:, 14:22].argmax(1), expected)
            np.testing.assert_array_equal(features[:, 22], loader.extra_features.in_ports[ids])
            np.testing.assert_array_equal(features[:, 23], loader.extra_features.out_ports[ids])
        assert np.all(loader.topology.minute[graph[1]] < (day+1)*1440)
        assert loader.inputs.day == date(day)
        for node in np.unique(graph[0])[:16]:
            for direction, offset_index in enumerate((2, 6)):
                offsets, ids = loader.topology.indices[offset_index:offset_index+2]
                incident = ids[offsets[node]:offsets[node+1]]
                assert loader.degree[node, direction] == np.count_nonzero(loader.topology.minute[incident] < (day+1)*1440)
        variants = {}
        rng = np.random.default_rng(4200+day)
        batch_positions = rng.choice(span['stop']-span['start'],
            size=protocol['training']['microbatch_max'], replace=False)+span['start']
        # Include transaction endpoints from the highest-degree accounts where
        # the final incident transaction belongs to the current target day.
        extras = []
        for direction, offset_index in enumerate((2, 6)):
            offsets, incident_ids = loader.topology.indices[offset_index:offset_index+2]
            counts = np.asarray(loader.degree[:, direction])
            for node in np.argpartition(counts, -4)[-4:]:
                if counts[node] > 0:
                    tid = incident_ids[offsets[node]+counts[node]-1]
                    if loader.topology.minute[tid]//1440 == day:
                        candidate = np.searchsorted(data['ids'][span['start']:span['stop']], tid)+span['start']
                        if candidate < span['stop'] and data['ids'][candidate] == tid:
                            extras.append(candidate)
        batch_positions = np.unique(np.r_[batch_positions, extras]).astype(np.int64)
        check_ids = data['ids'][batch_positions[:protocol['training']['microbatch_max']]]
        independent_graph = reference_topology.batch(check_ids)
        shared_graph = loader.topology.batch(check_ids)
        sharing = check_union(independent_graph, shared_graph, reference_topology, check_ids)
        del independent_graph, shared_graph
        for variant in protocol['variants']:
            torch.manual_seed(42)
            model = DailySALT(variant, **model_kwargs(protocol, calibration['delta'])).to(device)
            logits = model(*tensors(arrays, device), return_logits=True)
            target = torch.as_tensor(data['y'][positions] > 0, dtype=torch.long, device=device)
            loss = microbatch_loss(logits, target, loss_denominator(data['y'][positions]))
            loss.backward()
            assert torch.isfinite(logits).all() and torch.isfinite(loss)
            assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters() if p.requires_grad)
            variants[variant] = dict(scored=2, finite_gradients=True)
            del logits, loss
            model.zero_grad(set_to_none=True)
            scored = 0; largest_batch = largest_edges = 0
            if device == 'cuda': torch.cuda.reset_peak_memory_stats()
            for take, large_arrays, metadata in loader.microbatches(data, batch_positions,
                    microbatch=protocol['training']['microbatch_max'],
                    max_edges=protocol['training']['max_edges_per_microbatch']):
                if loader.gpu_features is not None and variant == protocol['variants'][0]:
                    # Compare every actual split input to the original CPU path,
                    # including target order, daily node features and Test fallback.
                    cpu_arrays, cpu_graph = loader.materialize_cpu(data['ids'][take])
                    for gpu_array, cpu_array in zip(large_arrays, cpu_arrays):
                        np.testing.assert_array_equal(gpu_array.cpu().numpy(), cpu_array)
                    del cpu_arrays, cpu_graph
                logits = model(*tensors(large_arrays, device), return_logits=True)
                target = torch.as_tensor(data['y'][take] > 0, dtype=torch.long, device=device)
                loss = microbatch_loss(logits, target, loss_denominator(data['y'][batch_positions]))
                assert torch.isfinite(logits).all() and torch.isfinite(loss)
                loss.backward(); scored += len(take)
                largest_batch = max(largest_batch, len(take)); largest_edges = max(largest_edges, metadata['edges'])
                del logits, loss, target, large_arrays
            assert scored == len(batch_positions)
            assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters() if p.requires_grad)
            peak = torch.cuda.max_memory_allocated() if device == 'cuda' else None
            if peak is not None:
                limit = torch.cuda.get_device_properties(0).total_memory * protocol['training']['cuda_memory_fraction']
                assert peak < limit - 1024**3, 'Selected batch exceeds validated GPU headroom'
            variants[variant].update(enlarged_batch_scored=scored, largest_batch=largest_batch,
                                     largest_edges=largest_edges, cuda_peak_allocated_bytes=peak)
            del model; cleanup()
            if device == 'cuda': torch.cuda.empty_cache()
        records.append(dict(scope=scope, day=date(day), ids=data['ids'][positions].tolist(),
            normal_and_positive=True, nodes=len(graph[0]), edges=len(graph[1]), variants=variants,
            future_days_excluded=True, exact_original_degree_checked=True,
            base_features_unchanged=True, payment_and_port_values_verified=True,
            cuda_input_arrays_exact=loader.gpu_features is not None,
            high_degree_target_examples=len(extras), shared_graph_verification=sharing,
            seconds=time.monotonic()-begin))
        print('actual_day_pass', scope, date(day), flush=True)
        del arrays, graph; cleanup()
    # All retained Train/Monitor/Val targets must have features, not only old sampled targets.
    present = np.load(FEATURES/'present.npy', mmap_mode='r')
    minute = np.load(FEATURES/'minute.npy', mmap_mode='r')
    edge_present = loader.inputs.present
    missing = 0
    for start in range(0, len(minute), 1_000_000):
        values = minute[start:start+1_000_000]
        valid = (present[start:start+len(values)] != 0) & (values >= 7*1440) & (values < 74*1440)
        ids = np.flatnonzero(valid)+start
        missing += int(np.count_nonzero(edge_present[ids] == 0))
    assert missing == 0
    test_ids = cohort('test')['ids']
    fallback = read_json(GRAPH/'cache/hi/test_edges_complete.json')
    assert np.min(test_ids) >= fallback['origin']
    assert np.max(test_ids)-fallback['origin'] < len(loader.inputs.test)
    paths = list(INPUT_PATHS)+[FEATURES/name for name in ('minute.npy', 'present.npy', 'src.npy', 'dst.npy', 'z.npy')]
    paths += [path for path in (GRAPH/'cache/hi').glob('*.npy')]
    paths += [FEATURES/'nodes'/f'{date(day)}.npy' for day in range(7, 92)]
    paths += [GRAPH.parent/'gnn36_structural_v8/cache/edges'/name for name in ('x.npy', 'present.npy')]
    stats = {str(path): dict(size=path.stat().st_size, mtime_ns=path.stat().st_mtime_ns) for path in paths}
    migration = read_json(ROOT/'migration.json')
    for name, digest in migration['old_files'].items():
        assert sha(name) == digest, f'Preserved experiment changed: {name}'
    for name, digest in read_json(ROOT/'fraudgt_preservation.json')['files'].items():
        assert sha(name) == digest, f'FraudGT code/conditions changed: {name}'
    files = list((ROOT/'salt_daily').glob('*.py')) + list((ROOT/'salt_daily').glob('*.c'))
    files += list((ROOT/'salt_daily').glob('*.cu'))
    files += list((ROOT/'tests').glob('*.py')) + [ROOT/'run.py', ROOT/'notebook_control.py']
    manifest = {str(path.relative_to(ROOT)): sha(path) for path in sorted(files)}
    write_json(ROOT/'code_manifest.json', manifest)
    result = dict(status='pass', utc=utc(), device=device, unit_tests=tests.testsRun, actual_days=records,
        code_manifest=manifest, protocol_sha256=sha(ROOT/'protocol.json'), input_file_stats=stats,
        all_population_counts={s: v['rows'] for s, v in protocol['cohorts'].items()},
        missing_train_monitor_validation_target_features=missing, test_feature_range_verified=True,
        production_training_performed=False, production_test_performed=False,
        test_labels_used_only_for_finite_gradient_smoke=True,
        test_smoke_only_no_optimizer_step_or_saved_test_model=True,
        test_smoke_targets_per_day={r['day']: {v: 2+x['enlarged_batch_scored']
            for v, x in r['variants'].items()} for r in records if r['scope'] == 'test'},
        original_experiments_preserved=True,
        limitation='Finite forward/backward and enlarged-batch checks only; full-population convergence not measured')
    write_json(ROOT/'preflight.json', result)
    return result
