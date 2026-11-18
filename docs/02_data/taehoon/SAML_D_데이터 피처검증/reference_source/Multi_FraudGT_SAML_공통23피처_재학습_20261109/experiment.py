"""Frozen common-feature ablation, independent of all existing training runs."""
import os
from pathlib import Path
OUT = Path(__file__).resolve().parent
os.environ['AML_RUN_DIR'] = str(OUT/'runs/common23_001')
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '2'
import csv, fcntl, hashlib, json, signal, sys
from datetime import datetime, timezone
from contextlib import contextmanager
from dataclasses import asdict
import numpy as np
import torch
from fraudgt_lab import RUN_ROOT as RUN
from fraudgt_lab.config import TrainConfig, EDGE_INDICES, digest
from fraudgt_lab.storage import write_json as write

BASE = OUT.parent
ORIGINAL = BASE/'V10_FraudGT_조건수정_20261027'
ORUN = ORIGINAL/'runs/shared_corrected_001'
BASELINE = ORUN/'models/multi_fraudgt_format/best.pt'
HI_TEST = ORUN/'evaluations/multi_alltargets_fulltest_20261103'
SAML = BASE/'Multi_FraudGT_SAML_D_전체평가_20261106'
SALT = BASE/'SALT_GNN_직접공유샘플링_20261104'
VARIANT = 'multi_fraudgt_format'
MAX_EPOCHS = 284  # Keep the original 500-epoch LR schedule, matching completed budget.
NODE_KEEP = tuple(range(10)) + (19,)  # Ten observable attributes plus ego mask.
EDGE_KEEP = tuple(i for i in range(22) if i not in (10, 11))
STOP = False

def read(path): return json.loads(Path(path).read_text())
def utc(): return datetime.now(timezone.utc).isoformat()
def config(): return TrainConfig(**read(ORUN/'protocol.json')['training'])

def event(name, **values):
    record = dict(utc=utc(), event=name, pid=os.getpid(), **values)
    with (OUT/'events.jsonl').open('a') as f: f.write(json.dumps(record, ensure_ascii=False)+'\n')
    write(OUT/'status.json', record)
    print(json.dumps(record, ensure_ascii=False), flush=True)

class StopRequested(Exception): pass
def request_stop(*unused):
    global STOP
    STOP = True
def stop_check():
    if STOP: raise StopRequested('Stopped after a committed checkpoint or inference chunk')
def install_signals():
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

def lock_held(path):
    path = Path(path)
    if not path.exists(): return False
    with path.open('r') as f:
        try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return True
        fcntl.flock(f, fcntl.LOCK_UN)
    return False

def ensure_salt_paused():
    assert not lock_held(SALT/'runs/daily_close_001/run.lock'), 'SALT was resumed; pause this experiment before sharing GPU'
    # Also detect SALT startup, before its run lock is acquired.
    for p in Path('/proc').iterdir():
        if not p.name.isdigit(): continue
        try:
            argv = (p/'cmdline').read_bytes().decode().split('\0')
            if str(SALT/'run.py') in argv:
                index = argv.index(str(SALT/'run.py'))
                assert argv[index+1] not in ('run', 'evaluate'), 'SALT worker is active'
        except (OSError, UnicodeDecodeError, IndexError): pass

@contextmanager
def run_lock():
    with (OUT/'run.lock').open('a') as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ensure_salt_paused()
        yield

def code_manifest():
    files = list(OUT.glob('*.py')) + list((OUT/'fraudgt_lab').glob('*.py')) + list((OUT/'fraudgt_lab').glob('*.c'))
    return {str(p.relative_to(OUT)): digest(p) for p in sorted(files)}

def verify_contract():
    ensure_salt_paused()
    plan = read(OUT/'plan.json')
    assert code_manifest() == read(OUT/'code_manifest.json'), 'Code changed after plan freeze'
    for path, sha in plan['preserved'].items():
        assert digest(path) == sha, f'Preserved artifact changed: {path}'
    for path, info in plan['input_file_stats'].items():
        stat = Path(path).stat()
        assert (stat.st_size, stat.st_mtime_ns) == (info['bytes'], info['mtime_ns']), path
    return plan

def initialize():
    assert not (OUT/'plan.json').exists(), 'Do not replace a frozen plan'
    ensure_salt_paused()
    c = config()
    assert c.epochs == 500 and c.seed == 42 and c.readout == 'official'
    contract_path = ORIGINAL/'project/experiments/v10_daily_fixed_20261024/input_contract.json'
    contract = read(contract_path)
    nodes = contract['node_features']
    edge = [contract['edge_features'][i] for i in EDGE_INDICES]
    assert nodes[10].startswith('type_') and edge[10:12] == ['same_known_country', 'both_countries_known']
    records = []
    for role, names in [('node', nodes), ('edge', edge), ('edge', ['payment_format'])]:
        for name in names:
            keep = name in nodes[:10] or name in [v for i,v in enumerate(edge) if i not in (10,11)] or name == 'payment_format'
            records.append(dict(feature=name, role=role, retained=keep, scalar_columns=8 if name=='payment_format' else 1,
                saml_availability='observed; unsupported categories remain Unknown' if name=='payment_format' else ('observed' if keep else 'unavailable; removed from both HI and SAML model inputs')))
    assert len(records) == 34 and sum(r['retained'] for r in records) == 23
    with (OUT/'피처_포함제외.csv').open('w', encoding='utf-8-sig', newline='') as f:
        w=csv.DictWriter(f, fieldnames=records[0]);w.writeheader();w.writerows(records)
    small = [BASELINE, ORUN/'protocol.json', ORUN/'models/multi_fraudgt_format/history.json',
        HI_TEST/'request.json', HI_TEST/'result.json', SAML/'result.json', SAML/'protocol.json', SAML/'cache/complete.json',
        SALT/'protocol.json', SALT/'code_manifest.json', SALT/'runs/daily_close_001/models/A1/last.pt', contract_path]
    preserved = {str(p):digest(p) for p in small}
    assert preserved[str(BASELINE)] == '42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'
    # Reuse exact original populations/permutations and cache artifacts.
    paths = list((ORIGINAL/'assets').glob('*.npy')) + list((ORIGINAL/'assets/orders').glob('*.npy'))
    test_order = Path(read(HI_TEST/'request.json')['ordered_test_ids_path'])
    paths += [test_order, SAML/'cache/order.npy', SAML/'cache/logits.npy', SAML/'cache/labels.npy']
    for name, info in read(SAML/'cache/complete.json')['generated'].items(): paths.append(SAML/'cache'/name)
    for name in read(SAML/'cache/complete.json')['inputs']: paths.append(Path(name))
    inputs = {str(p):dict(bytes=p.stat().st_size,mtime_ns=p.stat().st_mtime_ns) for p in paths}
    original_manifest = read(ORUN/'code_manifest.json')
    for name, expected in original_manifest.items():
        if name.startswith('fraudgt_lab/'):
            assert digest(OUT/name) == expected, name
    plan = dict(created_utc=utc(),name='Multi-FraudGT common 23 features, trained from scratch on HI-Large',
        hypothesis='Removing attributes systematically unavailable on SAML during both training and inference improves external ranking and/or reduces false alarms.',
        features=dict(original_types=34,retained_types=23,removed_types=11,removed_fraction=11/34,
            node_features=nodes[:10],numeric_edge_features=[v for i,v in enumerate(edge) if i not in (10,11)],
            payment_encoding='Unchanged HI 7 categories plus Unknown, 8 one-hot columns; Debit card/Cross-border remain Unknown',
            node_tensor_columns=11,edge_tensor_columns_without_port=20,port_columns_per_relation=1,
            node_keep=list(NODE_KEEP),edge_keep=list(EDGE_KEEP),removed=[r['feature'] for r in records if not r['retained']]),
        training=asdict(c),completed_epoch_budget=MAX_EPOCHS,lr_schedule_horizon=500,
        initialization='Fresh seed42 original initializer, then physically slice input encoder columns; retain same initial common/downstream weights and CPU RNG state. No trained checkpoint initialization.',
        selection='Highest HI Validation official-readout F1 at p>0.5 among epochs 1,4,8,...,284; strict improvement, same as baseline',
        splits=read(ORUN/'protocol.json')['splits']['windows'],
        final_evaluation=dict(primary_threshold_probability=.5,positive_rule='logit > 0',readout='all_targets',
            hi_test_rows=33429507,saml_rows=9504852,saml_positive=9873,
            graph='Same native split-end cumulative HI graph and full-period SAML graph as the archived baseline',
            sampling='Same PyG shared2048, fanout[50,50], uniform without replacement, forward and reverse; same original order and global sampler index',
            hi_test_order=str(test_order),saml_order=str(SAML/'cache/order.npy'),
            baseline_hi_scores=str(HI_TEST/'chunks'),baseline_saml_scores=str(SAML/'cache/logits.npy'),
            metrics=['AP','ROC_AUC','precision','recall','F1','FP','FPR','TP','FN','TN','SAML pattern recall/FPR']),
        execution=dict(gpu_memory_fraction=.90,lossless_cuda_feature_lookup=True,training_sampler_prefetch=False,
            optimizer_boundary_checkpoint_every_batches=8,salt_stays_paused=True),
        preserved=preserved,input_file_stats=inputs,
        limitations=['One seed and a reduced input parameter count; this is evidence about dependence on unavailable features, not a full causal decomposition.',
            'HI and SAML have already been inspected. Results are exploratory and are not a pristine unseen-holdout claim.',
            'Payment schema, pattern distribution, observation horizon and graph differences remain. Improvement cannot establish missingness as the only cause.',
            'Original 284 completed epochs used a 500-epoch cosine horizon; matching 284 epochs must not compress that horizon.',
            'Native split-end graphs contain later observed transactions within each period; this is not real-time causal scoring.'],
        saml_labels_used_for_training_or_selection=False,test_used_for_selection=False)
    RUN.mkdir(parents=True,exist_ok=True)
    write(OUT/'plan.json',plan);write(RUN/'protocol.json',plan)
    write(OUT/'code_manifest.json',code_manifest())
    verify_contract();event('plan_frozen',plan_sha256=digest(OUT/'plan.json'))

if __name__ == '__main__': initialize()
