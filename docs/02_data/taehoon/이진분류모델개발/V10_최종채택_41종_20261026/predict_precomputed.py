"""Predict using ordered HGB inputs and raw logits from the adopted GNN33.

Raw-transaction graph/feature construction remains in the project runtime.
Run this file to reproduce the included128-row prepared-input example.
"""
from pathlib import Path
import json,joblib,numpy as np
ROOT=Path(__file__).resolve().parent
def predict(tree_values,gnn_raw_logits):
    m=json.loads((ROOT/'adoption.json').read_text());tree=joblib.load(ROOT/'tree.joblib');fusion=joblib.load(ROOT/'fusion.joblib')
    x=np.asarray(tree_values,dtype=np.float32);g=np.asarray(gnn_raw_logits,dtype=float)
    assert x.ndim==2 and x.shape[1]==36 and g.shape==(len(x),)
    proba=tree['model'].predict_proba(x)/np.asarray(tree['class_factors']);proba/=proba.sum(1,keepdims=True)
    p=np.clip(proba[:,1:].sum(1),1e-12,1-1e-12);t=np.log(p)-np.log1p(-p)
    z=np.column_stack([t,g-np.log(300.)]);s=fusion['model'].decision_function(fusion['scaler'].transform(z))-np.log(100.)
    return s,s>=m['threshold']
if __name__=='__main__':
    a=np.load(ROOT/'prepared_input_example.npz');s,p=predict(a['tree_values'],a['gnn_raw_logits'])
    np.testing.assert_allclose(s,a['expected_scores'],rtol=0,atol=1e-12);np.testing.assert_array_equal(p,a['expected_labels'])
    print('PASS:128 prepared-input scores and binary predictions match the adopted41-type model.')
