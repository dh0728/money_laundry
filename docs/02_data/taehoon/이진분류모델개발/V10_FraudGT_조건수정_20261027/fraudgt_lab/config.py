"""Shared scientific settings; graph sharing is the comparison variable."""
from dataclasses import dataclass,asdict
import math,json,hashlib
from pathlib import Path
from . import EXPERIMENT_ROOT,PROJECT_ROOT

VARIANTS=('fraudgt_format','pe_fraudgt_format','multi_fraudgt_format')
EDGE_INDICES=(0,1,2,3,4,5,6,7,9,10,12,13,14,15)
FORMAT_NAMES=('ACH','Bitcoin','Cash','Cheque','Credit Card','Reinvestment','Wire','Unknown')
EDGE_DIM=len(EDGE_INDICES)+len(FORMAT_NAMES)
UPSTREAM_COMMIT='f88db9dc003a6f521a90631c4741541686043119'

@dataclass(frozen=True)
class TrainConfig:
    graph_mode: str = 'shared'
    seed: int = 42
    epochs: int = 500
    seed_batch: int = 2048
    iterations_per_epoch: int = 256
    validation_batches: int = 256
    batch_accumulation: int = 8
    positive_weight: float = 6.
    base_lr: float = .001
    weight_decay: float = 1e-5
    warmup_epochs: int = 5
    gradient_clip: float = 1.
    eval_period: int = 4
    reference_microbatch: int = 64
    readout: str = 'official'
    loader_workers: int = 0
    torch_threads: int = 2
    checkpoint_layers: bool = True
    extra_epoch_validation: bool = False

    def __post_init__(self):
        if self.graph_mode not in ('shared','disjoint') or self.readout not in ('official','all_targets'):
            raise ValueError('Unknown graph mode or readout')
        for name in ('epochs','seed_batch','iterations_per_epoch','validation_batches','batch_accumulation',
                     'warmup_epochs','eval_period','reference_microbatch','torch_threads'):
            if getattr(self,name)<=0:raise ValueError(name)
        if self.loader_workers<0 or self.epochs<=self.warmup_epochs:raise ValueError('Invalid worker/epoch setting')

    @property
    def graph_batch_size(self):
        return self.seed_batch if self.graph_mode=='shared' else min(self.reference_microbatch,self.seed_batch)

    @property
    def logical_batch(self):return self.seed_batch*self.batch_accumulation

    def learning_rate(self,epoch):
        step=epoch-1
        factor=max(1e-6,step/self.warmup_epochs) if step<self.warmup_epochs else max(0.,.5*(1+math.cos(math.pi*(step-self.warmup_epochs)/(self.epochs-self.warmup_epochs))))
        return self.base_lr*factor

    def selection_epoch(self,epoch):
        return epoch==1 or epoch%self.eval_period==0 or epoch==self.epochs

    def validation_epoch(self,epoch):
        return self.extra_epoch_validation or self.selection_epoch(epoch)

    def checkpoint_every(self,variant):return 100 if variant=='pe_fraudgt_format' else 50


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()


def selected_model():return json.loads((PROJECT_ROOT/'selected_binary_model.json').read_text())


def protocol(config):
    splits=json.loads((EXPERIMENT_ROOT/'assets/splits.json').read_text())
    return {'version':'corrected-v2','training':asdict(config),'variants':VARIANTS,'upstream_commit':UPSTREAM_COMMIT,
            'graph_mode':config.graph_mode,'goal':{'precision':.70,'recall':.65},'splits':splits,
            'features':'V10 account19 + numeric transaction14 + payment format1 (8 one-hot columns)',
            'relations':{'basic':['to'],'PE':['to'],'Multi':['to','rev_to']},
            'sampling':'Actual PyG LinkNeighborLoader, fanout[50,50], uniform without replacement; no forced seed/same-minute edges',
            'graph_context':'Cumulative prefix through each split end; no per-target daily cutoff',
            'validation':'Uniform permutation prefix from ALL validation observations, up to256 original batches; no complete-positive cohort and no IPW',
            'metrics':'Official readout metrics are conditional on sampled/scored targets. Coverage and conservative requested-target recall are reported separately.',
            'readout':config.readout,'selection':'F1 at sigmoid>0.5, epochs1,4,8,...,500; no test scores used for selection',
            'known_exceptions':[
                'V10 features, frozen V10 scaling/KYC and observation-only deduplicated population instead of raw paper inputs.',
                'Disjoint notebook intentionally uses per-target graphs; shared notebook uses one shared 2048-target graph.',
                'Worker0/thread2 default is an explicit memory resource override; official configuration is worker18/thread24.',
                'Sampler RNG keyed by phase/epoch/graph batch for restart; target permutations shared between comparison modes, not upstream bitwise RNG.',
                'Activation checkpointing changes computation schedule, not graph membership or model equations.',
                'Accumulate8 complete loader-batch means and flush final gradients; fix upstream off-by-one update bug rather than reproduce it.',
                'One seed42 by default. Earlier experiments already used this dataset; this is not a fresh generalization holdout.'
            ],'old_checkpoint_import':False}
