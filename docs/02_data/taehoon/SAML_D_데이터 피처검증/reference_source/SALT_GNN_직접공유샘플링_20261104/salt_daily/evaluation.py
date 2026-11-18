"""Resumable full-population scoring. Commit only complete finite target ranges."""
import hashlib
import time
from pathlib import Path

import numpy as np
import torch

from .config import ROOT
from .data import tensors, cleanup, date
from .storage import read_json, write_json, sha, log, memory


def model_digest(model):
    digest = hashlib.sha256()
    for name, value in sorted(model.state_dict().items()):
        digest.update(name.encode())
        digest.update(value.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


class ScoreStore:
    def __init__(self, folder, request):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        marker = self.folder/'request.json'
        if marker.exists():
            if read_json(marker) != request:
                raise ValueError('Evaluation checkpoint/protocol/population changed; use a new run')
        else:
            write_json(marker, request)
        path = self.folder/'scores.npy'
        self.values = (np.load(path, mmap_mode='r+') if path.exists() else
                       np.lib.format.open_memmap(path, mode='w+', dtype='float32', shape=(request['rows'],)))
        assert self.values.shape == (request['rows'],) and self.values.dtype == np.float32
        self.commits = self.folder/'commits'
        self.commits.mkdir(exist_ok=True)
        self.cursor = 0
        self.seconds = 0.
        for path in sorted(self.commits.glob('*.json')):
            item = read_json(path)
            assert item['start'] == self.cursor and item['stop'] > self.cursor
            values = self.values[item['start']:item['stop']]
            assert item['stop'] <= len(self.values) and np.isfinite(values).all()
            assert hashlib.sha256(values.tobytes()).hexdigest() == item['sha256'], 'Damaged committed scores'
            self.cursor = item['stop']; self.seconds += item['seconds']

    def commit(self, values, seconds):
        values = np.asarray(values, dtype=np.float32)
        if not len(values) or not np.isfinite(values).all():
            raise ValueError('Incomplete/nonfinite prediction block')
        start, stop = self.cursor, self.cursor+len(values)
        assert stop <= len(self.values)
        self.values[start:stop] = values
        self.values.flush()
        write_json(self.commits/f'{start:012d}.json', dict(start=start, stop=stop,
            requested=len(values), scored=len(values), missing_targets=0, seconds=seconds,
            sha256=hashlib.sha256(values.tobytes()).hexdigest()))
        self.cursor = stop; self.seconds += seconds


def score(model, data, loader, device, folder, scope, epoch=0, stop_check=lambda: None):
    protocol = read_json(ROOT/'protocol.json')
    request = dict(scope=scope, epoch=epoch, rows=len(data), model_sha256=model_digest(model),
                   protocol_sha256=sha(ROOT/'protocol.json'),
                   code_manifest=read_json(ROOT/'code_manifest.json'), population=data.meta['files'])
    store = ScoreStore(Path(folder)/f'{scope}_epoch{epoch}', request)
    model.eval()
    chunk = protocol['evaluation']['score_commit_targets']
    with torch.inference_mode():
        for span in data.meta['spans']:
            if span['stop'] <= store.cursor:
                continue
            stop_check()
            loader.set_day(span['day'])
            while store.cursor < span['stop']:
                stop_check()
                begin = time.monotonic()
                take = np.arange(store.cursor, min(store.cursor+chunk, span['stop']), dtype=np.int64)
                values = np.full(len(take), np.nan, dtype=np.float32)
                seen = np.zeros(len(take), np.uint8)
                for part, arrays, _ in loader.microbatches(data, take,
                        microbatch=protocol['training']['microbatch_max'],
                        max_edges=protocol['training']['max_edges_per_microbatch']):
                    prediction = model(*tensors(arrays, device)).cpu().numpy()
                    assert len(prediction) == len(part) and np.isfinite(prediction).all()
                    positions = part-take[0]
                    values[positions] = prediction; seen[positions] += 1
                    del arrays, prediction
                assert np.all(seen == 1), 'Every target must receive exactly one score'
                store.commit(values, time.monotonic()-begin)
                cleanup()
                log(Path(folder), 'evaluation_progress', variant=model.variant, scope=scope, epoch=epoch,
                    day=date(span['day']), scored=store.cursor, requested=len(data),
                    seconds=store.seconds, missing_targets=0, memory=memory())
                stop_check()
    assert store.cursor == len(data)
    write_json(store.folder/'complete.json', dict(status='complete', requested=len(data),
        scored=len(data), missing_targets=0, coverage=1., scores_sha256=sha(store.folder/'scores.npy')))
    return store.values, store.seconds
