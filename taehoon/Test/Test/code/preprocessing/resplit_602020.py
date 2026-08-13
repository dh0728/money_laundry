"""60/20/20 시간 분할(행 수 기준, 논문 프로토콜)로 재분할.

기존 전처리는 고정 날짜(09-08/09-10) 경계라 test가 4.1%에 불과했다.
논문/PDF 기준: 시간순 정렬 후 행 기준 60%/80% 위치를 경계로 사용
(PDF의 train 3,046,861건 = 전체의 정확히 60.00%와 일치).

기존 edges parquet의 컬럼을 그대로 유지하며 split만 교체하고,
노드 피처는 새 경계의 윈도우(train/valid: T1 이전, test: T2 이전)로 재집계.
산출물: edges_{ds}_v2.parquet, node_features_{ds}_v2.parquet → DS_SUFFIX=v2로 사용.
"""
import time
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path("data/processed")


def compute_node_features(tx: pd.DataFrame, n_nodes: int) -> pd.DataFrame:
    """build_dataset.compute_node_features와 동일 로직 (nodes 테이블 대신 n_nodes)."""
    idx = pd.Index(np.arange(n_nodes), name="node_id")
    out = tx.groupby("from_id").agg(
        out_degree=("to_id", "nunique"),
        total_sent=("amount_paid", "sum"),
        out_tx=("to_id", "size"),
    )
    inc = tx.groupby("to_id").agg(
        in_degree=("from_id", "nunique"),
        total_received=("amount_received", "sum"),
        in_tx=("from_id", "size"),
    )
    self_cnt = (
        tx[tx["is_self_transfer"] == 1].groupby("from_id").size().rename("self_transfer_count")
    )
    feat = pd.DataFrame(index=idx)
    for d in (out, inc, self_cnt.to_frame()):
        feat = feat.join(d)
    feat = feat.fillna(0)
    feat["tx_count"] = feat["in_tx"] + feat["out_tx"]
    feat["net_flow"] = feat["total_received"] - feat["total_sent"]
    cur = pd.concat(
        [
            tx[["from_id", "payment_currency"]].rename(
                columns={"from_id": "node_id", "payment_currency": "cur"}),
            tx[["to_id", "receiving_currency"]].rename(
                columns={"to_id": "node_id", "receiving_currency": "cur"}),
        ]
    )
    feat["n_currencies"] = cur.groupby("node_id")["cur"].nunique().reindex(idx, fill_value=0)
    fmt = pd.concat(
        [
            tx[["from_id", "payment_format"]].rename(columns={"from_id": "node_id"}),
            tx[["to_id", "payment_format"]].rename(columns={"to_id": "node_id"}),
        ]
    )
    feat["n_payment_formats"] = (
        fmt.groupby("node_id")["payment_format"].nunique().reindex(idx, fill_value=0)
    )
    base = ["in_degree", "out_degree", "total_sent", "total_received",
            "net_flow", "tx_count", "self_transfer_count",
            "n_currencies", "n_payment_formats"]
    feat = feat[base]
    for c in ["in_degree", "out_degree", "tx_count", "self_transfer_count",
              "n_currencies", "n_payment_formats"]:
        feat[c] = feat[c].astype(np.int64)
    for c in ["total_sent", "total_received", "net_flow"]:
        feat[c] = feat[c].astype(np.float64)
    for c in ["in_degree", "out_degree", "total_sent", "total_received",
              "tx_count", "self_transfer_count"]:
        feat[f"log1p_{c}"] = np.log1p(feat[c].clip(lower=0)).astype(np.float32)
    return feat.reset_index()


def resplit(ds: str, suffix: str):
    t0 = time.time()
    edges = pd.read_parquet(DATA / f"edges_{ds}_{suffix}.parquet")
    ts = edges["timestamp"]
    ts_sorted = ts.sort_values(kind="stable")
    n = len(edges)
    t1 = ts_sorted.iloc[int(n * 0.6)]
    t2 = ts_sorted.iloc[int(n * 0.8)]
    print(f"[{ds}_{suffix}] {n:,}건 | 경계 T1={t1}, T2={t2}")

    edges["split"] = np.select(
        [ts < t1, ts < t2], ["train", "valid"], default="test"
    )
    stat = edges.groupby("split")["is_laundering"].agg(["size", "sum"])
    print(stat.assign(ratio=lambda d: (d["size"] / n).round(4)))

    edges.to_parquet(DATA / f"edges_{ds}_v2.parquet", index=False)

    n_nodes = int(max(edges["from_id"].max(), edges["to_id"].max())) + 1
    parts = []
    for name, window in (
        ("train", edges[ts < t1]),
        ("valid", edges[ts < t1]),
        ("test", edges[ts < t2]),
    ):
        f = compute_node_features(window, n_nodes)
        f["split"] = name
        parts.append(f)
    nf = pd.concat(parts, ignore_index=True)
    nf.to_parquet(DATA / f"node_features_{ds}_v2.parquet", index=False)
    print(f"  저장 완료 ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    resplit("hi", "small")
    resplit("li", "small")
