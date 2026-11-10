"""Exact integer-count population metrics, with bounded-memory ranking scans."""
import math
import numpy as np


def confusion(y, scores, threshold=0., block=1_000_000):
    result = dict(TP=0, FP=0, FN=0, TN=0, known_pattern_TP=0, known_pattern_total=0,
                  unmatched_TP=0, unmatched_total=0)
    assert len(y) == len(scores) and len(y) > 0
    for start in range(0, len(y), block):
        labels = np.asarray(y[start:start+block])
        values = np.asarray(scores[start:start+block])
        if not np.isfinite(values).all() or not np.all((labels >= 0) & (labels <= 9)):
            raise ValueError('Missing/nonfinite scores or invalid labels; full metrics refused')
        pred = values >= threshold
        fraud = labels > 0
        for key, mask in [('TP', pred & fraud), ('FP', pred & ~fraud),
                          ('FN', ~pred & fraud), ('TN', ~pred & ~fraud)]:
            result[key] += int(mask.sum())
        for name, mask in [('known_pattern', (labels > 0) & (labels < 9)), ('unmatched', labels == 9)]:
            result[name+'_total'] += int(mask.sum())
            result[name+'_TP'] += int((mask & pred).sum())
    return rates(result)


def rates(result):
    result = dict(result)
    tp, fp, fn = result['TP'], result['FP'], result['FN']
    result.update(precision=tp/(tp+fp) if tp+fp else 0., recall=tp/(tp+fn) if tp+fn else 0.,
                  F1=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.)
    for name in ('known_pattern', 'unmatched'):
        result[name+'_recall'] = (result[name+'_TP']/result[name+'_total']
                                 if result[name+'_total'] else None)
    return result


def ranking(y, scores, ids, fractions=(.001, .005, .01), block=1_000_000):
    """Exact AP handles score ties; pure TOP-K breaks ties by transaction ID."""
    y, scores, ids = np.asarray(y), np.asarray(scores), np.asarray(ids)
    order = np.lexsort((ids, -scores))
    positives = int(np.count_nonzero(y > 0))
    total_tp = last_end_tp = 0
    ap = 0.
    for start in range(0, len(order), block):
        stop = min(start+block, len(order))
        take = order[start:stop]
        values = scores[take]
        tp = total_tp + np.cumsum(y[take] > 0, dtype=np.int64)
        ends = np.flatnonzero(np.r_[values[:-1] != values[1:],
                                   stop == len(order) or values[-1] != scores[order[stop]]])
        if len(ends):
            group_tp = tp[ends]
            if positives:
                ap += float(np.sum(np.diff(np.r_[last_end_tp, group_tp])/positives *
                                   group_tp/(start+ends+1)))
            last_end_tp = int(group_tp[-1])
        total_tp = int(tp[-1])
    top = []
    known_total = int(np.count_nonzero((y > 0) & (y < 9)))
    unmatched_total = int(np.count_nonzero(y == 9))
    for fraction in fractions:
        k = min(len(y), max(1, math.ceil(len(y)*fraction)))
        labels = y[order[:k]]
        tp = int(np.count_nonzero(labels > 0))
        counts = dict(TP=tp, FP=k-tp, FN=positives-tp, TN=len(y)-positives-(k-tp),
                      known_pattern_TP=int(np.count_nonzero((labels > 0) & (labels < 9))),
                      known_pattern_total=known_total, unmatched_TP=int(np.count_nonzero(labels == 9)),
                      unmatched_total=unmatched_total)
        top.append(dict(fraction=fraction, k=k, cutoff_logit=float(scores[order[k-1]]),
                        threshold_gate=False, tie_policy='transaction_id_ascending', **rates(counts)))
    return ap, top


def summarize(y, scores, ids, detailed=True):
    result = confusion(y, scores)
    result.update(requested=len(y), scored=len(scores), missing_targets=0, coverage=1.,
                  threshold_probability=.5, threshold_logit=0.,
                  precision_is_population_estimate=False, population_ipw=False,
                  full_population_certified=True)
    ap, top = ranking(y, scores, ids)
    result.update(AP=ap, top_k=top)
    if detailed:
        result['threshold_metrics'] = []
        for step in range(1, 11):
            p = step/10
            threshold = np.log(p/(1-p)) if p < 1 else np.inf
            result['threshold_metrics'].append(dict(probability=p, **confusion(y, scores, threshold)))
    return result
