"""Label-independent temporal60/20/20 split and uniform target streams."""
from pathlib import Path
from datetime import datetime,timezone
import itertools,json,math,fcntl
import numpy as np
from . import EXPERIMENT_ROOT
from .storage import write_json
from common import G

ASSETS=EXPERIMENT_ROOT/'assets'


def temporal_boundaries(counts):
    """Exact day-boundary objective used by upstream AMLDataset.process."""
    counts=np.asarray(counts,np.int64);total=int(counts.sum());target=np.array([.6,.2,.2])
    prefix=np.r_[0,np.cumsum(counts)]
    candidates=itertools.combinations(range(len(counts)),2)
    return min(candidates,key=lambda ij:max(abs(np.array([prefix[ij[0]],prefix[ij[1]]-prefix[ij[0]],total-prefix[ij[1]]])/total-target)/target))


def prepare_population():
    ASSETS.mkdir(exist_ok=True)
    with (ASSETS/'population.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        marker=ASSETS/'splits.json'
        if marker.exists():return json.loads(marker.read_text())
        minute=np.load(G/'minute.npy',mmap_mode='r');present=np.load(G/'present.npy',mmap_mode='r')
        counts=np.zeros(92,np.int64);first_minute=None
        for start in range(0,len(minute),1_000_000):
            m=minute[start:start+1_000_000];ok=present[start:start+len(m)]!=0
            counts+=np.bincount(m[ok]//1440,minlength=len(counts))
            if ok.any():first_minute=int(m[ok].min()) if first_minute is None else min(first_minute,int(m[ok].min()))
        assert first_minute==0,'Audit upstream min-timestamp offset before proceeding'
        i,j=temporal_boundaries(counts)
        windows={'train':(0,i-1),'val':(i,j-1),'test':(j,len(counts)-1)}
        outputs={name:np.lib.format.open_memmap(ASSETS/f'{name}_ids.npy',mode='w+',dtype=np.uint32,
                   shape=(int(counts[first:last+1].sum()),)) for name,(first,last) in windows.items()}
        cursors={name:0 for name in windows}
        for start in range(0,len(minute),1_000_000):
            m=minute[start:start+1_000_000];ok=present[start:start+len(m)]!=0
            for name,(first,last) in windows.items():
                ids=(np.flatnonzero(ok&(m>=first*1440)&(m<(last+1)*1440))+start).astype(np.uint32)
                outputs[name][cursors[name]:cursors[name]+len(ids)]=ids;cursors[name]+=len(ids)
        for name,array in outputs.items():assert len(array)==cursors[name];array.flush()
        record={'rule':'Official daily-count60/20/20 minimax relative proportion error; labels not used',
                'total':int(counts.sum()),'daily_counts':counts.tolist(),'boundaries':[i,j],
                'windows':{name:{'first_day':a,'last_day':b,'rows':cursors[name],
                    'start':str(np.datetime64('2022-08-01')+np.timedelta64(a,'D')),
                    'end':str(np.datetime64('2022-08-01')+np.timedelta64(b,'D'))} for name,(a,b) in windows.items()},
                'labels_used_for_split':False,'population':'V10 observed-field dedup, includes original restored positives'}
        write_json(marker,record);return record


def split_window(scope):return prepare_population()['windows'][scope]


class Labels:
    def __init__(self):
        self.ids=np.load(ASSETS/'positive_ids.npy');self.classes=np.load(ASSETS/'positive_classes.npy')
    def __call__(self,ids):
        ids=np.asarray(ids);p=np.searchsorted(self.ids,ids);valid=p<len(self.ids)
        found=np.flatnonzero(valid);found=found[self.ids[p[found]]==ids[found]]
        y=np.zeros(len(ids),np.int8);y[found]=self.classes[p[found]];return y


class PopulationStream:
    def __init__(self,config,scope='train'):
        self.config,self.scope=config,scope
        prepare_population()
        self.ids=np.load(ASSETS/f'{scope}_ids.npy',mmap_mode='r')
        self.batches_per_pass=math.ceil(len(self.ids)/config.seed_batch)
        self.current_cycle=None;self.order=None

    def permutation(self,cycle):
        if self.current_cycle==cycle:return self.order
        folder=ASSETS/'orders';folder.mkdir(exist_ok=True)
        path=folder/f'{self.scope}_seed{self.config.seed}_cycle{cycle}.npy'
        with path.with_suffix('.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if not path.exists():
                values=np.array(self.ids,copy=True)
                np.random.default_rng(self.config.seed+cycle).shuffle(values)
                temp=path.with_suffix('.tmp.npy');np.save(temp,values);temp.replace(path)
        self.order=np.load(path,mmap_mode='r');self.current_cycle=cycle;return self.order

    def training_batches(self,epoch):
        result=[]
        for absolute in range((epoch-1)*self.config.iterations_per_epoch,epoch*self.config.iterations_per_epoch):
            cycle,index=divmod(absolute,self.batches_per_pass)
            result.append(np.asarray(self.permutation(cycle)[index*self.config.seed_batch:(index+1)*self.config.seed_batch],np.int64))
        return result

    def evaluation_ids(self,epoch=0,max_batches=None):
        """Shuffle the whole split, then take the loader budget; independent of labels."""
        limit=min(len(self.ids),(max_batches or self.config.validation_batches)*self.config.seed_batch)
        # Prefix of a uniform permutation; never oversample positive targets.
        seed=self.config.seed+epoch*1009+({'val':1,'test':2}[self.scope])*1000003
        positions=np.random.default_rng(seed).permutation(len(self.ids))[:limit]
        return np.asarray(self.ids[positions],np.int64)
