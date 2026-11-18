"""Full daily epochs and full unweighted evaluation, with atomic resume."""
import random
import signal
import time

import numpy as np
import torch
import torch.nn.functional as F

from .config import ROOT, RUN
from .storage import read_json, write_json, sha, log, utc, memory
from .data import cohort, daily_orders, date, tensors, cleanup
from .model import DailySALT, model_kwargs
from .metrics import summarize
from .evaluation import score


class StopRequested(Exception):
    pass


class StopSignals:
    def __enter__(self):
        self.requested = False
        def stop(signum, frame):
            self.requested = True
        self.handlers = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
        return self

    def check(self):
        if self.requested:
            raise StopRequested('Stopped at a committed training/evaluation boundary')

    def __exit__(self, *args):
        for sig, handler in self.handlers.items():
            signal.signal(sig, handler)


def save_checkpoint(path, state):
    temporary = path.with_suffix('.tmp')
    torch.save(state, temporary)
    temporary.replace(path)


def loss_denominator(labels, positive_weight=7):
    labels = np.asarray(labels) > 0
    return float(len(labels) + (positive_weight-1)*labels.sum())


def microbatch_loss(logits, labels, logical_denominator, positive_weight=7):
    """Sum parts against ONE logical denominator, matching weighted CE mean."""
    return F.cross_entropy(logits, labels, weight=logits.new_tensor([1., positive_weight]),
                           reduction='sum') / logical_denominator


def resource_guard(folder, variant, boundary):
    from pathlib import Path
    value = memory()
    if isinstance(value['memory.max'], int):
        stats = dict(line.split() for line in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines())
        if int(stats['anon']) > value['memory.max'] - 1024**3:
            raise RuntimeError(f'Insufficient anonymous-memory headroom at {variant} {boundary}; resume checkpoint')


def expected_epoch_updates(train, state, batch_size):
    """Keep committed old-batch updates and count the exact remaining batches."""
    spans = train.meta['spans']
    cursor, offset = state['day_cursor'], state['logical_cursor']
    assert 0 <= cursor <= len(spans)
    if cursor == len(spans):
        assert offset == 0
    else:
        assert 0 <= offset <= spans[cursor]['stop']-spans[cursor]['start']
    completed = sum(s['stop']-s['start'] for s in spans[:cursor]) + offset
    assert completed == state['epoch_targets'], 'Resume cursor disagrees with committed target count'
    remaining = [s['stop']-s['start']-(offset if i == cursor else 0)
                 for i, s in enumerate(spans) if i >= cursor]
    return state['epoch_updates'] + sum((n+batch_size-1)//batch_size for n in remaining)


def train_variant(variant, protocol, loader, device='cuda'):
    folder = RUN/'models'/variant
    folder.mkdir(parents=True, exist_ok=True)
    protocol_hash = sha(ROOT/'protocol.json')
    signature = read_json(ROOT/'code_manifest.json')
    if (folder/'complete.json').exists():
        done = read_json(folder/'complete.json')
        assert done['protocol_sha256'] == protocol_hash and done['code_manifest'] == signature
        assert done['checkpoint_sha256'] == sha(folder/'best.pt')
        return
    seed = protocol['training']['seed']
    torch.set_num_threads(1); torch.manual_seed(seed); np.random.seed(seed); random.seed(seed)
    if device == 'cuda':
        torch.cuda.manual_seed_all(seed)
        torch.cuda.set_per_process_memory_fraction(protocol['training'].get('cuda_memory_fraction', .09))
    delta = read_json(ROOT/'calibration.json')['delta']
    model = DailySALT(variant, **model_kwargs(protocol, delta)).to(device)
    optimizer = torch.optim.Adam((p for p in model.parameters() if p.requires_grad),
                                 lr=protocol['training']['learning_rates_primary'][0])
    train, monitor = cohort('train_gnn'), cohort('monitor')
    config = protocol['training']
    epochs, batch_size = config['epochs_primary'], config['logical_batch']
    state = dict(epoch=1, day_cursor=0, logical_cursor=0, phase='train', history=[],
                 best={'F1': -1., 'AP': -1., 'epoch': 0}, epoch_targets=0, epoch_updates=0,
                 loss_sum=0., loss_weight_sum=0., epoch_train_seconds=0.)
    if (folder/'last.pt').exists():
        saved = torch.load(folder/'last.pt', map_location='cpu', weights_only=False)
        assert saved['protocol_sha256'] == protocol_hash and saved['code_manifest'] == signature
        assert saved['population_ipw'] is False
        model.load_state_dict(saved['model']); optimizer.load_state_dict(saved['optimizer'])
        state = saved['progress']; torch.set_rng_state(saved['rng_cpu'])
        if device == 'cuda':
            torch.cuda.set_rng_state_all(saved['rng_cuda'])
        del saved
    def save():
        save_checkpoint(folder/'last.pt', dict(model=model.state_dict(), optimizer=optimizer.state_dict(),
            progress=state, protocol_sha256=protocol_hash, code_manifest=signature, population_ipw=False,
            rng_cpu=torch.get_rng_state(), rng_cuda=torch.cuda.get_rng_state_all() if device == 'cuda' else []))
    log(folder, 'training_started', variant=variant, epoch=state['epoch'], phase=state['phase'],
        day_cursor=state['day_cursor'], logical_cursor=state['logical_cursor'], requested=state['epoch_targets'],
        total=len(train), full_epoch=True, population_ipw=False)
    try:
        with StopSignals() as stop:
            while state['epoch'] <= epochs:
                epoch = state['epoch']
                for group in optimizer.param_groups:
                    group['lr'] = config['learning_rates_primary'][epoch-1]
                if state['phase'] == 'train':
                    expected_updates = expected_epoch_updates(train, state, batch_size)
                    model.train()
                    day_start = state['day_cursor']
                    orders = daily_orders(train, epoch, start_day_cursor=day_start)
                    for day_cursor, (day, order) in enumerate(orders, start=day_start):
                        stop.check(); loader.set_day(day)
                        offset = state['logical_cursor'] if day_cursor == state['day_cursor'] else 0
                        for start in range(offset, len(order), batch_size):
                            stop.check(); resource_guard(folder, variant, 'before_logical_batch')
                            begin = time.monotonic(); logical = order[start:start+batch_size]
                            denominator = loss_denominator(train['y'][logical], config['positive_weight'])
                            optimizer.zero_grad(set_to_none=True)
                            loss_value = 0.; actual = max_nodes = max_edges = 0
                            microbatches_used = max_microbatch_targets = 0
                            prepare_seconds = model_seconds = 0.
                            previous = time.monotonic()
                            if device == 'cuda': torch.cuda.reset_peak_memory_stats()
                            for take, arrays, metadata in loader.microbatches(train, logical,
                                    microbatch=config['microbatch_max'], max_edges=config['max_edges_per_microbatch']):
                                ready = time.monotonic(); prepare_seconds += ready-previous
                                batch = tensors(arrays, device)
                                labels = torch.as_tensor(train['y'][take] > 0, dtype=torch.long, device=device)
                                logits = model(*batch, return_logits=True)
                                assert logits.shape == (len(labels), 2) and torch.isfinite(logits).all()
                                loss = microbatch_loss(logits, labels, denominator, config['positive_weight'])
                                assert torch.isfinite(loss)
                                loss.backward(); loss_value += float(loss.detach()); actual += len(take)
                                microbatches_used += 1; max_microbatch_targets = max(max_microbatch_targets, len(take))
                                max_nodes = max(max_nodes, metadata['nodes']); max_edges = max(max_edges, metadata['edges'])
                                del batch, labels, logits, loss, arrays
                                previous = time.monotonic(); model_seconds += previous-ready
                            assert actual == len(logical)
                            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), config['gradient_clip'], error_if_nonfinite=True)
                            optimizer.step()
                            state['epoch_targets'] += actual; state['epoch_updates'] += 1
                            state['loss_sum'] += loss_value*denominator; state['loss_weight_sum'] += denominator
                            state['epoch_train_seconds'] += time.monotonic()-begin
                            state['day_cursor'] = day_cursor; state['logical_cursor'] = start+actual
                            save(); cleanup()
                            batch_wall_seconds = time.monotonic()-begin
                            log(folder, 'training_progress', variant=variant, epoch=epoch, day=date(day),
                                phase='train', requested=state['epoch_targets'], scored=state['epoch_targets'], total=len(train),
                                optimizer_updates=state['epoch_updates'], loss=loss_value, gradient_norm=float(norm),
                                train_seconds=state['epoch_train_seconds'], max_microbatch_nodes=max_nodes,
                                max_microbatch_edges=max_edges, microbatches_used=microbatches_used,
                                max_microbatch_targets=max_microbatch_targets, memory=memory(),
                                batch_targets=actual, batch_wall_seconds=batch_wall_seconds,
                                prepare_seconds=prepare_seconds, model_seconds=model_seconds,
                                cuda_peak_allocated_bytes=torch.cuda.max_memory_allocated() if device == 'cuda' else 0,
                                cuda_allocated_bytes=torch.cuda.memory_allocated() if device == 'cuda' else 0,
                                cuda_reserved_bytes=torch.cuda.memory_reserved() if device == 'cuda' else 0)
                            stop.check()
                        state['day_cursor'] = day_cursor+1; state['logical_cursor'] = 0; save()
                    assert state['epoch_targets'] == len(train)
                    assert state['epoch_updates'] == expected_updates
                    state['phase'] = 'monitor'; save()
                scores, seconds = score(model, monitor, loader, device, folder, 'monitor', epoch, stop.check)
                log(folder, 'aggregating_metrics', variant=variant, scope='monitor', epoch=epoch,
                    scored=len(monitor), requested=len(monitor))
                metrics = summarize(monitor['y'], scores, monitor['ids'], detailed=False)
                metrics.update(epoch=epoch, train_requested=state['epoch_targets'], train_scored=state['epoch_targets'],
                    optimizer_updates=state['epoch_updates'], train_seconds=state['epoch_train_seconds'],
                    monitor_seconds=seconds, mean_loss=state['loss_sum']/state['loss_weight_sum'])
                if metrics['F1'] > state['best']['F1']:
                    state['best'] = dict(F1=metrics['F1'], AP=metrics['AP'], epoch=epoch)
                    save_checkpoint(folder/'best.pt', dict(model=model.state_dict(), variant=variant, epoch=epoch,
                        protocol_sha256=protocol_hash, code_manifest=signature, monitor=metrics, delta=delta,
                        population_ipw=False))
                state['history'].append(metrics); write_json(folder/'history.json', state['history'])
                log(folder, 'epoch_complete', variant=variant, best=state['best'], **metrics)
                state.update(epoch=epoch+1, phase='train', day_cursor=0, logical_cursor=0, epoch_targets=0,
                             epoch_updates=0, loss_sum=0., loss_weight_sum=0., epoch_train_seconds=0.)
                save(); stop.check()
        write_json(folder/'complete.json', dict(status='complete', epochs=epochs, best=state['best'],
            protocol_sha256=protocol_hash, code_manifest=signature, checkpoint_sha256=sha(folder/'best.pt'),
            coverage=1., completed_utc=utc(), total_training_targets=len(train)*epochs))
        log(folder, 'training_complete', variant=variant, best=state['best'])
    except BaseException as error:
        log(folder, 'interrupted' if isinstance(error, StopRequested) else 'training_error',
            variant=variant, error_type=type(error).__name__, detail=str(error)[:700])
        raise
    finally:
        del model, optimizer; cleanup()
        if device == 'cuda':
            torch.cuda.empty_cache()


def require_trained_variant(protocol, variant):
    """Final evaluation uses a completed Train/Monitor run, never a partial epoch."""
    if variant not in protocol['variants']:
        raise ValueError(f'Unknown variant: {variant}')
    folder = RUN/'models'/variant
    if not (folder/'complete.json').exists():
        raise RuntimeError(f'{variant}: finish all training epochs and Monitor before final Val/Test')
    done = read_json(folder/'complete.json')
    assert done['status'] == 'complete' and done['epochs'] == protocol['training']['epochs_primary']
    assert done['protocol_sha256'] == sha(ROOT/'protocol.json')
    assert done['code_manifest'] == read_json(ROOT/'code_manifest.json')
    assert done['checkpoint_sha256'] == sha(folder/'best.pt'), 'Completed checkpoint changed'
    return done


def _checked_validation(protocol, variant, validation):
    done = require_trained_variant(protocol, variant)
    folder = RUN/'models'/variant
    assert validation == read_json(folder/'validation.json'), 'Validation record changed'
    assert validation['variant'] == variant and validation['scope'] == 'validation'
    assert validation['requested'] == validation['scored'] == len(cohort('validation'))
    assert validation['coverage'] == 1.
    assert validation['protocol_sha256'] == sha(ROOT/'protocol.json')
    assert validation['code_manifest'] == read_json(ROOT/'code_manifest.json')
    assert validation['checkpoint_sha256'] == done['checkpoint_sha256']
    return done


def _variant_freeze_record(protocol, variant, validation):
    done = _checked_validation(protocol, variant, validation)
    folder = RUN/'models'/variant
    return dict(scope='variant', variant=variant, protocol_sha256=sha(ROOT/'protocol.json'),
                code_manifest=read_json(ROOT/'code_manifest.json'),
                checkpoint_sha256=done['checkpoint_sha256'],
                training_complete_sha256=sha(folder/'complete.json'),
                validation_sha256=sha(folder/'validation.json'),
                checkpoint_selection='full Monitor F1 at fixed probability 0.5; earliest epoch tie',
                test_policy='this variant only; checkpoint and full Val locked before its Test')


def freeze_variant(protocol, variant, validation):
    """Freeze one finished model without requiring any other model's checkpoint."""
    item = _variant_freeze_record(protocol, variant, validation)
    path = RUN/'models'/variant/'evaluation_frozen.json'
    if path.exists():
        assert read_json(path) == item, 'Frozen variant evaluation changed'
    else:
        write_json(path, item)
    return item


def _test_authorization(protocol, variant):
    """Check local/global freezes before opening the Test population or scores."""
    folder = RUN/'models'/variant
    local = folder/'evaluation_frozen.json'
    global_path = RUN/'selection_frozen.json'
    if not local.exists() and not global_path.exists():
        raise RuntimeError(f'{variant}: freeze the checkpoint and full Val before Test')
    if local.exists():
        expected = _variant_freeze_record(protocol, variant, read_json(folder/'validation.json'))
        assert read_json(local) == expected, 'Frozen variant evaluation changed'
    if global_path.exists():
        frozen = read_json(global_path)
        assert frozen['protocol_sha256'] == sha(ROOT/'protocol.json')
        assert frozen['code_manifest'] == read_json(ROOT/'code_manifest.json')
        assert frozen['checkpoints'][variant] == sha(folder/'best.pt')
        assert frozen['validation_files'][variant] == sha(folder/'validation.json')
    path = local if local.exists() else global_path
    return dict(scope='variant' if local.exists() else 'global', sha256=sha(path))


def evaluate_scope(protocol, loader, scope, device='cuda', variants=None):
    assert scope in ('validation', 'test')
    selected = list(protocol['variants'] if variants is None else variants)
    assert selected and len(selected) == len(set(selected)), 'Empty/duplicate evaluation variants'
    freezes = {}
    for variant in selected:
        require_trained_variant(protocol, variant)
        if scope == 'test':
            freezes[variant] = _test_authorization(protocol, variant)
    if device == 'cuda':
        torch.cuda.set_per_process_memory_fraction(protocol['training'].get('cuda_memory_fraction', .09))
    data = cohort(scope); results = {}
    with StopSignals() as stop:
        for variant in selected:
            stop.check(); folder = RUN/'models'/variant
            checkpoint_sha = sha(folder/'best.pt')
            if (folder/f'{scope}.json').exists():
                result = read_json(folder/f'{scope}.json')
                assert result['variant'] == variant and result['scope'] == scope
                assert result['checkpoint_sha256'] == checkpoint_sha
                assert result['protocol_sha256'] == sha(ROOT/'protocol.json')
                assert result['code_manifest'] == read_json(ROOT/'code_manifest.json')
                assert result['requested'] == result['scored'] == len(data) and result['coverage'] == 1.
                if scope == 'test':
                    assert result['test_authorization'] == freezes[variant]
                results[variant] = result
                continue
            saved = torch.load(folder/'best.pt', map_location='cpu', weights_only=False)
            assert saved['protocol_sha256'] == sha(ROOT/'protocol.json')
            assert saved['code_manifest'] == read_json(ROOT/'code_manifest.json')
            assert saved['population_ipw'] is False
            model = DailySALT(variant, **model_kwargs(protocol, saved['delta'])).to(device)
            model.load_state_dict(saved['model'])
            scores, seconds = score(model, data, loader, device, folder, scope, saved['epoch'], stop.check)
            log(folder, 'aggregating_metrics', variant=variant, scope=scope,
                epoch=saved['epoch'], scored=len(data), requested=len(data))
            result = summarize(data['y'], scores, data['ids'])
            daily = []
            for span in data.meta['spans']:
                section = slice(span['start'], span['stop'])
                if span['start'] != span['stop']:
                    daily.append(dict(day=date(span['day']), **summarize(data['y'][section],
                                      scores[section], data['ids'][section], detailed=False)))
            result.update(variant=variant, scope=scope, checkpoint_epoch=saved['epoch'],
                checkpoint_sha256=checkpoint_sha, protocol_sha256=sha(ROOT/'protocol.json'),
                code_manifest=read_json(ROOT/'code_manifest.json'),
                threshold_policy='fixed_probability_0.5', seconds=seconds, daily=daily,
                test_evaluated=scope == 'test')
            if scope == 'test':
                result['test_authorization'] = freezes[variant]
            write_json(folder/f'{scope}.json', result); results[variant] = result
            log(folder, f'{scope}_complete', variant=variant, scored=len(data), requested=len(data))
            del model, saved, scores; cleanup()
            if device == 'cuda':
                torch.cuda.empty_cache()
    return results


def evaluate_variant(protocol, loader, variant='A3', device='cuda'):
    """Full Val -> immutable local freeze -> full Test for one completed model."""
    validation = evaluate_scope(protocol, loader, 'validation', device, variants=[variant])[variant]
    frozen = freeze_variant(protocol, variant, validation)
    test = evaluate_scope(protocol, loader, 'test', device, variants=[variant])[variant]
    folder = RUN/'models'/variant
    item = dict(status='complete', variant=variant, protocol_sha256=sha(ROOT/'protocol.json'),
                code_manifest=read_json(ROOT/'code_manifest.json'),
                checkpoint_sha256=frozen['checkpoint_sha256'],
                validation_sha256=sha(folder/'validation.json'), test_sha256=sha(folder/'test.json'),
                freeze_sha256=sha(folder/'evaluation_frozen.json'),
                validation_scored=validation['scored'], test_scored=test['scored'], full_population_certified=True)
    path = folder/'evaluation_complete.json'
    if path.exists():
        assert read_json(path) == item, 'Completed variant evaluation changed'
    else:
        write_json(path, item)
    log(folder, 'variant_evaluation_complete', variant=variant, validation_scored=validation['scored'], test_scored=test['scored'])
    return dict(validation=validation, frozen=frozen, test=test)


def freeze_selection(protocol, validation):
    """Freeze the overall winner using full Val only; early local Test is reusable."""
    for variant in protocol['variants']:
        _checked_validation(protocol, variant, validation[variant])
        if (RUN/'models'/variant/'evaluation_frozen.json').exists():
            _test_authorization(protocol, variant)
    selected = max(protocol['variants'], key=lambda v: validation[v]['F1'])
    item = dict(protocol_sha256=sha(ROOT/'protocol.json'),
                code_manifest=read_json(ROOT/'code_manifest.json'), selected_variant=selected,
                selection='full Val F1 at fixed 0.5; variant order breaks ties; Test never used',
                checkpoints={v: sha(RUN/'models'/v/'best.pt') for v in protocol['variants']},
                validation_files={v: sha(RUN/'models'/v/'validation.json') for v in protocol['variants']})
    path = RUN/'selection_frozen.json'
    if path.exists():
        assert read_json(path) == item, 'Frozen selection changed'
    else:
        write_json(path, item)
    return item
