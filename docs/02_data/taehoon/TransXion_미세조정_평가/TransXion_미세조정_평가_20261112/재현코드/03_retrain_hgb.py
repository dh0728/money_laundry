"""HGB를 TransXion 1~8월로 다시 학습한다(트리 모델은 가중치 미세조정이 안 되므로 같은 36열·같은 하이퍼파라미터로 재학습).

원본 HI 모델은 3클래스(정상/패턴/무패턴)였지만 TransXion은 이진 라벨만 있어 이진 분류로 학습한다.
"""
import sys, json
from pathlib import Path
sys.path.insert(0,'/workspace/handoff/TransXion_외부평가_20261112')
import bootstrap
import numpy as np, pandas as pd, joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score
from backend_model.schema import HGB_FEATURES, ROOT as MODEL_ROOT
SRC=Path('/workspace/handoff/TransXion_외부평가_20261112'); WORK=Path(__file__).resolve().parents[1]/'work'
y=pd.read_parquet(SRC/'normalized/truth.parquet').y.to_numpy(np.int8); n=len(y)
x=np.full((n,36),np.nan,np.float32); day=np.empty(n,'datetime64[D]')
for path in sorted((SRC/'run/prepared/hgb').glob('*.parquet')):
    f=pd.read_parquet(path); i=f.edge_id.to_numpy(); x[i]=f[HGB_FEATURES].to_numpy(np.float32); day[i]=np.datetime64(path.stem)
assert np.isfinite(x).all()
tr=day<=np.datetime64('2025-08-31'); va=(day>np.datetime64('2025-08-31'))&(day<=np.datetime64('2025-10-31')); te=day>np.datetime64('2025-10-31')
params=joblib.load(MODEL_ROOT/'models/hgb.joblib')['model'].get_params()   # HI 학습 때와 같은 설정
model=HistGradientBoostingClassifier(**params).fit(x[tr],y[tr])
p=np.clip(model.predict_proba(x)[:,1],1e-12,1-1e-12); z=np.log(p)-np.log1p(-p)
np.save(WORK/'hgb_logit_retrained.npy',z); joblib.dump(dict(model=model,feature_names=HGB_FEATURES,train_end='2025-08-31'),WORK/'hgb_retrained.joblib')
old=np.load(SRC/'run/prepared/hgb_logit.npy')
for name,m in [('train',tr),('val',va),('test',te)]:
    print(json.dumps(dict(split=name,rows=int(m.sum()),positive=int(y[m].sum()),
        frozen_AP=average_precision_score(y[m],old[m]),frozen_AUC=roc_auc_score(y[m],old[m]),
        retrained_AP=average_precision_score(y[m],z[m]),retrained_AUC=roc_auc_score(y[m],z[m]))),flush=True)
