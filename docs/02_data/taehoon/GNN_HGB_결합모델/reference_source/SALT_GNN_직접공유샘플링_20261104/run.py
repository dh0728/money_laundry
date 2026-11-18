"""Manual finite Train -> full Val -> frozen full Test pipeline; no scheduler."""
import argparse
import fcntl
import os
import time
from pathlib import Path

from salt_daily.config import ROOT, RUN, FRAUDGT_RUN
from salt_daily.storage import read_json, write_json, sha, log, utc


def verify_ready():
    protocol = read_json(ROOT/'protocol.json')
    result = read_json(ROOT/'preflight.json')
    manifest = read_json(ROOT/'code_manifest.json')
    assert result['status'] == 'pass' and result['protocol_sha256'] == sha(ROOT/'protocol.json')
    assert result['code_manifest'] == manifest
    for name, digest in manifest.items():
        assert sha(ROOT/name) == digest, f'Code changed after validation: {name}'
    for name, digest in protocol['source_manifest'].items():
        assert sha(name) == digest, f'Input changed: {name}'
    assert sha(ROOT/'cache/population/population.json') == protocol['population_manifest_sha256']
    for item in protocol['cohorts'].values():
        for name, digest in item['files'].items():
            assert sha(ROOT/'cache/population'/name) == digest, f'Population changed: {name}'
    for name, recorded in result['input_file_stats'].items():
        stat = Path(name).stat()
        assert dict(size=stat.st_size, mtime_ns=stat.st_mtime_ns) == recorded, f'Data cache changed: {name}'
    return protocol


def lock_held(path):
    if not path.exists():
        return False
    with path.open('r+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True


def wait_for_existing_work():
    reference = ROOT.parent/'SALT_GNN_공유그래프_payment_port_20261104/runs/daily_close_001/run.lock'
    assert not lock_held(reference), 'Previous shared-graph experiment must remain paused'
    prior = ROOT.parent/'SALT_GNN_payment_port_GPU확대_20261104/runs/daily_close_001/run.lock'
    assert not lock_held(prior), 'Previous disjoint payment/port experiment must remain paused'
    previous = ROOT.parent/'SALT_GNN_전체거래_일별배치_20261103/runs/daily_close_001/run.lock'
    assert not lock_held(previous), 'Preserved no-format/no-port experiment must remain paused'
    old = Path('/workspace/handoff/SALT_GNN_논문설정_일별배치_20261103/runs/daily_close_001/run.lock')
    assert not lock_held(old), 'Old IPW experiment is running; do not run both versions'
    queue = FRAUDGT_RUN/'evaluations/alltargets_queue_20261103/queue.lock'
    evaluations = FRAUDGT_RUN/'evaluations'
    paths = [queue] + [evaluations/f'{name}_alltargets_fulltest_20261103/run.lock'
                       for name in ('basic', 'pe', 'multi')]
    while any(lock_held(path) for path in paths):
        log(RUN, 'waiting_for_fraudgt', pid=os.getpid(), training_started=False)
        time.sleep(10)


def run(device):
    RUN.mkdir(parents=True, exist_ok=True)
    with (RUN/'run.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        protocol = verify_ready()
        if (RUN/'complete.json').exists():
            assert read_json(RUN/'complete.json')['protocol_sha256'] == sha(ROOT/'protocol.json')
            print('Full experiment already complete')
            return
        log(RUN, 'job_started', pid=os.getpid(), manual_launch=True, population_ipw=False)
        wait_for_existing_work()
        from salt_daily.data import DailyData
        loader = DailyData(device=device)
        run_pipeline(protocol, loader, device)


def run_pipeline(protocol, loader, device):
    from salt_daily.training import train_variant, evaluate_scope, freeze_selection, evaluate_variant
    early = protocol['evaluation'].get('independent_variants', [])
    assert set(early).issubset(protocol['variants'])
    for variant in protocol['variants']:
        log(RUN, 'variant_started', variant=variant, pid=os.getpid())
        train_variant(variant, protocol, loader, device)
        if variant in early:
            log(RUN, 'variant_final_evaluation_started', variant=variant, before_other_models=True)
            evaluate_variant(protocol, loader, variant, device)
    validation = evaluate_scope(protocol, loader, 'validation', device)
    selection = freeze_selection(protocol, validation)
    test = evaluate_scope(protocol, loader, 'test', device)
    write_json(RUN/'complete.json', dict(status='complete', completed_utc=utc(),
        protocol_sha256=sha(ROOT/'protocol.json'), selection=selection, validation=validation,
        test=test, independently_evaluated_variants=early, full_population_certified=True, population_ipw=False))
    log(RUN, 'experiment_complete', full_population_certified=True, test_evaluated=True)


def evaluate_one(variant, device):
    """Standalone resumable final evaluation; never races a training worker."""
    from salt_daily.training import require_trained_variant, evaluate_variant
    RUN.mkdir(parents=True, exist_ok=True)
    with (RUN/'run.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        protocol = verify_ready()
        require_trained_variant(protocol, variant)
        wait_for_existing_work()
        from salt_daily.data import DailyData
        loader = DailyData(device=device)
        return evaluate_variant(protocol, loader, variant, device)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('prepare', 'validate', 'run', 'evaluate', 'status'))
    parser.add_argument('--device', choices=('cpu', 'cuda'), default=None)
    parser.add_argument('--variant', choices=('A3', 'A0', 'A1', 'A2'), default='A3')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            from salt_daily.prepare import prepare
            result = prepare()
            print({name: item['rows'] for name, item in result['cohorts'].items()})
        elif args.command == 'validate':
            from salt_daily.validate import validate
            print(validate(args.device or 'cpu')['status'])
        elif args.command == 'run':
            run(args.device or 'cuda')
        elif args.command == 'evaluate':
            result = evaluate_one(args.variant, args.device or 'cuda')
            print({scope: result[scope]['scored'] for scope in ('validation', 'test')})
        else:
            print((RUN/'status.json').read_text() if (RUN/'status.json').exists() else 'Paused; not started')
    except BaseException as error:
        if args.command in ('run', 'evaluate'):
            log(RUN, 'job_stopped', error_type=type(error).__name__, detail=str(error)[:1000])
        raise
