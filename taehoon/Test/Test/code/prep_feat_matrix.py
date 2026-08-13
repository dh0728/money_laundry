# -*- coding: utf-8 -*-
"""피처 행렬(엣지 81개)을 메모리맵 .npy로 블록 단위 생성.

cgroup 27GB 제한 환경에서 prepare_dataset의 np.concatenate 피크(16GB+)를 피하기 위해
최종 배열을 디스크에 직접 채운다. 로직·표준화·컬럼 순서는 train_gnn_exp.prepare_dataset과 동일.

사용: python prep_feat_matrix.py [ds] [suffix]
산출: data/processed/featmat_{ds}_{suffix}.npy (float32, E×81)
"""
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


def std_block(mm, col, arr, tr_mask):
    """train 평균/표준편차 표준화 후 기록."""
    mu = arr[tr_mask].mean(axis=0)
    sd = arr[tr_mask].std(axis=0)
    sd[sd < 1e-6] = 1.0
    mm[:, col:col + arr.shape[1]] = ((arr - mu) / sd).astype(np.float32)
    return col + arr.shape[1]


def main(ds, suffix):
    t0 = time.time()
    cols = list(dict.fromkeys(
        ["from_id", "to_id", "is_self_transfer", "is_laundering", "split"]
        + T.EDGE_NUM + T.EDGE_CAT
        + ["timestamp", "payment_currency", "receiving_currency",
           "amount_received", "log1p_amount_paid"]))
    df = pd.read_parquet(DATA / f"edges_{ds}_{suffix}.parquet", columns=cols)
    tr_mask = (df["split"] == "train").to_numpy()
    E = len(df)

    # 전체 차원 산정: 기본 엣지 피처 + 블록별 크기
    X0, cat_cols, num_stats = T.build_edge_features(df.loc[tr_mask])
    d_edge = X0.shape[1]
    D = d_edge + 10 + 1 + 1 + 8 + 8 + 4 + 6
    out_path = DATA / f"featmat_{ds}_{suffix}.npy"
    mm = np.lib.format.open_memmap(out_path, mode="w+", dtype=np.float32, shape=(E, D))
    print(f"[{ds}_{suffix}] {E:,}건 × {D}차원 → {out_path}", flush=True)

    # 1) 기본 엣지 피처 (수치 표준화 + 범주 원핫, train 통계 기준)
    mm[tr_mask, :d_edge] = X0
    del X0
    for s in ("valid", "test"):
        m = (df["split"] == s).to_numpy()
        Xs, _, _ = T.build_edge_features(df.loc[m], train_cols=cat_cols, num_stats=num_stats)
        mm[m, :d_edge] = Xs
        del Xs
    col = d_edge
    print(f"  기본 엣지 피처 {d_edge}개 ({time.time()-t0:.0f}s)", flush=True)

    ts_min = (df["timestamp"].astype("int64") // 60_000_000_000).to_numpy(np.int64)
    src = df["from_id"].to_numpy(np.int64)
    dst = df["to_id"].to_numpy(np.int64)
    n_nodes = int(max(src.max(), dst.max())) + 1

    # 2) 시간/빈도 10개
    arr = T.compute_timefreq_feats(ts_min, src, dst, n_nodes)
    col = std_block(mm, col, arr, tr_mask); del arr
    print(f"  시간/빈도 10개 ({time.time()-t0:.0f}s)", flush=True)

    # 3) 통화 robust z 1개 + USD 환산 1개 (표준화 없음, prepare_dataset과 동일)
    arr = T.compute_currency_z(df, tr_mask)
    mm[:, col:col + 1] = arr; col += 1; del arr
    arr = T.compute_currency_usd(df, tr_mask)
    mm[:, col:col + 1] = arr; col += 1; del arr
    print(f"  통화 z + USD 2개 ({time.time()-t0:.0f}s)", flush=True)

    # 4) 패턴 8개
    arr = T.compute_pattern_feats(ts_min, src, dst, n_nodes)
    col = std_block(mm, col, arr, tr_mask); del arr
    print(f"  패턴 8개 ({time.time()-t0:.0f}s)", flush=True)

    # 5) 사이클 8개 (log1p 후 표준화)
    arr = np.log1p(pd.read_parquet(
        DATA / f"cycle3_{ds}_{suffix}.parquet").to_numpy(np.float64)).astype(np.float32)
    col = std_block(mm, col, arr, tr_mask); del arr
    print(f"  사이클 8개 ({time.time()-t0:.0f}s)", flush=True)

    # 6) 자금통과 4개
    arr = pd.read_parquet(DATA / f"passthru_{ds}_{suffix}.parquet").to_numpy(np.float32)
    col = std_block(mm, col, arr, tr_mask); del arr
    print(f"  자금통과 4개 ({time.time()-t0:.0f}s)", flush=True)

    # 7) 쌍 집계 6개
    arr = pd.read_parquet(DATA / f"pairagg_{ds}_{suffix}.parquet").to_numpy(np.float32)
    col = std_block(mm, col, arr, tr_mask); del arr
    print(f"  쌍 집계 6개 ({time.time()-t0:.0f}s)", flush=True)

    assert col == D, f"차원 불일치: {col} != {D}"
    mm.flush()
    print(f"완료 ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "hi",
         sys.argv[2] if len(sys.argv) > 2 else "medium")
