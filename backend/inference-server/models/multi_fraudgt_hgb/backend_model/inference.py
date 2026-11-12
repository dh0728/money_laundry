"""Frozen inference over prepared tables; instantiate once per model process.

The compact reference loader holds the graph in RAM. Large production graphs
need the existing mapped CSC loader or an equivalent service-specific store.
"""
from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
import torch
from torch_geometric.data import HeteroData
from torch_geometric.loader import LinkNeighborLoader
from tqdm.auto import tqdm
from .data import GraphBatch
from .models import FraudGT
from .schema import ROOT, SCHEMA, NODE_FEATURES, HGB_FEATURES
from .preprocessing import select_gnn_edges, verify_assets
from .io import sha256

FORWARD = ('node','to','node')
REVERSE = ('node','rev_to','node')


def sigmoid(values):
    x = np.asarray(values,dtype=np.float64)
    return np.exp(-np.logaddexp(0.,-x))


class Predictor:
    def __init__(self, device='cpu', threads=2):
        verify_assets()
        self.device = torch.device(device)
        if self.device.type=='cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA requested but unavailable')
        torch.set_num_threads(threads)
        saved = torch.load(ROOT/'models/multi_epoch280.pt',map_location='cpu',weights_only=True)
        if saved['epoch'] != 280 or saved['variant'] != 'multi_fraudgt_format':
            raise ValueError('Unexpected GNN checkpoint')
        self.gnn = FraudGT('multi_fraudgt_format',readout='all_targets')
        self.gnn.load_state_dict(saved['state_dict'],strict=True)
        self.gnn.to(self.device).eval()
        self.hgb = joblib.load(ROOT/'models/hgb.joblib')
        self.fusion = joblib.load(ROOT/'models/fusion.joblib')
        if self.hgb['feature_names'] != HGB_FEATURES or self.hgb['model'].n_features_in_ != 36:
            raise ValueError('HGB feature order mismatch')
        np.testing.assert_array_equal(self.hgb['class_factors'],[1.,100.,100.])
        np.testing.assert_array_equal(self.hgb['model'].classes_,[0,1,2])
        if self.fusion['gnn_checkpoint_sha256'] != sha256(ROOT/'models/multi_epoch280.pt'):
            raise ValueError('Fusion GNN dependency mismatch')
        if self.fusion['hgb_sha256'] != sha256(ROOT/'models/hgb.joblib'):
            raise ValueError('Fusion HGB dependency mismatch')

    def tree_logit(self, frame):
        if list(frame.columns) != HGB_FEATURES:
            raise ValueError('HGB requires exactly 36 named columns in frozen order')
        x = frame.to_numpy(dtype=np.float32)
        if not np.isfinite(x).all():
            raise ValueError('Nonfinite HGB input')
        probability = self.hgb['model'].predict_proba(x)/np.asarray(self.hgb['class_factors'])
        probability /= probability.sum(axis=1,keepdims=True)
        p = np.clip(probability[:,1:].sum(axis=1),1e-12,1-1e-12)
        return np.log(p)-np.log1p(-p)

    def combine(self, hgb_logit, gnn_logit):
        x = np.column_stack([hgb_logit,gnn_logit])
        if not np.isfinite(x).all():
            raise ValueError('Nonfinite base score')
        return self.fusion['model'].decision_function(self.fusion['scaler'].transform(x))

    def predict(self, prepared, threshold=.5, batch_size=2048, seed=42, progress=True):
        if not np.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError('threshold must be a probability in [0,1]')
        if batch_size<1:
            raise ValueError('batch_size must be positive')
        root = Path(prepared)
        meta = json.loads((root/'complete.json').read_text())
        if meta['schema_sha256'] != sha256(ROOT/'assets/schema.json'):
            raise ValueError('Prepared feature schema mismatch')
        tx = pd.read_parquet(root/'tx.parquet').sort_values('edge_id').reset_index(drop=True)
        nx = pd.read_parquet(root/'node_features.parquet').sort_values('node_id').reset_index(drop=True)
        edges = pd.read_parquet(root/'edge_features.parquet').set_index('edge_id').loc[tx.edge_id].copy()
        edges['payment_format'] = tx.payment_format.to_numpy()
        ex = select_gnn_edges(edges)
        ports = pd.read_parquet(root/'ports.parquet').set_index('edge_id').loc[tx.edge_id].to_numpy(np.float32)
        node_ids = nx.node_id.to_numpy(np.int64)
        src,dst = [np.searchsorted(node_ids,tx[col]) for col in ['src','dst']]
        for col, index in [('src',src),('dst',dst)]:
            np.testing.assert_array_equal(node_ids[index],tx[col])
        graph = HeteroData()
        graph['node'].x = torch.from_numpy(nx[NODE_FEATURES].to_numpy(dtype=np.float32,copy=True))
        # Explicit CSC order preserves chronological per-owner ordering.
        minute = tx.ts.to_numpy().astype('datetime64[m]').astype(np.int64)
        permutations = {}
        for relation,owner,peer in [(FORWARD,dst,src),(REVERSE,src,dst)]:
            order = np.lexsort((tx.edge_id.to_numpy(),minute,owner))
            permutations[relation] = order
            graph[relation].edge_index = torch.from_numpy(np.stack([peer[order],owner[order]]))
        target_ids = pd.read_parquet(root/'targets.parquet').edge_id.to_numpy(np.int64)
        positions = pd.Index(tx.edge_id).get_indexer(target_ids)
        if (positions<0).any() or len(np.unique(target_ids)) != len(target_ids):
            raise ValueError('Invalid target ID alignment')
        hgb_frame = pd.concat([pd.read_parquet(p) for p in sorted((root/'hgb').glob('*.parquet'))]).set_index('edge_id')
        if hgb_frame.index.duplicated().any() or set(hgb_frame.index) != set(target_ids):
            raise ValueError('HGB and GNN target populations differ')
        h = self.tree_logit(hgb_frame.loc[target_ids,HGB_FEATURES])
        scores = np.full(len(target_ids),np.nan,dtype=np.float32)
        with torch.random.fork_rng(devices=[]), torch.inference_mode():
            torch.manual_seed(seed)
            loader = LinkNeighborLoader(graph,num_neighbors=[50,50],
              edge_label_index=(FORWARD,torch.from_numpy(np.stack([src[positions],dst[positions]]))),
              batch_size=batch_size,shuffle=False,replace=False,subgraph_type='directional',
              num_workers=0,is_sorted=True,generator=torch.Generator().manual_seed(seed))
            for sampled in tqdm(loader,desc='Multi-FraudGT 추론',disable=not progress):
                rows = sampled[FORWARD].input_id.numpy()
                targets = positions[rows]
                f = permutations[FORWARD][sampled[FORWARD].e_id.numpy()]
                r = permutations[REVERSE][sampled[REVERSE].e_id.numpy()]
                selected_edges = np.r_[f,r]
                index = np.concatenate([sampled[FORWARD].edge_index.numpy(),sampled[REVERSE].edge_index.numpy()[::-1]],axis=1)
                target_index = sampled[FORWARD].edge_label_index.numpy()
                ego = np.zeros(sampled['node'].num_nodes,np.float32)
                ego[np.unique(target_index)] = 1
                data = [np.column_stack([sampled['node'].x.numpy(),ego]),index,ex[selected_edges],
                  target_index,ex[targets],np.arange(len(selected_edges))<len(f),
                  np.arange(len(selected_edges))>=len(f),np.full(len(rows),-1,np.int64),
                  ports[selected_edges],ports[targets]]
                batch = GraphBatch(*[torch.from_numpy(np.ascontiguousarray(v)) for v in data]).to(self.device)
                result, selected = self.gnn(batch)
                np.testing.assert_array_equal(selected.cpu(),np.arange(len(rows)))
                scores[rows] = result.cpu().numpy()
        if not np.isfinite(scores).all():
            raise ValueError('Incomplete GNN inference')
        combined = self.combine(h,scores)
        probability = sigmoid(combined)
        return pd.DataFrame(dict(edge_id=target_ids,risk_score=probability,alert=probability>=threshold,
          threshold=threshold,gnn_score=sigmoid(scores),hgb_score=sigmoid(h),
          model_version=SCHEMA['schema_version']))
