"""IBM AML Small (HI/LI) 전처리 파이프라인.

docs/preprocessing_design.md 기준 구현.
- 엣지 피처 + split + 2단계 패턴 라벨
- 노드 매핑/라벨
- split별 누수 없는 노드 피처
산출물: workspace/data/processed/*.parquet + preprocessing_summary.md
"""

import csv
import re
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path("C:/Users/aica_/Documents/kimi/workspace")
AML_DIR = BASE / "AML"
OUT_DIR = BASE / "data" / "processed"

TRANS_COLS = [
    "Timestamp", "From Bank", "FromAccount", "To Bank", "ToAccount",
    "Amount Received", "Receiving Currency", "Amount Paid",
    "Payment Currency", "Payment Format", "Is Laundering",
]

TRAIN_END = pd.Timestamp("2022-09-08")  # train: 09-01 ~ 09-07
TEST_START = pd.Timestamp("2022-09-10")  # valid: 09-08 ~ 09-09, test: 09-10 ~

JOIN_KEYS = ["Timestamp", "From Bank", "FromAccount", "To Bank", "ToAccount", "Amount Paid"]

BEGIN_RE = re.compile(r"^BEGIN LAUNDERING ATTEMPT - ([^:]+?):")


def load_trans(path: Path) -> pd.DataFrame:
    df = pd.read_csv(
        path,
        header=0,
        names=TRANS_COLS,  # 'Account' 컬럼명 중복 → 위치 기반 리네임
        dtype={
            "From Bank": "string", "FromAccount": "string",
            "To Bank": "string", "ToAccount": "string",
            "Receiving Currency": "string", "Payment Currency": "string",
            "Payment Format": "string",
        },
    )
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], format="%Y/%m/%d %H:%M")
    df = df.sort_values("Timestamp", kind="stable").reset_index(drop=True)
    return df


def parse_patterns(path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Patterns.txt → (거래 단위 df, attempt 단위 df)."""
    tx_rows = []
    attempts = []
    attempt_id = -1
    pattern_type = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("BEGIN"):
                m = BEGIN_RE.match(line)
                pattern_type = m.group(1).strip() if m else line.split("-", 1)[-1].strip()
                attempt_id += 1
                attempts.append({"attempt_id": attempt_id, "pattern_type": pattern_type})
                continue
            if line.startswith("END"):
                pattern_type = None
                continue
            fields = next(csv.reader([line]))
            if len(fields) != len(TRANS_COLS):
                raise ValueError(f"필드 수 불일치: {line}")
            row = dict(zip(TRANS_COLS, fields))
            row["attempt_id"] = attempt_id
            row["pattern_type"] = pattern_type
            tx_rows.append(row)

    tx = pd.DataFrame(tx_rows)
    tx["Timestamp"] = pd.to_datetime(tx["Timestamp"], format="%Y/%m/%d %H:%M")
    tx["Amount Paid"] = tx["Amount Paid"].astype(float)
    tx["Amount Received"] = tx["Amount Received"].astype(float)
    for c in ["From Bank", "FromAccount", "To Bank", "ToAccount"]:
        tx[c] = tx[c].astype("string")

    att = pd.DataFrame(attempts)
    if len(tx):
        agg = (
            tx.groupby(["attempt_id", "pattern_type"])
            .agg(
                n_transactions=("Timestamp", "size"),
                start_time=("Timestamp", "min"),
                end_time=("Timestamp", "max"),
                total_amount_paid=("Amount Paid", "sum"),
            )
            .reset_index()
        )
        att = att.merge(agg, on=["attempt_id", "pattern_type"], how="left")
    return tx, att


def build_edges(df: pd.DataFrame, nodes: pd.DataFrame) -> pd.DataFrame:
    key_to_id = dict(zip(nodes["node_key"], nodes["node_id"]))
    df = df.copy()
    df["from_key"] = df["From Bank"] + "/" + df["FromAccount"]
    df["to_key"] = df["To Bank"] + "/" + df["ToAccount"]
    df["from_id"] = df["from_key"].map(key_to_id).astype(np.int64)
    df["to_id"] = df["to_key"].map(key_to_id).astype(np.int64)

    df["is_laundering"] = df["Is Laundering"].astype(np.int8)
    df["log1p_amount_paid"] = np.log1p(df["Amount Paid"]).astype(np.float32)
    df["is_exchange"] = (df["Amount Paid"] != df["Amount Received"]).astype(np.int8)
    df["is_self_transfer"] = (df["from_id"] == df["to_id"]).astype(np.int8)
    df["hour"] = df["Timestamp"].dt.hour.astype(np.int8)
    df["dayofweek"] = df["Timestamp"].dt.dayofweek.astype(np.int8)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24).astype(np.float32)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24).astype(np.float32)

    conds = [df["Timestamp"] < TRAIN_END, df["Timestamp"] < TEST_START]
    df["split"] = np.select(conds, ["train", "valid"], default="test")

    edges = df.rename(
        columns={
            "Timestamp": "timestamp",
            "Amount Paid": "amount_paid",
            "Amount Received": "amount_received",
            "Receiving Currency": "receiving_currency",
            "Payment Currency": "payment_currency",
            "Payment Format": "payment_format",
        }
    )[
        [
            "timestamp", "from_id", "to_id",
            "amount_paid", "amount_received", "log1p_amount_paid",
            "is_exchange", "is_self_transfer",
            "hour", "dayofweek", "hour_sin", "hour_cos",
            "receiving_currency", "payment_currency", "payment_format",
            "is_laundering", "split",
            # 조인 검증용 원본 키 (저장 전 제거)
            "From Bank", "FromAccount", "To Bank", "ToAccount",
        ]
    ]
    return edges


def join_pattern_labels(edges: pd.DataFrame, pattern_tx: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """파싱된 패턴 거래를 세탁 엣지에 조인해 pattern_type 부여."""
    laund = edges[edges["is_laundering"] == 1].copy()
    keys_edges = ["Timestamp", "From Bank", "FromAccount", "To Bank", "ToAccount", "Amount Paid"]
    laund["_edge_idx"] = laund.index  # 원본 엣지 인덱스 보존 (merge 후 복원용)
    laund["Timestamp"] = laund["timestamp"]
    laund["Amount Paid"] = laund["amount_paid"]

    n_pattern = len(pattern_tx)
    n_laund = len(laund)
    # 키 중복 여부 확인 (조인 폭증 방지)
    dup_e = int(laund.duplicated(subset=keys_edges).sum())
    dup_p = int(pattern_tx.duplicated(subset=JOIN_KEYS).sum())

    merged = laund.merge(
        pattern_tx[JOIN_KEYS + ["pattern_type", "attempt_id"]],
        on=keys_edges,
        how="outer",
        indicator=True,
        suffixes=("", "_pat"),
    )
    matched = merged[merged["_merge"] == "both"]
    stats = {
        "n_pattern_tx": n_pattern,
        "n_laundering_edges": n_laund,
        "dup_keys_in_edges": dup_e,
        "dup_keys_in_patterns": dup_p,
        "n_matched": int(len(matched)),
        "n_pattern_unmatched": int((merged["_merge"] == "right_only").sum()),
        "n_laund_unmatched": int((merged["_merge"] == "left_only").sum()),
    }
    stats["join_success_rate_pct"] = round(
        100.0 * stats["n_matched"] / max(n_pattern, 1), 4
    )

    # 매칭 결과 → 원본 엣지 인덱스에 pattern_type 부여
    edges["pattern_type"] = pd.Series(pd.NA, index=edges.index, dtype="string")
    edges["attempt_id"] = pd.Series(pd.NA, index=edges.index, dtype="Int64")
    matched_idx = matched["_edge_idx"].astype(np.int64)
    edges.loc[matched_idx, "pattern_type"] = matched["pattern_type"].values
    edges.loc[matched_idx, "attempt_id"] = matched["attempt_id"].values
    return edges, stats, merged


def compute_node_features(tx: pd.DataFrame, nodes: pd.DataFrame) -> pd.DataFrame:
    """주어진 거래 부분집합으로 노드 피처 집계 (전체 노드 기준, 없으면 0)."""
    n = len(nodes)
    out = tx.groupby("from_id").agg(
        out_degree=("to_id", "nunique"),
        total_sent=("amount_paid", "sum"),
        out_tx=("to_id", "size"),
        sent_currencies=("payment_currency", "nunique"),
        sent_formats=("payment_format", "nunique"),
    )
    inc = tx.groupby("to_id").agg(
        in_degree=("from_id", "nunique"),
        total_received=("amount_received", "sum"),
        in_tx=("from_id", "size"),
        recv_currencies=("receiving_currency", "nunique"),
        recv_formats=("payment_format", "nunique"),
    )
    self_cnt = (
        tx[tx["is_self_transfer"] == 1]
        .groupby("from_id")
        .size()
        .rename("self_transfer_count")
    )

    idx = pd.Index(np.arange(n), name="node_id")
    feat = pd.DataFrame(index=idx)
    for df_ in (out, inc, self_cnt.to_frame()):
        feat = feat.join(df_)
    feat = feat.fillna(0)

    feat["tx_count"] = feat["in_tx"] + feat["out_tx"]
    feat["net_flow"] = feat["total_received"] - feat["total_sent"]
    # 통화/결제수단 다양성: 송신·수신 양방향 distinct 합산의 상한이 되므로
    # 정확한 union을 위해 별도 집계
    cur = pd.concat(
        [
            tx[["from_id", "payment_currency"]].rename(
                columns={"from_id": "node_id", "payment_currency": "cur"}
            ),
            tx[["to_id", "receiving_currency"]].rename(
                columns={"to_id": "node_id", "receiving_currency": "cur"}
            ),
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

    feat = feat.drop(columns=["in_tx", "out_tx", "sent_currencies", "sent_formats",
                              "recv_currencies", "recv_formats"])
    base_cols = ["in_degree", "out_degree", "total_sent", "total_received",
                 "net_flow", "tx_count", "self_transfer_count",
                 "n_currencies", "n_payment_formats"]
    feat = feat[base_cols]
    for c in ["in_degree", "out_degree", "tx_count", "self_transfer_count",
              "n_currencies", "n_payment_formats"]:
        feat[c] = feat[c].astype(np.int64)
    for c in ["total_sent", "total_received", "net_flow"]:
        feat[c] = feat[c].astype(np.float64)
    # log1p 병기 (degree·금액·건수; net_flow는 음수 가능으로 제외)
    for c in ["in_degree", "out_degree", "total_sent", "total_received",
              "tx_count", "self_transfer_count"]:
        feat[f"log1p_{c}"] = np.log1p(feat[c].clip(lower=0)).astype(np.float32)

    feat = feat.reset_index()
    return feat


def process_dataset(tag: str) -> dict:
    """tag: 'HI' or 'LI'."""
    print(f"\n{'='*60}\n[{tag}-Small] 처리 시작\n{'='*60}")
    trans_path = AML_DIR / f"{tag}-Small_Trans.csv"
    patterns_path = AML_DIR / f"{tag}-Small_Patterns.txt"

    df = load_trans(trans_path)
    print(f"Trans 로드: {len(df):,}건, 기간 {df['Timestamp'].min()} ~ {df['Timestamp'].max()}")

    # 노드 매핑
    from_keys = df["From Bank"] + "/" + df["FromAccount"]
    to_keys = df["To Bank"] + "/" + df["ToAccount"]
    node_keys = pd.Index(pd.unique(pd.concat([from_keys, to_keys]))).sort_values()
    nodes = pd.DataFrame({"node_key": node_keys})
    nodes["node_id"] = np.arange(len(nodes), dtype=np.int64)
    split_ka = nodes["node_key"].str.split("/", n=1, expand=True)
    nodes["bank"] = split_ka[0].astype("string").values
    nodes["account"] = split_ka[1].astype("string").values
    nodes = nodes[["node_id", "bank", "account", "node_key"]]
    print(f"노드 수: {len(nodes):,}")

    # 엣지
    edges = build_edges(df, nodes)
    del df

    # 패턴 파싱 + 조인
    pattern_tx, attempts = parse_patterns(patterns_path)
    print(f"패턴 attempt 수: {len(attempts)}, 파싱된 세탁 거래 수: {len(pattern_tx):,}")
    edges, join_stats, merged_unmatched = join_pattern_labels(edges, pattern_tx)
    print(f"조인 통계: {join_stats}")

    # 노드 라벨
    laund = edges[edges["is_laundering"] == 1]
    laund_nodes = np.unique(np.concatenate([laund["from_id"].values, laund["to_id"].values]))
    nodes["is_laundering_node"] = np.int8(0)
    nodes.loc[nodes["node_id"].isin(laund_nodes), "is_laundering_node"] = np.int8(1)

    # 노드 피처 (누수 방지)
    # train용: train 기간(09-01~09-07) 거래만
    # valid용: 09-08 이전(train 기간) 거래만 → 09-08 이후 거래 미포함 확인
    # test용: 09-10 이전(train+valid 기간) 거래만
    feat_parts = []
    windows = {
        "train": edges[edges["timestamp"] < TRAIN_END],
        "valid": edges[edges["timestamp"] < TRAIN_END],
        "test": edges[edges["timestamp"] < TEST_START],
    }
    for split_name, window in windows.items():
        f = compute_node_features(window, nodes)
        f["split"] = split_name
        feat_parts.append(f)
        print(f"  node_features[{split_name}]: 입력 거래 {len(window):,}건 "
              f"(최대 시각 {window['timestamp'].max()})")
    node_features = pd.concat(feat_parts, ignore_index=True)

    # 저장
    edges_out = edges.drop(columns=["From Bank", "FromAccount", "To Bank", "ToAccount"])
    nodes_out = nodes.drop(columns=["node_key"])
    edges_out.to_parquet(OUT_DIR / f"edges_{tag.lower()}_small.parquet", index=False)
    nodes_out.to_parquet(OUT_DIR / f"nodes_{tag.lower()}_small.parquet", index=False)
    node_features.to_parquet(OUT_DIR / f"node_features_{tag.lower()}_small.parquet", index=False)
    attempts.to_parquet(OUT_DIR / f"patterns_{tag.lower()}_small.parquet", index=False)
    # 노드 키 매핑표 (추론 Worker 공유용)
    nodes.to_parquet(OUT_DIR / f"node_mapping_{tag.lower()}_small.parquet", index=False)

    # 검증 수치
    summary = {
        "tag": tag,
        "n_edges": len(edges),
        "n_nodes": len(nodes),
        "n_laundering_edges": int(edges["is_laundering"].sum()),
        "laundering_rate_pct": round(100.0 * edges["is_laundering"].mean(), 4),
        "n_laundering_nodes": int(nodes["is_laundering_node"].sum()),
        "split_stats": (
            edges.groupby("split")
            .agg(n=("is_laundering", "size"), n_laund=("is_laundering", "sum"))
            .assign(rate_pct=lambda d: (100 * d["n_laund"] / d["n"]).round(4))
            .reset_index()
        ),
        "n_self_transfers": int(edges["is_self_transfer"].sum()),
        "n_exchange": int(edges["is_exchange"].sum()),
        "n_attempts": len(attempts),
        "pattern_type_counts": attempts["pattern_type"].value_counts().to_dict(),
        "join_stats": join_stats,
        "period_min": str(edges["timestamp"].min()),
        "period_max": str(edges["timestamp"].max()),
    }
    return summary, edges, nodes, node_features, attempts, merged_unmatched


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summaries = []
    extras = {}
    for tag in ["HI", "LI"]:
        s, edges, nodes, nf, att, unmatched = process_dataset(tag)
        summaries.append(s)
        extras[tag] = (edges, nodes, nf, att, unmatched)

    # summary md 작성
    lines = ["# 전처리 검증 요약 (preprocessing_summary)", ""]
    lines.append(f"- 생성 스크립트: `src/preprocessing/build_dataset.py`")
    lines.append(f"- 산출 위치: `data/processed/`")
    lines.append("")
    for s in summaries:
        tag = s["tag"]
        lines.append(f"## {tag}-Small")
        lines.append("")
        lines.append(f"- 데이터 기간: {s['period_min']} ~ {s['period_max']}")
        lines.append(f"- 엣지(거래) 수: {s['n_edges']:,}")
        lines.append(f"- 노드(계좌) 수: {s['n_nodes']:,}")
        lines.append(f"- 세탁 엣지: {s['n_laundering_edges']:,}건 ({s['laundering_rate_pct']}%)")
        lines.append(f"- 세탁 연루 노드: {s['n_laundering_nodes']:,}")
        lines.append(f"- 셀프이체 엣지: {s['n_self_transfers']:,}건, 환전 엣지: {s['n_exchange']:,}건")
        lines.append("")
        lines.append("### split별 거래/세탁 건수")
        lines.append("")
        lines.append("| split | 거래 수 | 세탁 수 | 세탁 비율(%) |")
        lines.append("|---|---|---|---|")
        for _, r in s["split_stats"].iterrows():
            lines.append(f"| {r['split']} | {int(r['n']):,} | {int(r['n_laund']):,} | {r['rate_pct']} |")
        lines.append("")
        lines.append("### 패턴 라벨 조인 검증")
        lines.append("")
        js = s["join_stats"]
        lines.append(f"- Patterns.txt attempt 수: {s['n_attempts']} (기대값: {'370' if tag=='HI' else '117'})")
        lines.append(f"- 파싱된 패턴 거래 수: {js['n_pattern_tx']:,}")
        lines.append(f"- Trans 내 Is Laundering=1 엣지 수: {js['n_laundering_edges']:,}")
        lines.append(f"- 조인 성공: {js['n_matched']:,}건 ({js['join_success_rate_pct']}%)")
        lines.append(f"- 패턴 측 미매칭: {js['n_pattern_unmatched']:,}건 / Trans 세탁 측 미매칭: {js['n_laund_unmatched']:,}건")
        lines.append(f"- 조인 키 중복: 엣지 측 {js['dup_keys_in_edges']}건, 패턴 측 {js['dup_keys_in_patterns']}건")
        lines.append("")
        lines.append("### 패턴 유형별 attempt 수")
        lines.append("")
        lines.append("| pattern_type | attempt 수 |")
        lines.append("|---|---|")
        for k in sorted(s["pattern_type_counts"]):
            lines.append(f"| {k} | {s['pattern_type_counts'][k]} |")
        lines.append("")

    lines.append("## 노드 수 EDA 대조")
    lines.append("")
    lines.append("| 데이터셋 | 생성 노드 수 | EDA 기대값 | 일치 |")
    lines.append("|---|---|---|---|")
    exp = {"HI": 515_088, "LI": 705_907}
    for s in summaries:
        lines.append(
            f"| {s['tag']}-Small | {s['n_nodes']:,} | {exp[s['tag']]:,} | "
            f"{'O' if s['n_nodes'] == exp[s['tag']] else 'X'} |"
        )
    lines.append("")
    lines.append("## node_features 누수 방지 로직")
    lines.append("")
    lines.append("- train 피처: `timestamp < 2022-09-08` 거래만 사용 (train 기간 09-01~09-07)")
    lines.append("- valid 피처: `timestamp < 2022-09-08` 거래만 사용 → 09-08 이후 거래 미포함")
    lines.append("- test 피처: `timestamp < 2022-09-10` 거래만 사용 (train+valid 기간)")
    lines.append("")

    (OUT_DIR / "preprocessing_summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nsummary 저장: {OUT_DIR / 'preprocessing_summary.md'}")

    # 조인 실패 원인 분석용 출력
    for tag, (_, _, _, _, unmatched) in extras.items():
        js = [s for s in summaries if s["tag"] == tag][0]["join_stats"]
        if js["n_pattern_unmatched"] + js["n_laund_unmatched"] > 0:
            fail = unmatched[unmatched["_merge"] != "both"]
            print(f"\n[{tag}] 조인 실패 샘플:")
            print(fail.head(20).to_string())


if __name__ == "__main__":
    main()
