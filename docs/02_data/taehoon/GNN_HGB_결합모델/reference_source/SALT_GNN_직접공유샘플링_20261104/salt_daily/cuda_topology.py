"""Exact two-hop integer sampler using CUDA kernels compiled by NVRTC."""
import ctypes as C
import glob
import importlib.util
from pathlib import Path

import numpy as np
import torch
from .shared_topology import SharedTopology
from .config import ROOT


class Kernel:
    def __init__(self, source):
        spec = importlib.util.find_spec('nvidia.cuda_nvrtc')
        if spec is None:
            raise RuntimeError('CUDA graph sampling requires NVIDIA NVRTC (installed with CUDA PyTorch)')
        paths = glob.glob(str(Path(next(iter(spec.submodule_search_locations)))/'lib/libnvrtc.so*'))
        if not paths:
            raise RuntimeError('NVIDIA NVRTC shared library was not found')
        self.nvrtc=C.CDLL(paths[0]); self.driver=C.CDLL('libcuda.so.1')
        nv=self.nvrtc; dr=self.driver
        nv.nvrtcCreateProgram.argtypes=[C.POINTER(C.c_void_p),C.c_char_p,C.c_char_p,C.c_int,C.c_void_p,C.c_void_p]
        nv.nvrtcCompileProgram.argtypes=[C.c_void_p,C.c_int,C.POINTER(C.c_char_p)]
        for prefix in ('ProgramLog','PTX'):
            getattr(nv,'nvrtcGet'+prefix+'Size').argtypes=[C.c_void_p,C.POINTER(C.c_size_t)]
            getattr(nv,'nvrtcGet'+prefix).argtypes=[C.c_void_p,C.c_void_p]
        nv.nvrtcDestroyProgram.argtypes=[C.POINTER(C.c_void_p)]
        dr.cuModuleLoadData.argtypes=[C.POINTER(C.c_void_p),C.c_void_p]
        dr.cuModuleGetFunction.argtypes=[C.POINTER(C.c_void_p),C.c_void_p,C.c_char_p]
        dr.cuLaunchKernel.argtypes=[C.c_void_p]+[C.c_uint]*7+[C.c_void_p,C.c_void_p,C.c_void_p]
        program=C.c_void_p()
        self.check(nv.nvrtcCreateProgram(C.byref(program),source.encode(),b'salt_cuda.cu',0,None,None))
        major,minor=torch.cuda.get_device_capability()
        options=(C.c_char_p*2)(f'--gpu-architecture=compute_{major}{minor}'.encode(),b'--std=c++11')
        result=nv.nvrtcCompileProgram(program,2,options)
        size=C.c_size_t(); nv.nvrtcGetProgramLogSize(program,C.byref(size))
        message=C.create_string_buffer(size.value);nv.nvrtcGetProgramLog(program,message)
        if result: raise RuntimeError(message.value.decode())
        self.check(nv.nvrtcGetPTXSize(program,C.byref(size)))
        ptx=C.create_string_buffer(size.value);self.check(nv.nvrtcGetPTX(program,ptx))
        self.module=C.c_void_p();self.function=C.c_void_p()
        self.check(dr.cuModuleLoadData(C.byref(self.module),ptx))
        self.check(dr.cuModuleGetFunction(C.byref(self.function),self.module,b'expand'))
        self.check(nv.nvrtcDestroyProgram(C.byref(program)))

    @staticmethod
    def check(result):
        if result: raise RuntimeError(f'CUDA sampler API error {result}')

    def launch(self, states, day, cap, raw, indices, flags, counts=None, starts=None, next_states=None, mode=2):
        if not len(states): return
        def pointer(value): return C.c_void_p(value.data_ptr() if value is not None else 0)
        values=[pointer(states),C.c_longlong(len(states)),C.c_longlong(day),C.c_longlong(cap)]
        values += [pointer(v) for v in (*raw,*indices,flags,counts,starts,next_states)]
        values += [C.c_int(mode)]
        args=(C.c_void_p*len(values))(*[C.cast(C.byref(v),C.c_void_p) for v in values])
        self.check(self.driver.cuLaunchKernel(self.function,(len(states)*2+127)//128,1,1,128,1,1,0,
                    C.c_void_p(torch.cuda.current_stream().cuda_stream),args,None))


class CudaTopology(SharedTopology):
    def __init__(self,dataset='hi',cap=100,source=None):
        super().__init__(dataset,cap)
        self.attach(source)

    def attach(self,source=None):
        source = source or ROOT/'salt_daily/cuda_sampler.cu'
        if not torch.cuda.is_available(): raise RuntimeError('CUDA sampler requires CUDA')
        assert all(a.dtype == np.int32 and a.flags.c_contiguous for a in (self.src,self.dst,self.minute))
        assert self.width < 2**31, 'GPU CSR uses signed int32 edge IDs'
        self.device=torch.device('cuda',torch.cuda.current_device())
        self.raw_gpu=tuple(torch.tensor(a,device=self.device) for a in (self.src,self.dst,self.minute))
        self.indices_gpu=tuple(torch.tensor(a.view(np.int32) if a.dtype==np.uint32 else a,device=self.device) for a in self.indices)
        self.flags_gpu=torch.zeros(self.width,dtype=torch.int32,device=self.device)
        self.kernel=Kernel(Path(source).read_text())

    @torch.no_grad()
    def batch_tensors(self,ids):
        assert torch.cuda.current_device() == self.device.index, 'CUDA sampler device changed'
        ids=np.ascontiguousarray(ids,dtype=np.int64)
        assert len(ids)>0 and ids.min()>=0 and ids.max()<self.width
        minutes=self.minute[ids]
        assert (minutes>=0).all() and (minutes//1440==minutes[0]//1440).all(), 'Mixed-day query batch'
        day=int(minutes[0]//1440)
        targets=torch.tensor(ids,device=self.device)
        src,dst,minute=self.raw_gpu
        target_src=src[targets].long(); target_dst=dst[targets].long()
        offsets=minute[targets].long()%1440
        states=torch.unique(torch.cat((target_src*1440+offsets,target_dst*1440+offsets)))
        counts=torch.empty(len(states)*2,dtype=torch.int64,device=self.device)
        flags=self.flags_gpu; flags.zero_()
        self.kernel.launch(states,day,self.cap,self.raw_gpu,self.indices_gpu,flags,counts=counts,mode=0)
        ends=counts.cumsum(0); starts=ends-counts
        next_states=torch.empty(int(ends[-1]),dtype=torch.int64,device=self.device)
        self.kernel.launch(states,day,self.cap,self.raw_gpu,self.indices_gpu,flags,starts=starts,next_states=next_states,mode=1)
        frontier=torch.unique(next_states)
        self.kernel.launch(frontier,day,self.cap,self.raw_gpu,self.indices_gpu,flags,mode=2)
        del next_states,frontier,states,counts,ends,starts
        edges=flags.nonzero().flatten()
        edge_src=src[edges].long();edge_dst=dst[edges].long()
        nodes=torch.unique(torch.cat((edge_src,edge_dst,target_src,target_dst)))
        local_src=torch.searchsorted(nodes,edge_src);local_dst=torch.searchsorted(nodes,edge_dst)
        ts=torch.searchsorted(nodes,target_src);td=torch.searchsorted(nodes,target_dst)
        ego=torch.zeros(len(nodes),dtype=torch.int64,device=self.device);ego[ts]=1;ego[td]=1
        return nodes,edges,local_src,local_dst,ts,td,flags[edges].long(),ego

    def batch(self, ids):
        return tuple(v.cpu().numpy() for v in self.batch_tensors(ids))
