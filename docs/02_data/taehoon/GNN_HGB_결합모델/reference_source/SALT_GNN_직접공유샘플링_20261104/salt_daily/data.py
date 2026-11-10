from .config import ROOT, LEGACY, GRAPH, FEATURES
from .storage import read_json, write_json, sha
import ctypes as C
import gc
import subprocess
import numpy as np
from graph_runtime import Topology, HIInputs
from .extra_features import ExtraEdgeFeatures
from .shared_topology import SharedTopology


def date(day):
    return str(np.datetime64('2022-08-01') + np.timedelta64(int(day), 'D'))


def cohort(scope):
    from .population import FullPopulation
    return FullPopulation(scope)


def daily_orders(data, epoch, shuffle=True, start_day_cursor=0):
    """Chronological days; shuffle targets within a day only."""
    if hasattr(data, 'orders'):
        yield from data.orders(epoch, shuffle, start_day_cursor)
        return
    for day in np.unique(data['day']):
        indices = np.flatnonzero(data['day'] == day)
        if shuffle:
            indices = np.random.default_rng(42000 + epoch * 100 + int(day)).permutation(indices)
        yield int(day), indices


class Degrees:
    def __init__(self, topology):
        self.topology = topology
        self.directory = ROOT / 'cache/degree'
        self.directory.mkdir(parents=True, exist_ok=True)
        source = ROOT / 'salt_daily/degree.c'
        library = self.directory / ('degree_' + sha(source)[:12] + '.so')
        if not library.exists():
            subprocess.run(['gcc', '-O3', '-std=c11', '-fPIC', '-shared', str(source), '-o', str(library)], check=True, capture_output=True)
        self.lib = C.CDLL(str(library))
        self.p64, self.p32, self.pu32 = C.POINTER(C.c_int64), C.POINTER(C.c_int32), C.POINTER(C.c_uint32)
        self.lib.prefix_counts.argtypes = [self.p64, self.pu32, self.p32, C.c_int64, C.c_int64, self.p64]
        self.lib.prefix_counts.restype = None
        self.loaded_day = None

    def load(self, day):
        if day == self.loaded_day:
            return self.counts
        path = self.directory / f'{date(day)}.npy'
        marker = path.with_suffix('.json')
        cutoff = (int(day) + 1) * 1440
        if not marker.exists():
            counts = np.empty((self.topology.nn, 2), dtype=np.int64)
            for direction, offset_index in enumerate((2, 6)):
                offsets, ids = self.topology.indices[offset_index:offset_index + 2]
                column = np.empty(self.topology.nn, dtype=np.int64)
                self.lib.prefix_counts(offsets.ctypes.data_as(self.p64), ids.ctypes.data_as(self.pu32),
                                       self.topology.minute.ctypes.data_as(self.p32), self.topology.nn,
                                       cutoff, column.ctypes.data_as(self.p64))
                counts[:, direction] = column
            temporary = path.with_suffix('.tmp.npy')
            np.save(temporary, counts)
            temporary.replace(path)
            write_json(marker, dict(day=int(day), cutoff_exclusive=cutoff, sha256=sha(path),
                                    degree_source='original incoming/outgoing transaction counts',
                                    source_sha256=sha(ROOT / 'salt_daily/degree.c')))
        metadata = read_json(marker)
        assert metadata['cutoff_exclusive'] == cutoff
        self.counts = np.load(path, mmap_mode='r')
        self.loaded_day = day
        return self.counts

    def calibration(self):
        # Fit only on the training graph, never Monitor/Val/Test. Daily contexts
        # remain capped at D; this global fitted scalar is a training transform.
        day = read_json(ROOT / 'protocol.json')['cohorts']['train_gnn']['max_day']
        counts = self.load(day)
        active = counts.sum(axis=1) > 0
        delta = np.log1p(counts[active]).mean(axis=0)
        assert np.all(np.isfinite(delta)) and np.all(delta > 0)
        return dict(delta=delta.tolist(), calibration_date=date(day), active_accounts=int(active.sum()),
                    original_transaction_count=int(counts[:, 0].sum()),
                    zero_degree_in_each_direction_included=True,
                    normalization='mean log1p original degree over active account union at training graph close',
                    fit_scope='training graph only; no Monitor/Val/Test', daily_graph_cutoff_unchanged=True)


class DailyData:
    def __init__(self, shared=True, device='cpu'):
        # The disjoint option is exclusively a validation/benchmark reference.
        protocol = read_json(ROOT/'protocol.json')
        backend = protocol['graph'].get('sampler_backend', 'cpu')
        if shared and backend == 'cuda' and device == 'cuda':
            import torch
            from .cuda_topology import CudaTopology
            torch.cuda.set_per_process_memory_fraction(protocol['training']['cuda_memory_fraction'])
            self.topology = CudaTopology('hi', cap=100)
        else:
            self.topology = (SharedTopology if shared else Topology)('hi', cap=100)
        self.inputs = HIInputs()
        self.extra_features = ExtraEdgeFeatures()
        self.degrees = Degrees(self.topology)
        contract = read_json(GRAPH.parent / 'v10_daily_fixed_20261024/input_contract.json')
        excluded = {'amt_z_pay_ccy', 'pair_history_count', 'same_entity'}
        self.edge_indices = [i for i, name in enumerate(contract['edge_features']) if name not in excluded]
        assert len(self.edge_indices) == 14 and len(contract['node_features']) == 19
        self.gpu_features = None
        if shared and device == 'cuda' and protocol.get('input_pipeline', {}).get('backend') == 'cuda':
            assert backend == 'cuda', 'GPU inputs require the CUDA graph sampler'
            from .cuda_features import CudaFeatureStore
            self.gpu_features = CudaFeatureStore(self.inputs, self.extra_features,
                                                self.topology.width, self.edge_indices)
        self.day = None

    def set_day(self, day):
        self.day = int(day)
        self.inputs.set_day(date(day))
        self.degree = self.degrees.load(day)
        if self.gpu_features is not None:
            self.gpu_features.set_day(self.inputs.nodes, self.degree)

    def materialize(self, ids):
        """NumPy compatibility interface; training keeps the inputs on GPU."""
        if self.gpu_features is not None:
            arrays, graph = self.materialize_gpu(ids)
            return tuple(a.cpu().numpy() for a in arrays), tuple(a.cpu().numpy() for a in graph)
        return self.materialize_cpu(ids)

    def materialize_cpu(self, ids, graph=None):
        """Independent original feature path for CPU runs and exact validation."""
        ids = np.asarray(ids, dtype=np.int64)
        assert self.day is not None and len(ids) > 0
        assert np.all(self.topology.minute[ids] // 1440 == self.day), 'Mixed-day query batch'
        if graph is None:
            graph = self.topology.batch(ids)
        nodes, edges, sources, destinations, target_sources, target_destinations, flags, ego = graph
        assert np.all(self.topology.minute[edges] < (self.day + 1) * 1440), 'Future context edge'
        arrays = list(self.inputs.materialize(ids, graph))
        arrays[2] = np.ascontiguousarray(arrays[2][:, self.edge_indices])
        arrays[4] = np.ascontiguousarray(arrays[4][:, self.edge_indices])
        arrays[2] = self.extra_features.append(arrays[2], edges)
        arrays[4] = self.extra_features.append(arrays[4], ids)
        arrays.append(np.asarray(self.degree[nodes], dtype=np.float32))
        assert arrays[3].shape == (2, len(ids))
        assert np.array_equal(nodes[target_sources], self.topology.src[ids])
        assert np.array_equal(nodes[target_destinations], self.topology.dst[ids])
        for array in (arrays[0], arrays[2], arrays[4], arrays[7]):
            assert np.isfinite(array).all()
        return tuple(arrays), graph

    def materialize_gpu(self, ids, graph=None):
        import torch
        ids = np.asarray(ids, dtype=np.int64)
        assert self.day is not None and len(ids) > 0
        assert np.all(self.topology.minute[ids] // 1440 == self.day), 'Mixed-day query batch'
        if graph is None:
            graph = self.topology.batch_tensors(ids)
        targets = torch.tensor(ids, device=self.topology.device)
        nodes, edges, _, _, ts, td, _, _ = graph
        assert bool((self.topology.raw_gpu[2][edges] < (self.day+1)*1440).all()), 'Future context edge'
        assert torch.equal(nodes[ts], self.topology.raw_gpu[0][targets].long())
        assert torch.equal(nodes[td], self.topology.raw_gpu[1][targets].long())
        return self.gpu_features.materialize(targets, graph), graph

    def microbatches(self, data, indices, microbatch=8, max_edges=40000):
        def split(take):
            ids = data['ids'][take]
            graph = (self.topology.batch_tensors(ids) if self.gpu_features is not None
                     else self.topology.batch(ids))
            if len(graph[1]) > max_edges and len(take) > 1:
                middle = len(take) // 2
                del graph
                yield from split(take[:middle])
                yield from split(take[middle:])
            else:
                # A single large query is preserved, never dropped or truncated.
                materialize = self.materialize_gpu if self.gpu_features is not None else self.materialize_cpu
                arrays, graph = materialize(ids, graph)
                yield take, arrays, dict(nodes=len(graph[0]), edges=len(graph[1]))
                del arrays, graph
        for start in range(0, len(indices), microbatch):
            yield from split(indices[start:start + microbatch])


def tensors(arrays, device):
    import torch
    return tuple(torch.as_tensor(a, device=device,
                 dtype=torch.long if i in (1, 3) else torch.bool if i in (5, 6) else torch.float32)
                 for i, a in enumerate(arrays))


def cleanup():
    gc.collect()
    try:
        C.CDLL(None).malloc_trim(0)
    except AttributeError:
        pass

