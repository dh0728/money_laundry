"""Portable score-level stacking; no workspace, GPU, or checkpoint dependency."""
from pathlib import Path
import hashlib,json,math,warnings
import numpy as np

def sha256(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(8*1024**2),b''):h.update(block)
    return h.hexdigest()

def read_json(path):return json.loads(Path(path).read_text())
def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n');tmp.replace(path)

def aligned_scores(ids,score_ids,scores):
    ids=np.asarray(ids);score_ids=np.asarray(score_ids);scores=np.asarray(scores)
    if ids.ndim!=1 or score_ids.ndim!=1 or scores.ndim!=1 or len(ids)!=len(score_ids) or len(scores)!=len(ids):
        raise ValueError('IDs and scores must have equal one-dimensional shapes')
    if not np.isfinite(scores).all():raise ValueError('Nonfinite scores')
    order=np.argsort(score_ids,kind='stable');ordered=score_ids[order]
    if len(ordered)>1 and (ordered[1:]==ordered[:-1]).any():raise ValueError('Duplicate score IDs')
    positions=np.searchsorted(ordered,ids)
    if (positions>=len(ordered)).any() or not np.array_equal(ordered[positions],ids):raise ValueError('Missing target IDs')
    return scores if np.array_equal(ids,score_ids) else scores[order[positions]]

def load_scores(folder,expected_rows=None):
    folder=Path(folder);meta=read_json(folder/'metadata.json')
    names=['ids','labels','hgb_ids','hgb_logits','gnn_ids','gnn_logits']
    arrays={name:np.load(folder/f'{name}.npy',mmap_mode='r') for name in names}
    for name in names:
        expected=meta.get('sha256',{}).get(name+'.npy')
        if expected and sha256(folder/f'{name}.npy')!=expected:raise ValueError('Changed file: '+name)
    ids=arrays['ids'];y=arrays['labels']
    if ids.ndim!=1 or y.shape!=ids.shape or not np.issubdtype(ids.dtype,np.integer):raise ValueError('Invalid IDs/labels')
    if len(np.unique(ids))!=len(ids):raise ValueError('Duplicate canonical IDs')
    if not np.issubdtype(y.dtype,np.integer) or ((y<0)|(y>9)).any():raise ValueError('Expected integer classes 0..9')
    if expected_rows is not None and len(ids)!=expected_rows:raise ValueError('Unexpected population size')
    hgb=aligned_scores(ids,arrays['hgb_ids'],arrays['hgb_logits'])
    gnn=aligned_scores(ids,arrays['gnn_ids'],arrays['gnn_logits'])
    return dict(ids=ids,y=y,hgb=hgb,gnn=gnn,metadata=meta)

def check_disjoint(*tables):
    for i,left in enumerate(tables):
        for right in tables[i+1:]:
            if np.intersect1d(left['ids'],right['ids']).size:raise ValueError('Fit/Validation/Test IDs overlap')

def corrected_hgb_logits(probabilities,class_factors=(1.,100.,100.)):
    p=np.asarray(probabilities,dtype=np.float64);f=np.asarray(class_factors,dtype=np.float64)
    if p.ndim!=2 or p.shape[1]!=len(f) or not np.isfinite(p).all() or (p<0).any() or (f<=0).any():raise ValueError('Invalid class probabilities/factors')
    corrected=p/f
    if (corrected.sum(axis=1)<=0).any():raise ValueError('Zero probability mass')
    corrected/=corrected.sum(axis=1,keepdims=True)
    fraud=np.clip(corrected[:,1:].sum(axis=1),1e-12,1-1e-12)
    return np.log(fraud)-np.log1p(-fraud)

def fit_fusion(table,random_state):
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.exceptions import ConvergenceWarning
    from threadpoolctl import threadpool_limits
    x=np.column_stack((table['hgb'],table['gnn']));y=(table['y']>0).astype('int8')
    if len(np.unique(y))!=2:raise ValueError('Both classes are required')
    scaler=StandardScaler().fit(x)
    model=LogisticRegression(C=.1,solver='lbfgs',max_iter=1000,tol=1e-7,random_state=random_state,class_weight=None)
    with threadpool_limits(limits=4),warnings.catch_warnings():
        warnings.simplefilter('error',ConvergenceWarning)
        model.fit(scaler.transform(x),y)
    return dict(input_order=['hgb_corrected_logit','gnn_raw_logit'],scaler_mean=scaler.mean_.tolist(),
        scaler_scale=scaler.scale_.tolist(),coefficients=model.coef_[0].tolist(),intercept=float(model.intercept_[0]),
        random_state=random_state,C=.1,solver='lbfgs',tol=1e-7,max_iter=1000,class_weight=None,sample_weight=None,
        fit_rows=len(y),fit_positive=int(y.sum()),iterations=int(model.n_iter_[0]))

def predict_logits(table,parameters):
    x=np.column_stack((table['hgb'],table['gnn']))
    mean=np.asarray(parameters['scaler_mean']);scale=np.asarray(parameters['scaler_scale'])
    coef=np.asarray(parameters['coefficients']).reshape(-1)
    if mean.shape!=(2,) or scale.shape!=(2,) or coef.shape!=(2,) or (scale<=0).any():raise ValueError('Invalid two-score model')
    z=((x-mean)/scale)@coef+float(parameters['intercept'])
    if not np.isfinite(z).all():raise ValueError('Nonfinite fusion output')
    return z

def confusion(y,z,threshold_logit=0.,inclusive=True):
    y=np.asarray(y)>0;z=np.asarray(z)
    if y.shape!=z.shape or z.ndim!=1 or not np.isfinite(z).all():raise ValueError('Invalid scores/labels')
    pred=z>=threshold_logit if inclusive else z>threshold_logit
    tp=int((y&pred).sum());fp=int((~y&pred).sum());fn=int((y&~pred).sum());tn=int((~y&~pred).sum())
    r=lambda a,b:a/b if b else 0.
    return dict(rows=len(y),positive=int(y.sum()),TP=tp,FP=fp,FN=fn,TN=tn,
        precision=r(tp,tp+fp),recall=r(tp,tp+fn),F1=r(2*tp,2*tp+fp+fn),FPR=r(fp,fp+tn))

def evaluate(y,z,threshold_logit=0.,inclusive=True):
    from sklearn.metrics import average_precision_score,roc_auc_score
    result=confusion(y,z,threshold_logit,inclusive)
    result.update(AP=float(average_precision_score(np.asarray(y)>0,z)),
        ROC_AUC=float(roc_auc_score(np.asarray(y)>0,z)) if 0<result['positive']<len(y) else None)
    return result

def best_validation_f1(y,z):
    y=np.asarray(y)>0;z=np.asarray(z)
    if len(z)==0 or not y.any() or not np.isfinite(z).all():raise ValueError('Validation needs finite scores and positives')
    order=np.argsort(-z,kind='stable');s=z[order]
    ends=np.r_[np.flatnonzero(s[:-1]!=s[1:]),len(s)-1]
    tp=np.cumsum(y[order],dtype=np.int64)[ends];f1=2*tp/(int(y.sum())+ends+1)
    threshold=float(s[ends[int(np.argmax(f1))]])
    return dict(threshold_logit=threshold,selection='Maximum full Validation F1; highest threshold on ties',
        **confusion(y,z,threshold))

def fit_and_freeze(fit,validation,output,random_state):
    output=Path(output)
    if (output/'frozen_validation.json').exists():raise FileExistsError('Use a new output directory; selection already frozen')
    check_disjoint(fit,validation)
    parameters=fit_fusion(fit,random_state);z=predict_logits(validation,parameters)
    selected=best_validation_f1(validation['y'],z)
    write_json(output/'fusion_parameters.json',parameters)
    frozen=dict(parameters_sha256=sha256(output/'fusion_parameters.json'),validation_threshold=selected,
        primary=evaluate(validation['y'],z),test_tuning=False)
    write_json(output/'frozen_validation.json',frozen)
    return parameters,frozen

def evaluate_frozen_test(test,output):
    output=Path(output);frozen=read_json(output/'frozen_validation.json')
    if sha256(output/'fusion_parameters.json')!=frozen['parameters_sha256']:raise ValueError('Frozen parameters changed')
    z=predict_logits(test,read_json(output/'fusion_parameters.json'))
    result=dict(primary=evaluate(test['y'],z),
        hi_validation_threshold=evaluate(test['y'],z,frozen['validation_threshold']['threshold_logit']))
    write_json(output/'test.json',result);return result
