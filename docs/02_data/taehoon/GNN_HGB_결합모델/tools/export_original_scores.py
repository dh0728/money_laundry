"""Export aligned scores from the original completed workspace (external data)."""
from pathlib import Path
import argparse,json,shutil,sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from fusion_workflow import sha256,write_json

def export(workspace,destination,model):
    workspace=Path(workspace);destination=Path(destination)
    a=workspace/'SALT_GNN_A3_HGB_결합실험_20261107'
    m=workspace/'Multi_FraudGT_HGB_결합실험_20261108'
    salt=workspace/'SALT_GNN_직접공유샘플링_20261104'
    counts=dict(fusion_fit=7315599,validation=8551015,test=33429507)
    for scope,n in counts.items():
        out=destination/model/scope
        if out.exists():raise FileExistsError(out)
        population=a/'population' if scope=='fusion_fit' else salt/'cache/population'
        ids=population/f'{scope}_ids.npy';labels=population/f'{scope}_labels.npy'
        hgb=a/'hgb_scores'/scope/'scores.npy'
        if model=='a3':
            gnn=(a/'salt_scores/fusion_fit_epoch6/scores.npy' if scope=='fusion_fit' else
                 salt/'runs/daily_close_001/models/A3'/f'{scope}_epoch6/scores.npy')
        else:gnn=m/'gnn_scores'/scope/'scores.npy'
        files=dict(ids=ids,labels=labels,hgb_ids=ids,hgb_logits=hgb,gnn_ids=ids,gnn_logits=gnn)
        for p in files.values():
            arr=np.load(p,mmap_mode='r')
            if arr.shape!=(n,):raise ValueError(f'Unexpected shape: {p}')
        out.mkdir(parents=True)
        for name,p in files.items():shutil.copy2(p,out/f'{name}.npy')
        write_json(out/'metadata.json',dict(scope=scope,rows=n,model=model,
            ordering='Canonical original transaction IDs; original completed experiments aligned scores to this population',
            input_order=['hgb_corrected_logit','gnn_raw_logit'],hgb_correction_already_applied=True,
            sha256={name+'.npy':sha256(out/f'{name}.npy') for name in files},
            original_sources={name:str(p) for name,p in files.items()}))
        print(model,scope,n,str(out))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--workspace',required=True,type=Path);p.add_argument('--output',required=True,type=Path)
    p.add_argument('--model',required=True,choices=['a3','multi']);a=p.parse_args();export(a.workspace,a.output,a.model)
