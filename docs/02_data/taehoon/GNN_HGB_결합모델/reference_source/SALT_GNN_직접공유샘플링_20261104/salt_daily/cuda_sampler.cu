typedef long long I;
typedef unsigned int U;

__device__ I lower_edge(const int *ids, const int *minute, I lo, I hi, I target) {
    while (lo < hi) {
        I middle = lo + (hi-lo)/2;
        if (minute[ids[middle]] < target) lo=middle+1; else hi=middle;
    }
    return lo;
}

// mode 0 counts first-hop neighbors; 1 fills them; 2 only marks edges.
extern "C" __global__ void expand(
    const I *states, I count, I day, I cap, const int *src, const int *dst,
    const int *minute, const I *ipoff, const int *ip, const I *itoff, const int *it,
    const I *opoff, const int *op, const I *otoff, const int *ot,
    U *flags, I *counts, const I *starts, I *next, int mode) {
    I index = (I)blockIdx.x*blockDim.x+threadIdx.x;
    if (index >= count*2) return;
    int dir = index%2;
    I state=states[index/2], node=state/1440, offset=state%1440;
    I target=day*1440+offset, cutoff=(day+1)*1440;
    const I *poff=dir?opoff:ipoff, *toff=dir?otoff:itoff;
    const int *pi=dir?op:ip, *ti=dir?ot:it, *neighbor=dir?dst:src;
    I found=0, cursor=(mode==1)?starts[index]:0;
    for (I j=poff[node]; j<poff[node+1] && found<cap; ++j) {
        I edge=pi[j];
        if (minute[edge]>=cutoff || minute[edge]==target) continue;
        ++found;
        if (mode) atomicOr(flags+edge, dir?2U:1U);
        if (mode==1) next[cursor++]=(I)neighbor[edge]*1440+offset;
    }
    I lo=lower_edge(ti,minute,toff[node],toff[node+1],target);
    I hi=lower_edge(ti,minute,lo,toff[node+1],target+1);
    if (mode==0) {counts[index]=found+hi-lo; return;}
    for (I j=lo; j<hi; ++j) {
        I edge=ti[j];
        atomicOr(flags+edge, dir?2U:1U);
        if (mode==1) next[cursor++]=(I)neighbor[edge]*1440+offset;
    }
}
