"""Attach already prepared V10 features without copying multi-GB arrays."""
import json
from pathlib import Path
import numpy as np
from . import EXPERIMENT_ROOT, G, STRUCTURAL_ROOT, HI_ROOT, PORT_ROOT
from .config import digest
from .storage import write_json


def connect_existing(project, labels_root):
    project, labels_root = Path(project).expanduser().resolve(), Path(labels_root).expanduser().resolve()
    values = {
        'feature_root': str(project/'experiments/v10_goal65_20261024/cache/gnn'),
        'structural_root': str(project/'experiments/gnn36_structural_v8/cache/edges'),
        'hi_root': str(project/'experiments/v10_gnn_verify_20261025/cache/hi'),
        'port_root': str(project/'experiments/v10_fraudgt_compare_20261026/cache'),
    }
    for value in values.values():
        if not Path(value).is_dir(): raise FileNotFoundError(value)
    assets = EXPERIMENT_ROOT/'assets'
    assets.mkdir(parents=True, exist_ok=True)
    for name in ('positive_ids.npy', 'positive_classes.npy'):
        target = labels_root/name
        if not target.is_file(): raise FileNotFoundError(target)
        link = assets/name
        if link.exists():
            if link.resolve() != target: raise ValueError('Use a new work directory for different inputs')
        else: link.symlink_to(target)
    path = EXPERIMENT_ROOT/'inputs.json'
    if path.exists() and json.loads(path.read_text()) != values:
        raise ValueError('Use a new work directory for different inputs')
    write_json(path, values)
    return {'status':'connected', 'settings': str(path), 'next':'prepare in a fresh process'}


def validate_inputs():
    """Validate native converter dtypes and feature contracts before touching C."""
    metadata = json.loads((HI_ROOT/'complete.json').read_text())
    width, nodes = metadata['width'], metadata['nodes']
    files = {}
    def check(path, dtype=None, shape=None):
        a = np.load(path, mmap_mode='r', allow_pickle=False)
        if dtype is not None and a.dtype != np.dtype(dtype): raise ValueError(f'{path}: expected {dtype}, got {a.dtype}')
        if shape is not None and a.shape != shape: raise ValueError(f'{path}: expected {shape}, got {a.shape}')
        stat = path.stat()
        files[str(path)] = {'shape':list(a.shape), 'dtype':str(a.dtype), 'bytes':stat.st_size, 'mtime_ns':stat.st_mtime_ns}
        return a
    for name in ('src','dst','minute'): check(G/f'{name}.npy','int32',(width,))
    for name in ('present','z','fmt'): check(G/f'{name}.npy',shape=(width,))
    check(HI_ROOT/'paid_z.npy',shape=(width,))
    x=check(STRUCTURAL_ROOT/'x.npy')
    if x.ndim!=2 or x.shape[1]!=17: raise ValueError('Expected V10 structural features with 17 columns')
    check(STRUCTURAL_ROOT/'present.npy',shape=(len(x),))
    for role in ('incoming','outgoing'):
        offsets=check(HI_ROOT/f'{role}_time_offsets.npy','int64',(nodes+1,))
        ids=check(HI_ROOT/f'{role}_time_ids.npy','uint32')
        if offsets[0]!=0 or offsets[-1]!=len(ids) or (np.diff(offsets)<0).any(): raise ValueError('Invalid CSR offsets')
        check(PORT_ROOT/f'{role}_ports.npy',shape=(width,))
    ids=check(EXPERIMENT_ROOT/'assets/positive_ids.npy')
    labels=check(EXPERIMENT_ROOT/'assets/positive_classes.npy',shape=(len(ids),))
    if len(ids) and (ids[0]<0 or ids[-1]>=width or (np.diff(ids.astype(np.int64))<=0).any()): raise ValueError('Positive IDs must be sorted and unique')
    if not np.isin(labels,[1,9]).all(): raise ValueError('Positive classes must be 1 (known) or 9 (unmatched)')
    from .population import prepare_population
    splits=prepare_population()
    for window in splits['windows'].values(): check(G/'nodes'/f"{window['end']}.npy",shape=(nodes,19))
    for name in ('test_edge17.npy','test_edges_complete.json'):
        path=HI_ROOT/name
        if path.exists():
            stat=path.stat(); files[str(path)]={'bytes':stat.st_size,'mtime_ns':stat.st_mtime_ns}
    return {'files':files, 'labels_sha256':{name:digest(EXPERIMENT_ROOT/'assets'/name) for name in ('positive_ids.npy','positive_classes.npy')},
            'splits':splits, 'identity_method':'array shapes/dtypes/sizes/mtime + SHA256 of sparse labels; large input arrays are not fully hashed'}
