"""Frozen HI Multi-FraudGT -> every SAML-D observation. No SAML fitting.

Run with the existing project dependency paths (see run_evaluation.sh).
All generated files are isolated here; original training artifacts are immutable.
"""
from pathlib import Path
import os, sys, json, time, hashlib, ctypes, subprocess, gc, signal
from datetime import datetime, timezone
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent
S = Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_saml_generalization_20261025')
SG = Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_gnn_verify_20261025/cache/saml')
CACHE = ROOT / 'cache'
CHUNKS = ROOT / 'chunks'
os.environ.setdefault('FRAUDGT_WORK_DIR', str(ROOT / 'work'))
sys.path.insert(0, str(ROOT / 'source'))
import numpy as np
import pyarrow.parquet as pq
import torch
from torch_geometric.sampler import NeighborSampler
from fraudgt_lab.config import TrainConfig, EDGE_INDICES, digest
from fraudgt_lab.data import FeatureAdapter, GraphBatch
from fraudgt_lab.official_loader import PeriodGraph, MappedFeatureStore, MappedGraphStore, FORWARD, REVERSE
from fraudgt_lab.models import make_model
from fraudgt_lab.training import sample_next
from fraudgt_lab.metrics import binary_average_precision

N, NN, BATCH, CHUNK_BATCHES = 9504852, 855460, 2048, 32
WEIGHT_SHA = '42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'
X_SHA = '26eec830677526e3eb98f54abe189cd0b0e2f5a6dd19ad6dddfcb0cf7f71977d'
STOP = False

def now():
    return datetime.now(timezone.utc).isoformat()

def write(path, value):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)

def event(name, **kw):
    value = {'utc': now(), 'event': name, **kw}
    print(json.dumps(value, ensure_ascii=False), flush=True)
    write(ROOT / 'status.json', value)

def mmap(path):
    return np.load(path, mmap_mode='r')

def source_manifest():
    paths = [Path(__file__), ROOT / 'source' / 'ports.c', *sorted((ROOT / 'source' / 'fraudgt_lab').glob('*.py'))]
    return {str(p.relative_to(ROOT)): digest(p) for p in paths}

def prepare():
    CACHE.mkdir(exist_ok=True)
    if (CACHE / 'complete.json').exists():
        assert json.loads((CACHE / 'complete.json').read_text())['complete']
        return
    event('prepare_start', rows=N, nodes=NN)
    assert digest(ROOT / 'selected_best.pt') == WEIGHT_SHA
    assert digest(S / 'cache' / 'X.npy') == X_SHA
    src, dst, minute = [mmap(SG / f'{name}.npy') for name in ('src', 'dst', 'minute')]
    assert src.dtype == dst.dtype == minute.dtype == np.dtype('int32')
    assert src.shape == dst.shape == minute.shape == (N,)
    assert min(src.min(), dst.min()) >= 0 and max(src.max(), dst.max()) < NN
    # Check the graph's transaction namespace against the observation table.
    obs = pq.read_table(S / 'cache' / 'observations.parquet', columns=['eid', 'src', 'dst'])
    assert np.array_equal(obs['eid'].to_numpy(), np.arange(N))
    assert np.array_equal(obs['src'].to_numpy(), src)
    assert np.array_equal(obs['dst'].to_numpy(), dst)
    del obs
    x = mmap(S / 'cache' / 'X.npy')
    assert x.shape == (N, 71) and x.dtype == np.dtype('float32')
    edge = np.lib.format.open_memmap(CACHE / 'edge22.npy', 'w+', dtype='float32', shape=(N, 22))
    unknown = 0
    for start in range(0, N, 200000):
        end = min(start + 200000, N)
        block = np.asarray(x[start:end])
        code = block[:, 17].astype(np.int64)
        assert np.equal(code, block[:, 17]).all()
        unknown += int(((code < 0) | (code >= 7)).sum())
        code = np.where((code >= 0) & (code < 7), code, 7)
        edge[start:end, :14] = block[:, EDGE_INDICES]
        edge[start:end, 14:] = np.eye(8, dtype='float32')[code]
        assert np.isfinite(edge[start:end]).all()
        assert not np.any(block[:, [12, 13]])
        assert not np.any(block[:, 32:41]) and not np.any(block[:, 51:60])
    edge.flush()
    del edge, block
    event('edge_features_ready', unknown_payment_rows=unknown)
    library = CACHE / 'ports.so'
    subprocess.run(['gcc', '-O3', '-std=c11', '-fPIC', '-shared', str(ROOT / 'source' / 'ports.c'), '-o', str(library)], check=True)
    lib = ctypes.CDLL(str(library))
    p64 = ctypes.POINTER(ctypes.c_int64)
    pu = ctypes.POINTER(ctypes.c_uint32)
    p32 = ctypes.POINTER(ctypes.c_int32)
    lib.build_ports.argtypes = [ctypes.c_int64, p64, pu, p32, p32]
    lib.build_ports.restype = ctypes.c_int
    last = {}
    audit = []
    for role, peer, owner in [('incoming', src, dst), ('outgoing', dst, src)]:
        offsets = mmap(SG / f'{role}_time_offsets.npy')
        ids = mmap(SG / f'{role}_time_ids.npy')
        assert offsets.dtype == np.dtype('int64') and ids.dtype == np.dtype('uint32')
        assert offsets.shape == (NN+1,) and ids.shape == (N,)
        assert offsets[0] == 0 and offsets[-1] == N and np.all(np.diff(offsets) >= 0)
        seen = np.zeros(N, dtype=bool)
        seen[ids] = True
        assert seen.all(), 'CSC must contain every transaction exactly once'
        del seen
        # This full-array check independently verifies graph ownership and ordering.
        owners = owner[ids]
        assert np.array_equal(np.bincount(owners, minlength=NN), np.diff(offsets))
        assert np.all(owners[1:] >= owners[:-1])
        times = minute[ids]
        same = owners[1:] == owners[:-1]
        assert np.all(times[1:][same] >= times[:-1][same])
        tied = same & (times[1:] == times[:-1])
        assert np.all(ids[1:][tied] > ids[:-1][tied])
        del owners, times, same, tied
        row = np.lib.format.open_memmap(CACHE / f'{role}_row.npy', 'w+', dtype='int64', shape=(N,))
        for start in range(0, N, 500000):
            row[start:start+500000] = peer[ids[start:start+500000]]
        row.flush()
        del row
        ports = np.lib.format.open_memmap(CACHE / f'{role}_ports.npy', 'w+', dtype='int32', shape=(N,))
        assert lib.build_ports(NN, offsets.ctypes.data_as(p64), ids.ctypes.data_as(pu), peer.ctypes.data_as(p32), ports.ctypes.data_as(p32)) == 1
        ports.flush()
        active = np.flatnonzero(np.diff(offsets) > 0)
        check_nodes = np.unique(np.r_[active[np.linspace(0, len(active)-1, 64).astype(int)], np.argsort(np.diff(offsets))[-4:]])
        checked = 0
        for node in check_nodes:
            mapping = {}
            for eid in ids[offsets[node]:offsets[node+1]]:
                p = int(peer[eid])
                if p not in mapping:
                    mapping[p] = len(mapping)
                assert ports[eid] == mapping[p]
                checked += 1
        audit.append(dict(role=role, independently_checked_nodes=len(check_nodes), checked_edges=checked))
        last[role] = np.full(NN, -1, dtype=np.int64)
        last[role][active] = ids[offsets[active+1]-1]
        del ports
        event('relation_ready', role=role, audited_edges=checked)
    a, b = last['outgoing'], last['incoming']
    use_a = (a >= 0) & ((b < 0) | (minute[np.maximum(a, 0)] >= minute[np.maximum(b, 0)]))
    nodes = np.lib.format.open_memmap(CACHE / 'nodes19.npy', 'w+', dtype='float32', shape=(NN, 19))
    nodes[:] = 0
    for mask, ids, col in [(use_a, a, 22), ((b >= 0) & ~use_a, b, 41)]:
        ix = np.flatnonzero(mask)
        for start in range(0, len(ix), 100000):
            take = ix[start:start+100000]
            nodes[take] = x[ids[take], col:col+19]
    assert np.isfinite(nodes).all() and not nodes[:, 10:].any()
    for col, endpoints in [(0, src), (1, dst)]:
        expected = np.log1p(np.bincount(endpoints, minlength=NN)).astype('float32')
        np.testing.assert_array_equal(nodes[:, col], expected)
    # Independent count of distinct observed partners for each direction.
    keys = np.unique(src.astype(np.int64) * NN + dst)
    np.testing.assert_array_equal(nodes[:, 2], np.log1p(np.bincount(keys // NN, minlength=NN)).astype('float32'))
    np.testing.assert_array_equal(nodes[:, 3], np.log1p(np.bincount(keys % NN, minlength=NN)).astype('float32'))
    del keys
    nodes.flush()
    truth = pq.read_table(S / 'cache' / 'truth.parquet', columns=['eid', 'y'])
    assert np.array_equal(truth['eid'].to_numpy(), np.arange(N))
    y = truth['y'].to_numpy()
    assert ((y == 0) | (y == 1)).all() and int(y.sum()) == 9873
    np.save(CACHE / 'labels.npy', y)
    order = np.random.default_rng(2000048).permutation(N).astype('uint32')
    np.save(CACHE / 'order.npy', order)
    inputs = {}
    for path in [S/'cache'/'X.npy', S/'cache'/'truth.parquet', S/'cache'/'observations.parquet',
                 *[SG/f'{n}.npy' for n in ('src','dst','minute','incoming_time_offsets','incoming_time_ids','outgoing_time_offsets','outgoing_time_ids')]]:
        inputs[str(path)] = dict(sha256=X_SHA if path.name == 'X.npy' else digest(path), size=path.stat().st_size, mtime_ns=path.stat().st_mtime_ns)
    generated = {p.name: dict(sha256=digest(p), size=p.stat().st_size, mtime_ns=p.stat().st_mtime_ns) for p in sorted(CACHE.glob('*.npy'))}
    write(CACHE / 'complete.json', dict(complete=True, utc=now(), rows=N, nodes=NN, positives=9873,
          unknown_payment_rows=unknown, node_degree_checks='all nodes, in/out degree and distinct partners',
          port_audit=audit, inputs=inputs, generated=generated))
    event('prepare_complete', rows=N, positives=9873)

class SamlAdapter(FeatureAdapter):
    def __init__(self):
        self.edge = mmap(CACHE / 'edge22.npy')
        self.port_arrays = [mmap(CACHE / f'{role}_ports.npy') for role in ('incoming','outgoing')]
    def edge_features(self, ids):
        return np.ascontiguousarray(self.edge[ids])
    def ports(self, ids):
        return np.column_stack([a[ids] for a in self.port_arrays]).astype('float32')

class GpuAdapter:
    """Exact cached feature lookup on CUDA; same PyG graph and query order."""
    def __init__(self, graph):
        self.edge = torch.tensor(np.asarray(mmap(CACHE/'edge22.npy')), device='cuda')
        self.node = torch.tensor(np.asarray(graph.nodes), device='cuda')
        self.ports = torch.tensor(np.column_stack([mmap(CACHE/f'{role}_ports.npy') for role in ('incoming','outgoing')]), dtype=torch.float32, device='cuda')
        self.original = {kind: torch.tensor(np.asarray(ids).astype('int64'),device='cuda') for kind,ids in graph.ids.items()}
        self.src = torch.tensor(np.asarray(graph.src).astype('int64'),device='cuda')
        self.dst = torch.tensor(np.asarray(graph.dst).astype('int64'),device='cuda')
        self.positions = torch.full((N,),-1,dtype=torch.int64,device='cuda')

    def materialize(self, graph, sampled, seed_ids):
        rows = sampled[FORWARD].input_id.numpy()
        targets = torch.tensor(np.asarray(seed_ids[rows]).astype('int64'),device='cuda')
        forward = self.original[FORWARD][sampled[FORWARD].e_id.to('cuda')]
        reverse = self.original[REVERSE][sampled[REVERSE].e_id.to('cuda')]
        all_ids = torch.cat([forward,reverse])
        nodes = sampled['node'].n_id.to('cuda')
        indices = torch.cat([sampled[FORWARD].edge_index.to('cuda'),sampled[REVERSE].edge_index.to('cuda').flip(0)],dim=1)
        target_index = sampled[FORWARD].edge_label_index.to('cuda')
        # Retain endpoint/transaction-ID checks on every production batch.
        assert torch.equal(nodes[target_index[0]],self.src[targets])
        assert torch.equal(nodes[target_index[1]],self.dst[targets])
        assert torch.equal(nodes[indices[0]],self.src[all_ids])
        assert torch.equal(nodes[indices[1]],self.dst[all_ids])
        ego = torch.zeros(len(nodes),dtype=torch.float32,device='cuda')
        ego[target_index.flatten()] = 1
        node_features = torch.cat([self.node[nodes],ego[:,None]],dim=1)
        self.positions.fill_(-1)
        self.positions[forward] = torch.arange(len(forward),device='cuda')
        positions = self.positions[targets]
        incoming = torch.arange(len(all_ids),device='cuda') < len(forward)
        batch = GraphBatch(node_features,indices,self.edge[all_ids],target_index,self.edge[targets],
                           incoming,~incoming,positions,self.ports[all_ids],self.ports[targets])
        stats = dict(targets=len(targets),nodes=len(nodes),forward_edges=len(forward),reverse_edges=len(reverse),
                     target_edges_not_sampled=int((positions<0).sum()),unique_nodes=len(nodes),disjoint=False,relations=2)
        return rows,batch,stats

class SamlGraph(PeriodGraph):
    def __init__(self, config):
        self.config, self.scope, self.variant = config, 'test', 'multi_fraudgt_format'
        self.relations, self.disjoint = [FORWARD, REVERSE], False
        self.ids, self.arrays = {}, {}
        for kind, role in [(FORWARD,'incoming'), (REVERSE,'outgoing')]:
            row = np.load(CACHE / f'{role}_row.npy', mmap_mode='c')
            ptr = np.load(SG / f'{role}_time_offsets.npy', mmap_mode='c')
            self.arrays[kind] = (torch.from_numpy(row), torch.from_numpy(ptr))
            self.ids[kind] = mmap(SG / f'{role}_time_ids.npy')
        self.nodes = mmap(CACHE / 'nodes19.npy')
        self.feature_store = MappedFeatureStore(self.nodes)
        self.graph_store = MappedGraphStore(self.arrays, NN)
        self.sampler = NeighborSampler((self.feature_store,self.graph_store), num_neighbors=[50,50], replace=False, subgraph_type='directional', disjoint=False)
        self.sampler.edge_types = list(self.relations)
        self.src, self.dst = [mmap(SG / f'{name}.npy') for name in ('src','dst')]

def load():
    assert digest(ROOT / 'selected_best.pt') == WEIGHT_SHA
    checkpoint = torch.load(ROOT / 'selected_best.pt', map_location='cpu', weights_only=False)
    assert checkpoint['epoch'] == 280 and checkpoint['variant'] == 'multi_fraudgt_format'
    config = replace(TrainConfig(**checkpoint['config']), readout='all_targets')
    torch.set_num_threads(config.torch_threads)
    torch.manual_seed(config.seed)
    torch.cuda.set_per_process_memory_fraction(.85)
    model = make_model(checkpoint['variant'], config).eval().to('cuda')
    model.load_state_dict(checkpoint['state_dict'], strict=True)
    graph = SamlGraph(config)
    return model, config, graph, GpuAdapter(graph)

def freeze_protocol(config):
    prepared = json.loads((CACHE/'complete.json').read_text())
    for name, info in prepared['inputs'].items():
        stat = Path(name).stat()
        assert (stat.st_size,stat.st_mtime_ns) == (info['size'],info['mtime_ns']), f'Changed input: {name}'
    for name, info in prepared['generated'].items():
        stat = (CACHE/name).stat()
        assert (stat.st_size,stat.st_mtime_ns) == (info['size'],info['mtime_ns']), f'Changed cache: {name}'
    from dataclasses import asdict
    protocol = dict(version=2, checkpoint_sha256=WEIGHT_SHA, selected_epoch=280,
        model='Multi-FraudGT trained on HI; frozen weights', population='ALL SAML-D observations as external test',
        rows=N, positives=9873, normal=9494979, nodes=NN, dates=['2022-10-07','2023-08-23'],
        threshold='logit > 0, mathematically sigmoid(logit) > 0.5', threshold_tuned_on_saml=False,
        config=asdict(config), readout='all_targets; no forced query edges in message passing',
        graph='full cumulative SAML-D through period end; NOT per-target causal evaluation',
        sampler='PyG LinkNeighborLoader uniform without replacement, shared2048, fanout[50,50], forward+reverse',
        order_seed=2000048, sampler_scope='test', sampler_epoch=0,
        execution='CUDA feature lookup (exact CPU input parity checked); one CPU sampler prefetch thread; unchanged graph batch and float32 model',
        node_snapshot='last active day per node (equivalent to full period-end observations)',
        numeric_features='Existing HI-compatible SAML cache; frozen HI scaling; 14 numeric edge + 19 node',
        missing_features='9 unavailable node KYC/owner columns and 2 country edge columns filled with numeric 0; zero is NOT null; model has no learned missingness flag',
        payment_format='HI 7 categories + Unknown; Debit card/Cross-border are Unknown',
        unknown_payment_rows=prepared['unknown_payment_rows'],
        ports='Original chronological distinct-counterparty zero-based ports, rebuilt on SAML accounts',
        fitting='No SAML training, no SAML threshold/feature tuning, labels used only for metrics',
        limits=['SAML was used in earlier external evaluations; not a pristine unseen holdout',
                'Feature/KYC mismatch makes this a conditional domain-transfer evaluation',
                'Context includes later observations within SAML period, matching prior HI full-period protocol'],
        source=source_manifest(), preparation_sha256=digest(CACHE/'complete.json'))
    path = ROOT/'protocol.json'
    if path.exists():
        assert json.loads(path.read_text()) == protocol, 'Frozen evaluation protocol changed'
    else:
        write(path, protocol)
    return digest(path)

def trim():
    gc.collect()
    ctypes.CDLL('libc.so.6').malloc_trim(0)

def preflight(model, config, graph, adapter):
    path = ROOT/'preflight.json'
    if path.exists():
        assert json.loads(path.read_text())['protocol_sha256'] == digest(ROOT/'protocol.json')
        return
    order = mmap(CACHE/'order.npy')
    checks = []
    reference_adapter = SamlAdapter()
    with torch.inference_mode():
        for index in [0, 1, (N//BATCH)//2, N//BATCH]:
            ids = order[index*BATCH:min((index+1)*BATCH,N)]
            started = time.monotonic()
            sampled = sample_next(iter(graph.loader(ids,batch_size=BATCH)), config, 'test', 0, index)
            rows, batch, stats = adapter.materialize(graph,sampled,ids)
            assert np.array_equal(rows,np.arange(len(ids)))
            ref_rows,reference,_ = reference_adapter.materialize(graph,sampled,ids)
            assert np.array_equal(rows,ref_rows)
            for name,value in vars(batch).items():
                torch.testing.assert_close(value.cpu(),getattr(reference,name),rtol=0,atol=0)
            batch = batch.to('cuda')
            model.readout = 'all_targets'
            logits, selection = model(batch)
            assert torch.equal(selection,torch.arange(len(ids),device='cuda')) and torch.isfinite(logits).all()
            model.readout = 'official'
            official, selected = model(batch)
            error = float((official-logits[selected]).abs().max()) if len(selected) else 0.
            torch.testing.assert_close(official,logits[selected],rtol=1e-5,atol=1e-5)
            model.readout = 'all_targets'
            logits_again, _ = model(batch)
            torch.testing.assert_close(logits_again,logits,rtol=1e-5,atol=1e-5)
            reference_logits,_ = model(reference.to('cuda'))
            torch.testing.assert_close(logits,reference_logits,rtol=1e-5,atol=1e-5)
            item = dict(batch=index, **stats, official_common_max_abs_error=error, seconds=time.monotonic()-started,
                        gpu_peak_allocated_bytes=torch.cuda.max_memory_allocated(),gpu_input_bitwise_matches_cpu=True,
                        gpu_adapter_logit_max_abs_error=float((logits-reference_logits).abs().max()))
            checks.append(item)
            event('preflight_batch_pass', **item)
            del batch,sampled,logits,logits_again,official,selected,reference,reference_logits
            trim()
    write(path,dict(passed=True,utc=now(),protocol_sha256=digest(ROOT/'protocol.json'),checks=checks))

def run():
    prepare()
    model,config,graph,adapter = load()
    protocol_sha = freeze_protocol(config)
    preflight(model,config,graph,adapter)
    CHUNKS.mkdir(exist_ok=True)
    order = mmap(CACHE/'order.npy')
    chunk_size = BATCH*CHUNK_BATCHES
    started = time.monotonic()
    already = 0
    for start in range(0,N,chunk_size):
        path = CHUNKS/f'{start:08d}.json'
        if path.exists():
            saved = json.loads(path.read_text())
            assert saved['protocol_sha256'] == protocol_sha
            assert digest(path.with_suffix('.npz')) == saved['sha256']
            already += saved['rows']
    completed = already
    with torch.inference_mode(), ThreadPoolExecutor(max_workers=1) as pool:
        for start in range(0,N,chunk_size):
            path = CHUNKS/f'{start:08d}.json'
            if path.exists():
                continue
            stop = min(start+chunk_size,N)
            ids = order[start:stop]
            iterator = iter(graph.loader(ids,batch_size=BATCH))
            logits = np.empty(len(ids),dtype='float32')
            visited = np.zeros(len(ids),bool)
            timings = dict(sample=0.,materialize=0.,gpu=0.)
            chunk_start = time.monotonic()
            count = (len(ids)+BATCH-1)//BATCH
            future = pool.submit(sample_next,iterator,config,'test',0,start//BATCH)
            for local in range(count):
                index = start//BATCH+local
                t = time.monotonic()
                sampled = future.result()
                if local+1<count:
                    future = pool.submit(sample_next,iterator,config,'test',0,index+1)
                timings['sample'] += time.monotonic()-t
                t = time.monotonic()
                rows,batch,stats = adapter.materialize(graph,sampled,ids)
                timings['materialize'] += time.monotonic()-t
                t = time.monotonic()
                prediction,selection = model(batch.to('cuda'))
                out = prediction.cpu().numpy()
                selected = selection.cpu().numpy()
                timings['gpu'] += time.monotonic()-t
                assert np.array_equal(selected,np.arange(len(rows)))
                assert np.isfinite(out).all() and not visited[rows].any()
                logits[rows] = out
                visited[rows] = True
                done = completed + int(visited.sum())
                elapsed = time.monotonic()-started
                speed = (done-already)/elapsed
                event('inference', completed=done,total=N,percent=100*done/N,rows_per_second=speed,
                      eta_seconds=(N-done)/speed,global_batch=index,gpu_peak_bytes=torch.cuda.max_memory_allocated(),
                      sample_seconds=timings['sample'],feature_seconds=timings['materialize'],gpu_seconds=timings['gpu'])
                del sampled,batch,prediction,selection,out,selected
            assert visited.all()
            temporary = path.with_suffix('.tmp.npz')
            np.savez(temporary,transaction_id=ids,logit=logits)
            temporary.replace(path.with_suffix('.npz'))
            write(path,dict(protocol_sha256=protocol_sha,start=start,end=stop,rows=len(ids),
                  sha256=digest(path.with_suffix('.npz')),seconds=time.monotonic()-chunk_start,timings=timings))
            completed += len(ids)
            trim()
            if STOP:
                event('interrupted_at_saved_chunk',completed=completed,total=N)
                return
    event('inference_complete',completed=N,total=N,elapsed_seconds=time.monotonic()-started)
    del model,graph,adapter
    torch.cuda.empty_cache()
    trim()
    report()

def report():
    protocol_sha = digest(ROOT/'protocol.json')
    scores = np.lib.format.open_memmap(CACHE/'logits.npy','w+',dtype='float32',shape=(N,))
    seen = np.zeros(N,dtype=bool)
    for path in sorted(CHUNKS.glob('*.json')):
        meta = json.loads(path.read_text())
        assert meta['protocol_sha256'] == protocol_sha and digest(path.with_suffix('.npz')) == meta['sha256']
        with np.load(path.with_suffix('.npz')) as part:
            ids,z = part['transaction_id'],part['logit']
            assert len(ids) == meta['rows'] and len(ids) == len(np.unique(ids))
            assert (ids<N).all() and np.isfinite(z).all() and not seen[ids].any()
            scores[ids] = z
            seen[ids] = True
    assert seen.all(), f'Missing predictions: {int((~seen).sum())}'
    scores.flush()
    y = mmap(CACHE/'labels.npy').astype(bool)
    pred = scores > 0
    tp,fp,fn,tn = [int(mask.sum()) for mask in (y&pred,~y&pred,y&~pred,~y&~pred)]
    ratio = lambda a,b: a/b if b else 0.
    from sklearn.metrics import roc_auc_score, average_precision_score
    ap = binary_average_precision(y,scores)
    sklearn_ap = float(average_precision_score(y,scores))
    assert abs(ap-sklearn_ap) < 1e-12
    result = dict(utc=now(),protocol_sha256=protocol_sha,rows=N,positive=int(y.sum()),normal=int((~y).sum()),
        scored=N,coverage=1.,threshold=.5,selected_epoch=280,TP=tp,FP=fp,FN=fn,TN=tn,
        precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),F1=ratio(2*tp,2*tp+fp+fn),AP=ap,
        ROC_AUC=float(roc_auc_score(y,scores)),FPR=ratio(fp,fp+tn),specificity=ratio(tn,tn+fp),
        accuracy=ratio(tp+tn,N),predicted_positive=tp+fp,positive_prevalence=float(y.mean()),
        logits_min=float(scores.min()),logits_max=float(scores.max()),logits_sha256=digest(CACHE/'logits.npy'),
        ap_crosscheck='Custom exact-tie AP equals sklearn within 1e-12')
    patterns = pq.read_table(S/'cache'/'truth.parquet',columns=['pattern']).to_pandas()['pattern']
    rows = []
    for pattern,indices in patterns.groupby(patterns,sort=True).groups.items():
        ix = np.asarray(indices)
        positive = y[ix]
        rows.append(dict(pattern=pattern,rows=len(ix),positive=int(positive.sum()),
                         predicted_positive=int(pred[ix].sum()),positive_prediction_rate=float(pred[ix].mean())))
    import pandas as pd
    pd.DataFrame(rows).to_csv(ROOT/'pattern_metrics.csv',index=False)
    pd.DataFrame([result]).to_csv(ROOT/'metrics.csv',index=False)
    write(ROOT/'result.json',result)
    p = json.loads((ROOT/'protocol.json').read_text())
    md = f'''# Multi-FraudGT SAML-D 전체 외부 Test 평가

- 완료 시각: {result['utc']}
- 대상: SAML-D 전체 **{N:,}건**, 정상 **{result['normal']:,}건**, 사기 **{result['positive']:,}건**. 평가 누락 **0건**, 커버리지 **100%**.
- 기간: **2022-10-07 ~ 2023-08-23**. SAML-D를 새 train/val/test로 나누거나 재학습하지 않고 전체를 외부 평가 대상으로 사용했다.
- 모델: HI에서 학습·선택한 **Multi-FraudGT epoch 280**. 가중치 고정, 임계값 **sigmoid(logit) > 0.5** 고정, SAML 정답으로 튜닝하지 않았다.

| 지표 | SAML-D 전체 | 기존 HI 전체 Test (참고) |
|---|---:|---:|
| Precision | {result['precision']:.4%} | 89.2231% |
| Recall | {result['recall']:.4%} | 57.7806% |
| F1 | {result['F1']:.4%} | 70.1393% |
| AP (Average Precision) | {result['AP']:.4%} | 66.8788% |
| ROC-AUC | {result['ROC_AUC']:.4%} | — |
| FPR | {result['FPR']:.4%} | — |
| Accuracy | {result['accuracy']:.4%} | — |

| 실제 / 예측 | 정상 예측 | 사기 예측 |
|---|---:|---:|
| 정상 | TN {tn:,} | FP {fp:,} |
| 사기 | FN {fn:,} | TP {tp:,} |

사기 비율은 **{result['positive_prevalence']:.4%}**이다. AP는 logit 순위로 계산하고 동점까지 처리했으며 scikit-learn과 일치함을 확인했다. Accuracy는 불균형 데이터에서 단독 성능 판단에 적합하지 않다. 각 SAML 패턴별 건수와 양성 예측률은 `pattern_metrics.csv`에 있다. HI의 무패턴 분류를 SAML 패턴에 임의로 대응시키지 않았다.

## 고정한 평가 조건

| 항목 | 적용 |
|---|---|
| 구조 | hidden 64, heads 8, layers 2, forward/reverse 두 관계, Multi ego 표시 |
| 이웃 추출 | 실제 PyG LinkNeighborLoader, shared batch 2,048, fanout [50,50], 균등 비복원 |
| 전체 거래 점수 | all_targets readout; 미추출 seed를 메시지 전달 그래프에 강제로 추가하지 않음 |
| 그래프 | SAML 전체 기간 말까지의 누적 거래 9,504,852건, 계좌 855,460개 |
| 노드 피처 | 각 계좌의 마지막 활동일 누적 상태 = 전체 기간 말 상태 |
| 엣지 피처 | 기존 검증된 SAML 전처리의 숫자 14개 + 결제형태 8차원 one-hot |
| 정규화 | 기존 HI 통계 고정; SAML 데이터로 재적합하지 않음 |
| 포트 | 원본 C 구현으로 SAML 내 시간순 최초 상대계좌 순번 생성 |
| 재현성 | permutation seed 2000048; sampler seed 42/test/0/global_batch; float32 |
| 실행 최적화 | 피처 조회 CUDA 캐시 + CPU 샘플러 1배치 미리 준비; CPU 원본 입력과 비트 단위 동일성 및 최종 점수 일치 검사 |

## 해석 시 필요한 제한

1. **0은 null이 아니다.** SAML에 없는 노드 계좌유형/소유관계 9개 열과 국가 관련 엣지 2개 열을 숫자 0으로 채웠다. 실제 0과 결측을 모델이 구분할 별도 표시가 없으며, 이 결측 처리에 맞춰 재학습한 모델이 아니다. 따라서 원래 HI 피처가 모두 관측된 동일 조건 평가로 해석할 수 없다.
2. 결제형태 `Debit card`, `Cross-border`를 임의로 다른 HI 종류로 바꾸지 않고 Unknown으로 처리했다. Unknown **{p['unknown_payment_rows']:,}건**. HI 통계에 없는 결제통화는 기존 SAML 규칙대로 금액 z-score를 0으로 처리했다.
3. 그래프와 노드 상태는 **전체 기간 말 기준**이다. 개별 거래 시점보다 나중 관측된 거래도 문맥에 포함될 수 있다. 기존 HI 전체 평가의 누적 그래프 방식에 맞춘 평가이며, 거래 시점의 실시간 탐지 성능을 의미하지 않는다.
4. SAML은 과거 다른 모델의 외부 평가에도 사용됐다. 완전히 처음 보는 비공개 holdout이라는 주장을 하지 않는다. HI와 SAML의 모집단·양성 비율·피처 가용성이 다르므로 표의 차이를 모델 자체 성능 차이로만 해석하지 않는다.

## 검증 및 산출물

- 원본 가중치 SHA-256: `{WEIGHT_SHA}`. strict load 확인.
- 모든 CSC 거래 ID/방향/시간순서 검증, 모든 노드 in/out degree·고유 상대계좌 수 검증, 포트 독립 재계산 검증.
- 4개 대표 배치에서 all_targets 커버리지 100%, 유한 점수, 기존 official 공통 대상 점수 일치 검증 (`preflight.json`).
- 전체 거래 ID 중복·누락 없이 정확히 1회 점수 생성. 전체 AP를 별도 구현과 sklearn으로 교차 확인.
- `protocol.json`: 추론 전 고정한 조건과 코드 해시. `cache/complete.json`: 입력·파생 배열 해시 및 검증 기록.
- `result.json`, `metrics.csv`: 전체 지표. `pattern_metrics.csv`: 패턴별 진단. `cache/logits.npy`: 원본 eid 순서의 전체 점수.
- `chunks/`: 중단·재개 가능한 배치 결과. `run.log`, `status.json`: 실행 로그와 진행 상태.
- SALT-GNN은 별도 체크포인트로 안전 중단했다. `salt_pause_confirmed.json`과 `salt_last_at_pause.pt`에 중단 상태를 보존했다.
'''
    (ROOT/'결과.md').write_text(md)
    event('complete', **result)

def handle_stop(signum,frame):
    global STOP
    STOP = True
    print('Stop requested: will save the current chunk before exiting.',flush=True)

if __name__ == '__main__':
    signal.signal(signal.SIGTERM,handle_stop)
    signal.signal(signal.SIGINT,handle_stop)
    action = sys.argv[1] if len(sys.argv)>1 else 'run'
    if action == 'prepare': prepare()
    elif action == 'report': report()
    elif action == 'run': run()
    else: raise ValueError(action)
