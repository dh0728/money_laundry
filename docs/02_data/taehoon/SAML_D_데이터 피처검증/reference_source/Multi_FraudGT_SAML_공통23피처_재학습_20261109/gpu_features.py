"""Lossless resident input features: FP32 numeric values and packed categories."""
import time
import numpy as np
import torch
from fraudgt_lab import GRAPH_ROOT as GRAPH
import json
from pathlib import Path
def read_json(path): return json.loads(Path(path).read_text())


class CudaFeatureStore:
    def __init__(self, inputs, extra, width, edge_indices, device='cuda', block=500_000):
        assert edge_indices == [0,1,2,3,4,5,6,7,9,10,12,13,14,15]
        self.device = torch.device(device)
        self.numeric = torch.empty((width,12),dtype=torch.float32,device=device)
        self.categorical = torch.empty(width,dtype=torch.uint8,device=device)
        if inputs.test is None:
            inputs.test = np.load(GRAPH/'cache/hi/test_edge17.npy',mmap_mode='r')
            inputs.test_origin = read_json(GRAPH/'cache/hi/test_edges_complete.json')['origin']
        begin = time.monotonic()
        if width > 1_000_000:
            print(f'CUDA input cache loading: {width:,} transactions (no labels)',flush=True)
        for start in range(0,width,block):
            stop = min(width,start+block); ids = np.arange(start,stop,dtype=np.int64)
            present = ids < len(inputs.edge)
            present[present] = inputs.present[ids[present]] != 0
            fallback = ((inputs.minute[ids] >= 74*1440) & (ids >= inputs.test_origin)
                        & (ids-inputs.test_origin < len(inputs.test)))
            valid = present | fallback
            selected = ids[valid]
            raw = inputs.edges(selected)
            booleans = raw[:,edge_indices[10:]]
            assert np.all((booleans == 0) | (booleans == 1)), 'Packed fields must be exactly binary'
            incoming = extra.in_ports[selected]; outgoing = extra.out_ports[selected]
            # Missing port entries retain an invalid marker and fail if selected.
            ports_valid = (incoming >= 0) & (outgoing >= 0)
            values = np.zeros((len(ids),12),dtype=np.float32)
            values[valid,:10] = raw[:,edge_indices[:10]]
            values[valid,10] = incoming; values[valid,11] = outgoing
            codes = extra.formats[selected].astype(np.int64)
            codes = np.where((codes >= 0) & (codes < 7),codes,7).astype(np.uint8)
            packed = np.zeros(len(ids),dtype=np.uint8)
            bits = sum(booleans[:,i].astype(np.uint8) << i for i in range(4))
            packed[valid] = (ports_valid.astype(np.uint8) << 7) | (codes << 4) | bits
            self.numeric[start:stop].copy_(torch.from_numpy(values))
            self.categorical[start:stop].copy_(torch.from_numpy(packed))
            if width > 1_000_000 and (stop % 40_000_000 == 0 or stop == width):
                print(f'CUDA input cache: {stop:,}/{width:,}',flush=True)
        torch.cuda.synchronize()
        self.initialization_seconds = time.monotonic()-begin
        self.nodes = self.degree = None

    def set_day(self, nodes, degree):
        self.nodes = torch.tensor(nodes,dtype=torch.float32,device=self.device)
        self.degree = torch.tensor(degree,dtype=torch.float32,device=self.device)

    @torch.no_grad()
    def edges(self, ids):
        packed = self.categorical[ids].long()
        assert bool(((packed & 128) != 0).all()), 'Missing input features or port ranks'
        values = self.numeric[ids]
        output = torch.empty((len(ids),24),dtype=torch.float32,device=self.device)
        output[:,:10] = values[:,:10]
        for i in range(4):
            output[:,10+i] = (packed >> i) & 1
        output[:,14:22] = 0
        output[:,14:22].scatter_(1,((packed >> 4) & 7)[:,None],1.)
        output[:,22:24] = values[:,10:12]
        return output

    @torch.no_grad()
    def materialize(self, ids, graph):
        nodes,edges,src,dst,ts,td,flags,ego = graph
        x = torch.empty((len(nodes),20),dtype=torch.float32,device=self.device)
        x[:,:19] = self.nodes[nodes]; x[:,19] = ego
        arrays = (x,torch.stack((src,dst)),self.edges(edges),torch.stack((ts,td)),
                  self.edges(ids),(flags&1)>0,(flags&2)>0,self.degree[nodes])
        for i in (0,2,4,7):
            assert bool(torch.isfinite(arrays[i]).all()), 'Nonfinite GPU input'
        return arrays
