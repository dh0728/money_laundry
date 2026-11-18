"""Full-split all-target inference with frozen weights and resumable score shards.

Reuses the original sampler and the original all_targets model implementation.
This is a portable runner, not a claim of bit-identical replay on other hardware.
"""
from dataclasses import asdict, replace
import gc
import json
import math
from pathlib import Path
import numpy as np
import torch
from tqdm.auto import tqdm
from . import RUN_ROOT, EXPERIMENT_ROOT
from .config import TrainConfig, digest
from .data import FeatureAdapter
from .models import make_model
from .official_loader import PeriodGraph
from .population import Labels
from .training import sample_next
from .metrics import binary_average_precision
from .storage import write_json
from .runtime import lock, prepare


def full_evaluate(variant, checkpoint=None, scope='test', device_name='cuda', memory_fraction=.35):
    checkpoint=Path(checkpoint or RUN_ROOT/'models'/variant/'best.pt')
    # Load only checkpoints from a trusted source (optimizer/config use pickle).
    checkpoint_hash=digest(checkpoint)
    saved=torch.load(checkpoint,map_location='cpu',weights_only=False)
    if digest(checkpoint)!=checkpoint_hash:raise RuntimeError('Checkpoint changed while loading; retry with a frozen checkpoint')
    if saved['variant']!=variant: raise ValueError('Checkpoint variant mismatch')
    training=TrainConfig(**saved['config'])
    if training.readout!='official': raise ValueError('Expected a checkpoint trained with official readout')
    with lock(RUN_ROOT/'contract.lock'):
        prepare(training)
    config=replace(training,readout='all_targets')
    out=RUN_ROOT/'evaluations'/f'{variant}_{scope}_all_targets'
    out.mkdir(parents=True,exist_ok=True)
    with lock(out/'evaluation.lock'):
        request={'checkpoint_sha256':checkpoint_hash,'selected_epoch':saved['epoch'],'variant':variant,
                 'training_config':asdict(training),'evaluation_config':asdict(config),'scope':scope,
                 'data_manifest_sha256':digest(EXPERIMENT_ROOT/'input_manifest.json'),
                 'code_manifest_sha256':digest(RUN_ROOT/'code_manifest.json'),
                 'device':device_name,'torch':torch.__version__,'sampler_epoch':0,'chunk_batches':64}
        marker=out/'request.json'
        if marker.exists() and json.loads(marker.read_text())!=request: raise ValueError('Evaluation contract changed; use a new run name')
        write_json(marker,request)
        result_path=out/'result.json'
        if result_path.exists(): return json.loads(result_path.read_text())
        base=np.load(EXPERIMENT_ROOT/'assets'/f'{scope}_ids.npy',mmap_mode='r')
        ids_path=out/'ordered_ids.npy'
        if not ids_path.exists():
            seed=config.seed+{'val':1,'test':2}[scope]*1000003
            positions=np.random.default_rng(seed).permutation(len(base))
            temp=out/'ordered_ids.tmp.npy';np.save(temp,np.asarray(base[positions],np.uint32));temp.replace(ids_path)
            del positions
        ids=np.load(ids_path,mmap_mode='r'); n=len(ids)
        order_marker=out/'order.json';order_info={'rows':n,'sha256':digest(ids_path)}
        if order_marker.exists() and json.loads(order_marker.read_text())!=order_info: raise ValueError('Changed evaluation order')
        write_json(order_marker,order_info)
        if n!=len(base): raise ValueError('Incomplete target order')
        device=torch.device(device_name);torch.set_num_threads(config.torch_threads);torch.manual_seed(config.seed)
        if device.type=='cuda':torch.cuda.set_per_process_memory_fraction(memory_fraction,device)
        model=make_model(variant,config).to(device).eval();model.load_state_dict(saved['state_dict'],strict=True)
        del saved
        graph=PeriodGraph(scope,variant,config);adapter=FeatureAdapter(variant!='fraudgt_format');labels=Labels()
        chunk_size=64*config.seed_batch;shards=out/'chunks';shards.mkdir(exist_ok=True)
        try:
            with torch.inference_mode(),tqdm(total=n,desc=f'{variant} {scope} all_targets',mininterval=1) as bar:
                for index,start in enumerate(range(0,n,chunk_size)):
                    end=min(start+chunk_size,n);path=shards/f'{index:04d}.npz';commit=path.with_suffix('.json')
                    if commit.exists():
                        record=json.loads(commit.read_text())
                        if record!={'start':start,'end':end,'sha256':digest(path)}: raise ValueError('Score shard failed integrity check')
                        with np.load(path) as old:
                            if not np.array_equal(old['transaction_id'],ids[start:end]): raise ValueError('Wrong score shard IDs')
                        bar.update(end-start);continue
                    target=np.asarray(ids[start:end],np.int64);truth=labels(target)
                    scores=np.full(len(target),np.nan,np.float32);visited=np.zeros(len(target),bool)
                    loader=graph.loader(target,(truth>0).astype(np.float32),config.graph_batch_size,shuffle=False)
                    iterator=iter(loader)
                    for local_index in range(len(loader)):
                        batch_index=start//config.graph_batch_size+local_index
                        sampled=sample_next(iterator,config,scope,0,batch_index)
                        rows,batch,_=adapter.materialize(graph,sampled,target)
                        logits,selection=model(batch.to(device));selection=selection.cpu().numpy()
                        if not np.array_equal(selection,np.arange(len(rows))): raise ValueError('Missing query readout')
                        if visited[rows].any():raise ValueError('Duplicated target rows')
                        scores[rows]=logits.cpu().numpy();visited[rows]=True;bar.update(len(rows))
                        write_json(out/'progress.json',{'completed':start+int(visited.sum()),'total':n,'percent':100*(start+int(visited.sum()))/n})
                        del sampled,batch,logits
                    if not visited.all() or not np.isfinite(scores).all(): raise ValueError('Incomplete or nonfinite scores')
                    temp=path.with_suffix('.tmp.npz')
                    np.savez(temp,transaction_id=target.astype(np.uint32),label=truth,logit=scores)
                    temp.replace(path);write_json(commit,{'start':start,'end':end,'sha256':digest(path)})
                    del target,truth,scores,visited,loader,iterator;gc.collect()
            # Bounded inference storage; exact AP still needs O(n) sorting RAM.
            scores=np.lib.format.open_memmap(out/'logits.npy',mode='w+',dtype=np.float32,shape=(n,))
            truth=np.lib.format.open_memmap(out/'labels.npy',mode='w+',dtype=np.int8,shape=(n,))
            for index,start in enumerate(range(0,n,chunk_size)):
                with np.load(shards/f'{index:04d}.npz') as data:
                    end=start+len(data['logit']);scores[start:end]=data['logit'];truth[start:end]=data['label']
            scores.flush();truth.flush();positive=truth>0;pred=scores>0
            tp=int((positive&pred).sum());fp=int((~positive&pred).sum());fn=int((positive&~pred).sum());tn=n-tp-fp-fn
            ratio=lambda a,b:float(a/b) if b else 0.
            result={'status':'complete','scope':f'full_{scope}','variant':variant,'selected_epoch':request['selected_epoch'],
                    'readout':'all_targets','training_readout':'official','requested':n,'scored':n,'coverage':1.,
                    'all_test_targets_scored':scope=='test','threshold_rule':'sigmoid(logit) > 0.5 (logit > 0)',
                    'precision':ratio(tp,tp+fp),'recall':ratio(tp,tp+fn),'F1':ratio(2*tp,2*tp+fp+fn),
                    'AP':binary_average_precision(positive,scores),'confusion':{'TP':tp,'FP':fp,'FN':fn,'TN':tn},
                    'known_recall':ratio(int(((truth==1)&pred).sum()),int((truth==1).sum())),
                    'unmatched_recall':ratio(int(((truth==9)&pred).sum()),int((truth==9).sum())),
                    'request_sha256':digest(marker),'order_sha256':order_info['sha256']}
            write_json(result_path,result);return result
        finally:
            del model,graph,adapter
            gc.collect()
            if device.type=='cuda':torch.cuda.empty_cache()
