"""Read-only verification helpers, not used by the training sampler."""
import numpy as np


def union_reference(disjoint,topology,ids):
    nodes=np.unique(disjoint[0])
    order=np.argsort(disjoint[1],kind='stable')
    ordered=disjoint[1][order]
    starts=np.r_[0,np.flatnonzero(ordered[1:]!=ordered[:-1])+1] if len(ordered) else np.empty(0,dtype=np.int64)
    edges=ordered[starts]
    flags=np.bitwise_or.reduceat(disjoint[6][order],starts) if len(starts) else np.empty(0,dtype=np.int64)
    ts=np.searchsorted(nodes,topology.src[ids]);td=np.searchsorted(nodes,topology.dst[ids])
    ego=np.zeros(len(nodes),np.int64);ego[ts]=1;ego[td]=1
    return (nodes,edges,np.searchsorted(nodes,topology.src[edges]),np.searchsorted(nodes,topology.dst[edges]),ts,td,flags,ego)


def check_union(disjoint,shared,topology,ids):
    expected=union_reference(disjoint,topology,ids)
    for actual,reference in zip(shared,expected):np.testing.assert_array_equal(actual,reference)
    return dict(targets=len(ids),disjoint_nodes=len(disjoint[0]),shared_nodes=len(shared[0]),
                disjoint_edges=len(disjoint[1]),shared_edges=len(shared[1]),
                exact_sampled_union=True,parallel_transactions_preserved=True,
                batch_ego_verified=True,target_mapping_verified=True)
