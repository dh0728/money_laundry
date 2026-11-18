"""Probe the native PyG sampler before opening the real period graph."""
import platform
import torch


def check_backend():
    try:
        import pyg_lib
        import torch_geometric
        from torch_geometric import typing
        if not typing.WITH_PYG_LIB:raise ImportError('PyG cached WITH_PYG_LIB=False; restart this kernel')
        from torch_geometric.data import HeteroData
        from torch_geometric.loader import LinkNeighborLoader
        relation=('node','to','node');data=HeteroData()
        data['node'].x=torch.ones(4,1)
        data[relation].edge_index=torch.tensor([[0,1,2,3,0,2],[1,2,3,0,2,1]])
        with torch.random.fork_rng(devices=[]):
            loader=LinkNeighborLoader(data,num_neighbors=[50,50],edge_label_index=(relation,data[relation].edge_index[:,:2]),
                batch_size=2,shuffle=False,num_workers=0,replace=False,subgraph_type='directional')
            assert next(iter(loader))[relation].input_id.numel()==2
    except (ImportError,OSError,RuntimeError) as e:
        raise RuntimeError('Install a pyg-lib wheel matching PyTorch/CUDA, restart the notebook kernel, and retry. See README.') from e
    return {'status':'pass','python':platform.python_version(),'torch':torch.__version__,'cuda':torch.version.cuda,
            'torch_geometric':torch_geometric.__version__,'pyg_lib':pyg_lib.__version__,'native_sampler':'passed'}
