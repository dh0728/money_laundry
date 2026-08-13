# -*- coding: utf-8 -*-
"""prep_feat_matrix.py의 hili 합성 버전 — 82차원 (기존 81 + is_li 1개), 단계별 프로세스 분리.

63M행 단일 프로세스는 cgroup 27GB에서 OOM (df 상주 + transient 중첩, glibc가
해제 메모리를 OS에 반환하지 않음). 단계별로 프로세스를 나눠 종료 시 OS가 전량 회수.

컬럼 레이아웃 (prepare_dataset과 동일 순서 — G39 small 평가와 정합):
  edge(d_edge) | timefreq 10 | curr_z 1 | curr_usd 1 | pattern 8 | cycle 8 | passthru 4 | pairagg 6 | is_li 1

사용: python prep_feat_matrix_hili.py <stage>
  stage: edge | currency | timefreq | pattern | caches  (순서대로 실행)
산출: data/processed/featmat_hili_medium.npy (float32, E×82)
"""
import gc
import os
import sys
import time

import numpy as np
import pandas as pd

os.environ.setdefault("DEVICE", "cpu")
os.environ.setdefault("TIME_FREQ", "1")
os.environ.setdefault("CURR_Z", "1")
os.environ.setdefault("CURR_USD", "1")
os.environ.setdefault("PATTERN", "1")
os.environ.setdefault("CYCLE", "1")
os.environ.setdefault("PASSTHRU", "1")
os.environ.setdefault("PAIRAGG", "1")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train_gnn_exp as T  # noqa: E402

DATA = T.DATA
NPY = DATA / "featmat_hili_medium.npy"

D_EDGE = 43  # hi/li medium 기본 엣지 피처 수 (edge 단계 로그로 검증)
C_TF = D_EDGE
C_Z, C_USD = D_EDGE + 10, D_EDGE + 11
C_PAT = D_EDGE + 12
C_CYC = D_EDGE + 20
C_PT = D_EDGE + 28
C_PA = D_EDGE + 32
C_LI = D_EDGE + 38
D = D_EDGE + 39


def std_block(mm, col, arr, tr_mask):
    mu = arr[tr_mask].mean(axis=0)
    sd = arr[tr_mask].std(axis=0)
    sd[sd < 1e-6] = 1.0
    mm[:, col:col + arr.shape[1]] = ((arr - mu) / sd).astype(np.float32)
    mm.flush()


def load_tr_mask():
    s = pd.read_parquet(DATA / "edges_hili_medium.parquet", columns=["split"])["split"]
    return (s == "train").to_numpy()


def stage_edge():
    t0 = time.time()
    cols = list(dict.fromkeys(
        ["from_id", "to_id", "is_self_transfer", "is_laundering", "split"]
        + T.EDGE_NUM + T.EDGE_CAT))
    df = pd.read_parquet(DATA / "edges_hili_medium.parquet", columns=cols)
    tr_mask = (df["split"] == "train").to_numpy()
    E = len(df)
    X0, cat_cols, num_stats = T.build_edge_features(df.loc[tr_mask])
    d_edge = X0.shape[1]
    assert d_edge == D_EDGE, f"기본 엣지 피처 수 불일치: {d_edge} != {D_EDGE}"
    mm = np.lib.format.open_memmap(NPY, mode="w+", dtype=np.float32, shape=(E, D))
    print(f"[hili_medium] {E:,}건 × {D}차원 → {NPY}", flush=True)
    mm[tr_mask, :d_edge] = X0
    del X0
    for s in ("valid", "test"):
        m = (df["split"] == s).to_numpy()
        Xs, _, _ = T.build_edge_features(df.loc[m], train_cols=cat_cols, num_stats=num_stats)
        mm[m, :d_edge] = Xs
        del Xs
    mm.flush()
    print(f"  기본 엣지 피처 {d_edge}개 ({time.time()-t0:.0f}s)", flush=True)


def stage_currency():
    t0 = time.time()
    cols = ["split", "payment_currency", "receiving_currency",
            "amount_received", "log1p_amount_paid"]
    df = pd.read_parquet(DATA / "edges_hili_medium.parquet", columns=cols)
    tr_mask = (df["split"] == "train").to_numpy()
    mm = np.lib.format.open_memmap(NPY, mode="r+")
    arr = T.compute_currency_z(df, tr_mask)
    mm[:, C_Z:C_Z + 1] = arr; del arr
    arr = T.compute_currency_usd(df, tr_mask)
    mm[:, C_USD:C_USD + 1] = arr; del arr
    mm.flush()
    print(f"  통화 z + USD 2개 ({time.time()-t0:.0f}s)", flush=True)


def _ids():
    df = pd.read_parquet(DATA / "edges_hili_medium.parquet",
                         columns=["timestamp", "from_id", "to_id"])
    ts_min = (df["timestamp"].astype("int64") // 60_000_000_000).to_numpy(np.int64)
    src = df["from_id"].to_numpy(np.int64)
    dst = df["to_id"].to_numpy(np.int64)
    n_nodes = int(max(src.max(), dst.max())) + 1
    return ts_min, src, dst, n_nodes


def stage_timefreq():
    t0 = time.time()
    ts_min, src, dst, n_nodes = _ids()
    tr_mask = load_tr_mask()
    arr = T.compute_timefreq_feats(ts_min, src, dst, n_nodes)
    mm = np.lib.format.open_memmap(NPY, mode="r+")
    std_block(mm, C_TF, arr, tr_mask)
    print(f"  시간/빈도 10개 ({time.time()-t0:.0f}s)", flush=True)


def stage_pattern():
    t0 = time.time()
    ts_min, src, dst, n_nodes = _ids()
    tr_mask = load_tr_mask()
    arr = T.compute_pattern_feats(ts_min, src, dst, n_nodes)
    mm = np.lib.format.open_memmap(NPY, mode="r+")
    std_block(mm, C_PAT, arr, tr_mask)
    print(f"  패턴 8개 ({time.time()-t0:.0f}s)", flush=True)


def stage_caches():
    t0 = time.time()
    tr_mask = load_tr_mask()
    mm = np.lib.format.open_memmap(NPY, mode="r+")
    arr = np.log1p(pd.read_parquet(
        DATA / "cycle3_hili_medium.parquet").to_numpy(np.float64)).astype(np.float32)
    std_block(mm, C_CYC, arr, tr_mask); del arr; gc.collect()
    print(f"  사이클 8개 ({time.time()-t0:.0f}s)", flush=True)
    arr = pd.read_parquet(DATA / "passthru_hili_medium.parquet").to_numpy(np.float32)
    std_block(mm, C_PT, arr, tr_mask); del arr; gc.collect()
    print(f"  자금통과 4개 ({time.time()-t0:.0f}s)", flush=True)
    arr = pd.read_parquet(DATA / "pairagg_hili_medium.parquet").to_numpy(np.float32)
    std_block(mm, C_PA, arr, tr_mask); del arr; gc.collect()
    print(f"  쌍 집계 6개 ({time.time()-t0:.0f}s)", flush=True)
    is_li = pd.read_parquet(DATA / "edges_hili_medium.parquet",
                            columns=["is_li"])["is_li"].to_numpy(np.float32).reshape(-1, 1)
    std_block(mm, C_LI, is_li, tr_mask)
    print(f"  is_li 1개 | 완료 ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    st = sys.argv[1]
    {"edge": stage_edge, "currency": stage_currency, "timefreq": stage_timefreq,
     "pattern": stage_pattern, "caches": stage_caches}[st]()
