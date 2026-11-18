"""Re-evaluate fixed SAML logits, without fitting or selecting thresholds."""
from pathlib import Path
import numpy as np
import pandas as pd
from fusion_workflow import aligned_scores, evaluate, confusion, sha256, read_json, write_json

def pattern_metrics(labels, logits, patterns, inclusive=False):
    labels=np.asarray(labels);logits=np.asarray(logits);patterns=np.asarray(patterns)
    if patterns.shape!=labels.shape or patterns.ndim!=1:raise ValueError('Invalid pattern alignment')
    rows=[]
    for pattern in np.unique(patterns):
        mask=patterns==pattern
        metrics=confusion(labels[mask],logits[mask],inclusive=inclusive)
        metrics['pattern']=str(pattern)
        if metrics['positive']==0:metrics['recall']=None
        if metrics['rows']==metrics['positive']:metrics['FPR']=None
        rows.append(metrics)
    return pd.DataFrame(rows)

def evaluate_external(folder, output, inclusive=False, expected_rows=9504852, expected_positive=9873):
    folder=Path(folder);output=Path(output)
    if output.exists():raise FileExistsError('Use a fresh evaluation directory')
    meta=read_json(folder/'metadata.json')
    if meta.get('scope')!='saml_all' or not meta.get('model'):raise ValueError('Specify scope saml_all and model')
    arrays={}
    for name in ['ids','labels','patterns','score_ids','logits']:
        p=folder/(name+'.npy')
        if meta.get('sha256',{}).get(p.name)!=sha256(p):raise ValueError('Missing/mismatched SHA: '+p.name)
        arrays[name]=np.load(p,mmap_mode='r',allow_pickle=False)
    ids=arrays['ids'];y=arrays['labels'];patterns=arrays['patterns']
    if ids.ndim!=1 or len(ids)!=expected_rows or not np.issubdtype(ids.dtype,np.integer) or len(np.unique(ids))!=len(ids):
        raise ValueError('Invalid canonical population IDs')
    if y.shape!=ids.shape or not np.isin(y,[0,1]).all() or int(y.sum())!=expected_positive:raise ValueError('Invalid binary population labels')
    if patterns.shape!=ids.shape or patterns.dtype.kind!='U':raise ValueError('Patterns must be aligned Unicode labels')
    z=aligned_scores(ids,arrays['score_ids'],arrays['logits'])
    result=evaluate(y,z,inclusive=inclusive)
    result.update(model=meta['model'],threshold_probability=.5,threshold_rule='>=' if inclusive else '>',metadata_sha256=sha256(folder/'metadata.json'))
    by_pattern=pattern_metrics(y,z,patterns,inclusive)
    write_json(output/'metrics.json',result)
    by_pattern.to_csv(output/'pattern_metrics.csv',index=False,encoding='utf-8-sig')
    return result,by_pattern
