"""All observed targets, indexed by day on disk. Labels never select targets."""
import fcntl
from pathlib import Path

import numpy as np

from .config import ROOT, FEATURES, FRAUDGT
from .storage import read_json, write_json, sha, utc

WINDOWS = {'train_gnn': (7, 55), 'monitor': (56, 64),
           'validation': (69, 73), 'test': (74, 91)}
EXPECTED = {'train_gnn': 87572226, 'monitor': 18625135,
            'validation': 8551015, 'test': 33429507}


def labels_for(ids, positive_ids, positive_classes):
    ids = np.asarray(ids)
    positions = np.searchsorted(positive_ids, ids)
    found = np.flatnonzero(positions < len(positive_ids))
    found = found[positive_ids[positions[found]] == ids[found]]
    labels = np.zeros(len(ids), np.int8)
    labels[found] = positive_classes[positions[found]]
    return labels


def build_population(directory, minute, present, positive_ids, positive_classes,
                     windows=WINDOWS, block=1_000_000):
    """Two bounded-memory scans; each retained ID appears once in its date range."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    assert len(minute) == len(present) and len(minute) < 2**32
    assert np.all(positive_ids[1:] > positive_ids[:-1])
    assert np.all((positive_classes >= 1) & (positive_classes <= 9))
    ndays = max(end for _, end in windows.values()) + 1
    counts = np.zeros(ndays, np.int64)
    for start in range(0, len(minute), block):
        days = minute[start:start+block] // 1440
        valid = (present[start:start+len(days)] != 0) & (days >= 0) & (days < ndays)
        counts += np.bincount(days[valid], minlength=ndays)
    outputs, metadata, cursor = {}, {}, {}
    for scope, (first, last) in windows.items():
        boundaries = np.r_[0, np.cumsum(counts[first:last+1])]
        n = int(boundaries[-1])
        assert n > 0
        outputs[scope] = (
            np.lib.format.open_memmap(directory/f'{scope}_ids.npy', mode='w+', dtype='uint32', shape=(n,)),
            np.lib.format.open_memmap(directory/f'{scope}_labels.npy', mode='w+', dtype='int8', shape=(n,)))
        metadata[scope] = dict(rows=n, min_day=first, max_day=last, positive=0, unmatched=0,
                               spans=[dict(day=day, start=int(boundaries[day-first]),
                                           stop=int(boundaries[day-first+1])) for day in range(first, last+1)])
        cursor[scope] = boundaries[:-1].copy()
    for start in range(0, len(minute), block):
        days = minute[start:start+block] // 1440
        valid = present[start:start+len(days)] != 0
        for scope, (first, last) in windows.items():
            ids = (np.flatnonzero(valid & (days >= first) & (days <= last)) + start).astype(np.uint32)
            if not len(ids):
                continue
            labels = labels_for(ids, positive_ids, positive_classes)
            metadata[scope]['positive'] += int(np.count_nonzero(labels))
            metadata[scope]['unmatched'] += int(np.count_nonzero(labels == 9))
            selected_days = minute[ids] // 1440
            for day in np.unique(selected_days):
                take = selected_days == day
                n = int(take.sum()); offset = int(cursor[scope][day-first])
                outputs[scope][0][offset:offset+n] = ids[take]
                outputs[scope][1][offset:offset+n] = labels[take]
                cursor[scope][day-first] += n
    for scope, item in metadata.items():
        first, last = windows[scope]
        assert np.array_equal(cursor[scope], [span['stop'] for span in item['spans']])
        eligible = ((minute[positive_ids] >= first*1440) &
                    (minute[positive_ids] < (last+1)*1440) & (present[positive_ids] != 0))
        assert item['positive'] == int(eligible.sum())
        assert item['unmatched'] == int(np.count_nonzero(eligible & (positive_classes == 9)))
        item['normal'] = item['rows'] - item['positive']
        for values in outputs[scope]:
            values.flush()
        ids = outputs[scope][0]
        # Ordered, unique IDs per day + matching day counts prove full membership.
        for span in item['spans']:
            values = ids[span['start']:span['stop']]
            assert np.all(values[1:] > values[:-1])
            assert np.all(minute[values] // 1440 == span['day'])
            assert np.all(present[values] != 0)
        item['files'] = {f'{scope}_{suffix}.npy': sha(directory/f'{scope}_{suffix}.npy')
                         for suffix in ('ids', 'labels')}
    result = dict(created_utc=utc(), cohorts=metadata, daily_counts=counts.tolist(),
                  selection='observed-field dedup present mask and date only',
                  target_downsampling=False, ipw=False, windows=windows,
                  every_eligible_target_once=True)
    write_json(directory/'population.json', result)
    return result


def prepare_population():
    directory = ROOT/'cache/population'
    directory.mkdir(parents=True, exist_ok=True)
    with (directory/'prepare.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = directory/'population.json'
        if marker.exists():
            result = read_json(marker)
        else:
            result = build_population(directory,
                np.load(FEATURES/'minute.npy', mmap_mode='r'),
                np.load(FEATURES/'present.npy', mmap_mode='r'),
                np.load(FRAUDGT/'assets/positive_ids.npy', mmap_mode='r'),
                np.load(FRAUDGT/'assets/positive_classes.npy', mmap_mode='r'))
        for scope, expected in EXPECTED.items():
            assert result['cohorts'][scope]['rows'] == expected, scope
        return result


class FullPopulation:
    def __init__(self, scope, directory=None):
        directory = Path(directory) if directory else ROOT/'cache/population'
        self.meta = read_json(directory/'population.json')['cohorts'][scope]
        self.scope = scope
        self.ids = np.load(directory/f'{scope}_ids.npy', mmap_mode='r')
        self.y = np.load(directory/f'{scope}_labels.npy', mmap_mode='r')
        assert len(self.ids) == len(self.y) == self.meta['rows']

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, key):
        # Deliberately no sample-weight field and no fallback to legacy cohorts.
        return {'ids': self.ids, 'y': self.y}[key]

    def orders(self, epoch, shuffle=True, start_day_cursor=0):
        for span in self.meta['spans'][start_day_cursor:]:
            order = np.arange(span['start'], span['stop'], dtype=np.int64)
            if shuffle:
                np.random.default_rng(42000 + epoch*100 + span['day']).shuffle(order)
            yield span['day'], order

    def updates(self, batch_size):
        return sum((s['stop']-s['start']+batch_size-1)//batch_size for s in self.meta['spans'])
