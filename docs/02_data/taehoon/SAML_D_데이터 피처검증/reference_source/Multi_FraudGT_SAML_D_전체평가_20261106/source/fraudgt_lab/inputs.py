"""Same V10 edge assembly as the historical HIInputs, with configurable paths."""
import json
import numpy as np
from . import G, HI_ROOT, STRUCTURAL_ROOT
class HIInputs:
    def __init__(self):
        self.edge=np.load(STRUCTURAL_ROOT/'x.npy',mmap_mode='r')
        self.present=np.load(STRUCTURAL_ROOT/'present.npy',mmap_mode='r')
        self.z=np.load(G/'z.npy',mmap_mode='r')
        self.pz=np.load(HI_ROOT/'paid_z.npy',mmap_mode='r')
        self.minute=np.load(G/'minute.npy',mmap_mode='r')
        self.test=None
    def edges(self,ids):
        ids=np.asarray(ids,np.int64);a=np.empty((len(ids),17),np.float32);ok=ids<len(self.edge)
        if ok.any():ok[ok]=self.present[ids[ok]]!=0
        if ok.any():a[ok]=self.edge[ids[ok]]
        if (~ok).any():
            if self.test is None:
                self.test=np.load(HI_ROOT/'test_edge17.npy',mmap_mode='r')
                self.test_origin=json.loads((HI_ROOT/'test_edges_complete.json').read_text())['origin']
            assert (self.minute[ids[~ok]]>=74*1440).all(),'Missing train/validation context features'
            assert ((ids[~ok]-self.test_origin>=0)&(ids[~ok]-self.test_origin<len(self.test))).all()
            a[~ok]=self.test[ids[~ok]-self.test_origin]
        a[:,7]=self.pz[ids];a[:,16]=self.z[ids];return a
