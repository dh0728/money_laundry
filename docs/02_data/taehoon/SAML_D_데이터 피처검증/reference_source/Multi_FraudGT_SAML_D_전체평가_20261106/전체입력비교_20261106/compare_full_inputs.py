"""Read-only full-population model-input census. No sampling or model inference."""
import os
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = '1'
from pathlib import Path
import sys, json, csv, time, hashlib
from datetime import datetime, timezone
import numpy as np

ROOT = Path(__file__).resolve().parent
FULL = ROOT.parent
HI = Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
sys.path.insert(0, str(HI))
import fraudgt_lab
from fraudgt_lab import PROJECT_ROOT
from fraudgt_lab.config import EDGE_INDICES, FORMAT_NAMES
from common import G, NODE_NAMES, EDGE_NAMES
from graph_runtime import HIInputs

SG = Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_gnn_verify_20261025/cache/saml')
CHUNK = 500_000
EDGE = [EDGE_NAMES[i] for i in EDGE_INDICES] + ['in_port', 'out_port']
INPUTS = {}
START = time.monotonic()

def write(name, value):
    target = ROOT / name
    temp = target.with_suffix(target.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(target)

def event(stage, **kw):
    value = dict(utc=datetime.now(timezone.utc).isoformat(), stage=stage,
                 elapsed_seconds=round(time.monotonic()-START, 2), **kw)
    write('status.json', value)
    print(json.dumps(value, ensure_ascii=False), flush=True)

def load(path):
    path = Path(path)
    a = np.load(path, mmap_mode='r')
    st = path.stat()
    INPUTS[str(path)] = dict(shape=list(a.shape), dtype=str(a.dtype),
                             size=st.st_size, mtime_ns=st.st_mtime_ns)
    return a

class Stats:
    def __init__(self, names):
        self.names = list(names)
        n = len(names)
        self.count = 0
        self.sums = np.zeros(n, np.float64)
        self.squares = np.zeros(n, np.float64)
        self.zeros = np.zeros(n, np.int64)
        self.minimum = np.full(n, np.inf)
        self.maximum = np.full(n, -np.inf)

    def update(self, values, weights=None):
        assert values.shape[1] == len(self.names)
        if weights is not None:
            active = weights > 0
            values = values[active]
            weights = weights[active]
        if not len(values):
            return
        assert np.isfinite(values).all()
        self.count += len(values) if weights is None else int(weights.sum())
        for j in range(len(self.names)):
            v = values[:, j].astype(np.float64)
            self.sums[j] += v.sum() if weights is None else np.dot(v, weights)
            self.squares[j] += np.dot(v, v) if weights is None else np.dot(v*v, weights)
            self.zeros[j] += int((v == 0).sum()) if weights is None else int(weights[v == 0].sum())
            self.minimum[j] = min(self.minimum[j], v.min())
            self.maximum[j] = max(self.maximum[j], v.max())

    def merge(self, other):
        assert self.names == other.names
        self.count += other.count
        self.sums += other.sums
        self.squares += other.squares
        self.zeros += other.zeros
        self.minimum = np.minimum(self.minimum, other.minimum)
        self.maximum = np.maximum(self.maximum, other.maximum)

    def rows(self, domain, kind):
        mean = self.sums / self.count
        std = np.sqrt(np.maximum(0, self.squares / self.count - mean*mean))
        return [dict(domain=domain, kind=kind, feature=name, rows=self.count,
                     mean=float(mean[j]), std=float(std[j]), zero_count=int(self.zeros[j]),
                     zero_fraction=float(self.zeros[j]/self.count),
                     minimum=float(self.minimum[j]), maximum=float(self.maximum[j]))
                for j, name in enumerate(self.names)]

def save_csv(name, rows):
    with (ROOT / name).open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

def node_stats(nodes, weights):
    stats = Stats(NODE_NAMES)
    for start in range(0, len(nodes), 100_000):
        stats.update(nodes[start:start+100_000], weights[start:start+100_000])
    return stats

def main():
    splits = json.loads((HI/'assets/splits.json').read_text())
    write('plan.json', dict(created_utc=datetime.now(timezone.utc).isoformat(),
          scope='All retained model observations, not raw pre-dedup rows or sampled training exposure',
          hi_rows=splits['total'], saml_rows=9504852, chunk=CHUNK,
          population_includes='All normal and fraud records; no label filtering',
          edge_features=EDGE, node_features=NODE_NAMES, formats=FORMAT_NAMES,
          node_summary='Each full-population query endpoint uses its split-end cumulative snapshot; combined HI summaries are transaction-weighted mixtures of train/val/test snapshots',
          account_summary='Separate unique-active-account summaries, not transaction-weighted',
          ego='Dynamic query-batch indicator; do not invent one static whole-population value',
          missing_saml='Original zero-fill baseline, before owner median intervention',
          operations='Read-only input census; no training, inference, threshold selection or SALT restart',
          script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()))
    hi_input = HIInputs()
    # Record underlying arrays used by the preserved input loader.
    for a in (hi_input.edge, hi_input.present, hi_input.z, hi_input.pz, hi_input.minute):
        load(a.filename)
    src, dst, fmt, present = [load(G/f'{name}.npy') for name in ('src','dst','fmt','present')]
    ports = [load(PROJECT_ROOT/f'experiments/v10_fraudgt_compare_20261026/cache/{role}_ports.npy')
             for role in ('incoming', 'outgoing')]
    numeric, node_rows, account_rows, categories, coverage = [], [], [], [], []
    full_edge = Stats(EDGE)
    full_node = {role: Stats(NODE_NAMES) for role in ('src','dst')}
    full_formats = np.zeros(8, np.int64)
    full_src = np.zeros(2116168, np.int64)
    full_dst = np.zeros_like(full_src)
    split_ids = []
    for scope, meta in splits['windows'].items():
        domain = 'HI_' + scope
        ids_all = load(HI/f'assets/{scope}_ids.npy')
        split_ids.append(ids_all)
        nodes = load(G/f"nodes/{meta['end']}.npy")
        counts = {role: np.zeros(len(nodes), np.int64) for role in ('src','dst')}
        stats, format_counts = Stats(EDGE), np.zeros(8, np.int64)
        last_id = -1
        for start in range(0, len(ids_all), CHUNK):
            ids = np.asarray(ids_all[start:start+CHUNK], dtype=np.int64)
            assert ids[0] > last_id and (np.diff(ids) > 0).all()
            last_id = int(ids[-1])
            assert present[ids].all()
            days = np.asarray(hi_input.minute[ids] // 1440)
            assert (days >= meta['first_day']).all() and (days <= meta['last_day']).all()
            edge = hi_input.edges(ids)[:, EDGE_INDICES]
            values = np.column_stack([edge, ports[0][ids], ports[1][ids]]).astype(np.float32)
            stats.update(values)
            codes = fmt[ids]
            codes = np.where((codes >= 0) & (codes < 7), codes, 7)
            format_counts += np.bincount(codes, minlength=8)
            for role, array in [('src', src), ('dst', dst)]:
                counts[role] += np.bincount(array[ids], minlength=len(nodes))
            if start % 5_000_000 == 0 or start+len(ids) == len(ids_all):
                event('scan', domain=domain, completed=start+len(ids), total=len(ids_all))
        assert stats.count == meta['rows'] == int(format_counts.sum())
        full_edge.merge(stats)
        full_formats += format_counts
        numeric += stats.rows(domain, 'edge')
        for role in ('src','dst'):
            assert int(counts[role].sum()) == len(ids_all)
            ns = node_stats(nodes, counts[role])
            full_node[role].merge(ns)
            node_rows += ns.rows(domain, role)
        full_src += counts['src']; full_dst += counts['dst']
        # Cumulative active nodes at the snapshot date, including context-only nodes.
        active = (nodes[:,0] > 0) | (nodes[:,1] > 0)
        account_rows += node_stats(nodes, active.astype(np.int64)).rows(domain, 'unique_active_account')
        categories += [dict(domain=domain, format=name, rows=int(format_counts[j]),
                            fraction=float(format_counts[j]/len(ids_all))) for j,name in enumerate(FORMAT_NAMES)]
        coverage.append(dict(domain=domain, rows=len(ids_all), first_id=int(ids_all[0]), last_id=int(ids_all[-1]),
                             active_query_accounts=int(((counts['src']+counts['dst'])>0).sum()),
                             snapshot_date=meta['end'], active_context_accounts=int(active.sum())))
        event('split_complete', domain=domain, rows=stats.count)
    if hi_input.test is not None:
        load(hi_input.test.filename)
    observed = sum(int(np.count_nonzero(present[start:start+CHUNK])) for start in range(0,len(present),CHUNK))
    # Each split has sorted unique present IDs within disjoint date windows.
    assert observed == splits['total'] == full_edge.count
    numeric += full_edge.rows('HI_all', 'edge')
    for role in ('src','dst'):
        node_rows += full_node[role].rows('HI_all', role)
    categories += [dict(domain='HI_all', format=name, rows=int(full_formats[j]),
                        fraction=float(full_formats[j]/observed)) for j,name in enumerate(FORMAT_NAMES)]
    # Separate full-period unique-account table, unlike the split-mixed query table.
    nodes = load(G/'nodes/2022-10-31.npy')
    account_rows += node_stats(nodes, ((full_src+full_dst)>0).astype(np.int64)).rows('HI_all', 'unique_active_account')
    coverage.append(dict(domain='HI_all', rows=observed, id_slots=len(present),
                         excluded_id_slots=int(len(present)-observed),
                         active_query_accounts=int(((full_src+full_dst)>0).sum()),
                         snapshot_date='query: each split end; account: 2022-10-31'))

    edge, nodes = load(FULL/'cache/edge22.npy'), load(FULL/'cache/nodes19.npy')
    src, dst = load(SG/'src.npy'), load(SG/'dst.npy')
    ports = [load(FULL/f'cache/{role}_ports.npy') for role in ('incoming','outgoing')]
    counts = {role: np.zeros(len(nodes), np.int64) for role in ('src','dst')}
    stats, format_counts = Stats(EDGE), np.zeros(8, np.int64)
    for start in range(0,len(edge),CHUNK):
        stop = min(start+CHUNK,len(edge))
        block = np.asarray(edge[start:stop])
        assert ((block[:,14:] == 0) | (block[:,14:] == 1)).all()
        assert (block[:,14:].sum(axis=1) == 1).all()
        format_counts += block[:,14:].sum(axis=0,dtype=np.int64)
        stats.update(np.column_stack([block[:,:14],ports[0][start:stop],ports[1][start:stop]]).astype(np.float32))
        for role, a in [('src',src),('dst',dst)]:
            counts[role] += np.bincount(a[start:stop],minlength=len(nodes))
        event('scan', domain='SAML_all', completed=stop, total=len(edge))
    assert stats.count == 9504852 == int(format_counts.sum())
    numeric += stats.rows('SAML_all', 'edge')
    for role in ('src','dst'):
        assert counts[role].sum() == len(edge)
        node_rows += node_stats(nodes,counts[role]).rows('SAML_all',role)
    active = (counts['src']+counts['dst'])>0
    account_rows += node_stats(nodes,active.astype(np.int64)).rows('SAML_all','unique_active_account')
    categories += [dict(domain='SAML_all',format=name,rows=int(format_counts[j]),
                       fraction=float(format_counts[j]/len(edge))) for j,name in enumerate(FORMAT_NAMES)]
    coverage.append(dict(domain='SAML_all',rows=len(edge),active_query_accounts=int(active.sum()),
                         snapshot_date='2023-08-23 full period end'))
    # Cross-check separate existing full-population categorical audit.
    with (FULL/'결측_분포진단_20261106/HI_payment_population.csv').open() as f:
        for row in csv.DictReader(f):
            match=next(r for r in categories if r['domain']==row['domain'] and r['format']==row['format'])
            assert match['rows'] == int(row['rows'])
    assert format_counts[7] == 2946034
    for record in numeric:
        if record['domain']=='SAML_all' and record['feature'] in ('same_known_country','both_countries_known','is_self_transfer'):
            assert record['zero_count'] == record['rows']
    for record in node_rows:
        if record['domain']=='SAML_all' and record['feature'] in NODE_NAMES[10:]:
            assert record['zero_count'] == record['rows']
    for path, meta in INPUTS.items():
        st = Path(path).stat()
        assert (st.st_size,st.st_mtime_ns) == (meta['size'],meta['mtime_ns'])
    save_csv('edge_full_statistics.csv',numeric)
    save_csv('node_query_full_statistics.csv',node_rows)
    save_csv('node_account_full_statistics.csv',account_rows)
    save_csv('payment_full_distribution.csv',categories)
    write('input_manifest.json',INPUTS)
    write('coverage.json',coverage)
    write('verification.json',dict(all_passed=True, hi_rows=observed, saml_rows=len(edge),
          exact_full_census=True, finite_all_input_values=True, source_file_stats_unchanged=True,
          hi_split_ids_unique_present_disjoint_and_cover_all=True,
          hi_existing_payment_audit_matches=True, saml_unknown_count_matches=True,
          zero_filled_columns_verified=True, no_training_or_inference=True,
          node_query_stats_weighted_by_exact_endpoint_counts=True,
          elapsed_seconds=time.monotonic()-START))
    event('complete', hi_rows=observed,saml_rows=len(edge))

if __name__=='__main__':
    main()
