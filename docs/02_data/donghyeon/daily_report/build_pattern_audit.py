"""IBM AML Small 데이터셋의 패턴/패턴 외 거래를 검토하는 독립형 HTML 생성기.

원본 CSV를 그대로 입력으로 사용한다. 생성 과정에서 다음을 수행한다.

1. 은행·계좌 식별자를 문자열로 읽어 선행 0을 보존한다.
2. Timestamp를 datetime으로 변환한다.
3. Trans의 완전 중복 행을 제거한다.
4. Patterns.txt를 attempt 단위로 파싱한다.
5. 패턴에 포함되지 않은 Is Laundering=1 거래를 연결요소로 묶는다.
6. 자금세탁 거래 주변의 정상 거래를 1홉 문맥으로 요약한다.
7. 구조 지표, 시간순 거래표, 사람 검토 양식을 포함한 HTML을 만든다.

실행 예시
---------
python build_pattern_audit.py --data-dir ../../../data
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd


TRANSACTION_COLUMNS = [
    "Timestamp",
    "From Bank",
    "Account",
    "To Bank",
    "Account.1",
    "Amount Received",
    "Receiving Currency",
    "Amount Paid",
    "Payment Currency",
    "Payment Format",
    "Is Laundering",
]

ID_DTYPES = {
    "From Bank": "string",
    "Account": "string",
    "To Bank": "string",
    "Account.1": "string",
}

ACCOUNT_DTYPES = {
    "Bank ID": "string",
    "Account Number": "string",
    "Entity ID": "string",
    "Bank Name": "string",
    "Entity Name": "string",
}

PATTERN_ORDER = [
    "FAN-OUT",
    "FAN-IN",
    "CYCLE",
    "GATHER-SCATTER",
    "SCATTER-GATHER",
    "BIPARTITE",
    "STACK",
    "RANDOM",
    "패턴 외",
]

PATTERN_EXPECTATIONS = {
    "FAN-OUT": "한 중심 계좌에서 여러 계좌로 분산되는 구조",
    "FAN-IN": "여러 계좌에서 한 중심 계좌로 집중되는 구조",
    "CYCLE": "방향을 따라가면 시작 계좌로 돌아오는 순환 구조",
    "GATHER-SCATTER": "여러 계좌에서 모인 뒤 중심 계좌가 다시 분산하는 구조",
    "SCATTER-GATHER": "한 계좌에서 분산된 뒤 여러 경로가 한 계좌로 모이는 구조",
    "BIPARTITE": "여러 송금 계좌 집합과 여러 수취 계좌 집합이 연결되는 구조",
    "STACK": "앞 단계의 수취 계좌가 다음 단계의 송금 계좌가 되는 다단계 구조",
    "RANDOM": "정형 패턴보다 불규칙한 연결 경로",
    "패턴 외": "Patterns.txt에 선언되지 않은 자금세탁 라벨 거래",
}


def node_id(bank: object, account: object) -> str:
    return f"{bank}::{account}"


def canonical_bank_id(bank: object) -> str:
    """조인용 은행 ID. 화면에는 원본의 선행 0을 그대로 유지한다."""
    value = str(bank)
    return value.lstrip("0") or "0"


def iso_minute(value: pd.Timestamp) -> str:
    if pd.isna(value):
        return ""
    return value.strftime("%Y-%m-%d %H:%M")


def json_safe_number(value: object) -> float | int | None:
    if value is None or pd.isna(value):
        return None
    value = float(value)
    if not math.isfinite(value):
        return None
    return value


def read_transactions(path: Path) -> tuple[pd.DataFrame, dict[str, int]]:
    df = pd.read_csv(path, dtype=ID_DTYPES, low_memory=False)
    raw_rows = len(df)

    df["Timestamp"] = pd.to_datetime(
        df["Timestamp"],
        format="%Y/%m/%d %H:%M",
        errors="coerce",
    )
    timestamp_failures = int(df["Timestamp"].isna().sum())
    if timestamp_failures:
        raise ValueError(f"{path.name}: Timestamp 변환 실패 {timestamp_failures}건")

    for column in ("Amount Received", "Amount Paid"):
        df[column] = pd.to_numeric(df[column], errors="coerce")
        failures = int(df[column].isna().sum())
        if failures:
            raise ValueError(f"{path.name}: {column} 변환 실패 {failures}건")

    df["Is Laundering"] = pd.to_numeric(
        df["Is Laundering"], errors="raise"
    ).astype("int8")

    duplicate_rows = int(df.duplicated().sum())
    df = df.drop_duplicates().reset_index(drop=True)

    stats = {
        "raw_rows": raw_rows,
        "deduplicated_rows": len(df),
        "removed_duplicates": duplicate_rows,
        "laundering_rows": int(df["Is Laundering"].eq(1).sum()),
    }
    return df, stats


def parse_patterns(path: Path, ratio: str) -> pd.DataFrame:
    records: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    attempt_number = 0
    transaction_order = 0

    with path.open("r", encoding="utf-8", errors="replace", newline="") as file:
        for line_number, raw_line in enumerate(file, start=1):
            line = raw_line.strip()
            if not line:
                continue

            begin_prefix = "BEGIN LAUNDERING ATTEMPT - "
            end_prefix = "END LAUNDERING ATTEMPT - "

            if line.startswith(begin_prefix):
                if current is not None:
                    raise ValueError(f"{path.name}:{line_number} 중첩된 BEGIN")
                attempt_number += 1
                pattern_text = line[len(begin_prefix) :].strip()
                parts = pattern_text.split(":", 1)
                current = {
                    "Dataset": ratio,
                    "Attempt ID": f"{ratio}_{attempt_number:04d}",
                    "Attempt Number": attempt_number,
                    "Pattern Type": parts[0].strip().upper(),
                    "Pattern Meta": parts[1].strip() if len(parts) == 2 else "",
                }
                transaction_order = 0
                continue

            if line.startswith(end_prefix):
                if current is None:
                    raise ValueError(f"{path.name}:{line_number} BEGIN 없는 END")
                end_type = line[len(end_prefix) :].strip().upper()
                if end_type != current["Pattern Type"]:
                    raise ValueError(
                        f"{path.name}:{line_number} BEGIN/END 패턴 불일치: "
                        f"{current['Pattern Type']} != {end_type}"
                    )
                current = None
                transaction_order = 0
                continue

            if current is None:
                raise ValueError(f"{path.name}:{line_number} attempt 밖의 거래")

            values = next(csv.reader([line]))
            if len(values) != len(TRANSACTION_COLUMNS):
                raise ValueError(
                    f"{path.name}:{line_number} 컬럼 {len(values)}개 "
                    f"(예상 {len(TRANSACTION_COLUMNS)}개)"
                )
            transaction_order += 1
            transaction = dict(zip(TRANSACTION_COLUMNS, values))
            records.append(
                {
                    **current,
                    "Transaction Order": transaction_order,
                    **transaction,
                }
            )

    if current is not None:
        raise ValueError(f"{path.name}: 마지막 attempt의 END 누락")

    df = pd.DataFrame(records)
    df["Timestamp"] = pd.to_datetime(
        df["Timestamp"], format="%Y/%m/%d %H:%M", errors="raise"
    )
    for column in ("Amount Received", "Amount Paid"):
        df[column] = pd.to_numeric(df[column], errors="raise")
    df["Is Laundering"] = pd.to_numeric(
        df["Is Laundering"], errors="raise"
    ).astype("int8")
    for column in ID_DTYPES:
        df[column] = df[column].astype("string")
    return df


def signature_frame(df: pd.DataFrame) -> pd.Series:
    """동일한 원본 파싱 규칙을 적용한 거래의 비교용 해시를 만든다."""
    return pd.util.hash_pandas_object(
        df[TRANSACTION_COLUMNS], index=False
    ).astype("uint64")


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.rank: dict[str, int] = {}

    def find(self, item: str) -> str:
        if item not in self.parent:
            self.parent[item] = item
            self.rank[item] = 0
            return item
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != item:
            parent = self.parent[item]
            self.parent[item] = root
            item = parent
        return root

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


def weak_component_count(edges: list[tuple[str, str]]) -> int:
    uf = UnionFind()
    nodes: set[str] = set()
    for source, target in edges:
        nodes.update((source, target))
        uf.union(source, target)
    return len({uf.find(item) for item in nodes}) if nodes else 0


def directed_metrics(edges: list[tuple[str, str]]) -> dict[str, object]:
    nodes = {node for edge in edges for node in edge}
    unique_edges = set(edges)
    self_loop_count = sum(source == target for source, target in edges)
    structural_edges = {
        (source, target)
        for source, target in unique_edges
        if source != target
    }
    in_neighbors: dict[str, set[str]] = defaultdict(set)
    out_neighbors: dict[str, set[str]] = defaultdict(set)
    adjacency: dict[str, set[str]] = defaultdict(set)
    indegree = {node: 0 for node in nodes}

    for source, target in structural_edges:
        out_neighbors[source].add(target)
        in_neighbors[target].add(source)
        if target not in adjacency[source]:
            adjacency[source].add(target)
            indegree[target] += 1

    queue = deque(node for node in nodes if indegree[node] == 0)
    levels = {node: 0 for node in nodes}
    processed = 0
    while queue:
        source = queue.popleft()
        processed += 1
        for target in adjacency[source]:
            levels[target] = max(levels[target], levels[source] + 1)
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    has_cycle = processed < len(nodes)
    max_hops = None if has_cycle else max(levels.values(), default=0)
    max_in = max((len(values) for values in in_neighbors.values()), default=0)
    max_out = max((len(values) for values in out_neighbors.values()), default=0)
    both_hub = any(
        len(in_neighbors[node]) >= 2 and len(out_neighbors[node]) >= 2
        for node in nodes
    )

    return {
        "node_count": len(nodes),
        "unique_edge_count": len(unique_edges),
        "component_count": weak_component_count(list(unique_edges)),
        "self_loop_count": self_loop_count,
        "max_in_degree": max_in,
        "max_out_degree": max_out,
        "has_cycle": has_cycle,
        "max_hops": max_hops,
        "has_gather_scatter_hub": both_hub,
    }


def automatic_structure_check(pattern: str, metrics: dict[str, object]) -> tuple[str, str]:
    max_in = int(metrics["max_in_degree"])
    max_out = int(metrics["max_out_degree"])
    has_cycle = bool(metrics["has_cycle"])
    max_hops = metrics["max_hops"]
    both_hub = bool(metrics["has_gather_scatter_hub"])

    if pattern == "FAN-IN":
        passed = max_in >= 2
        reason = f"최대 in-degree={max_in}"
    elif pattern == "FAN-OUT":
        passed = max_out >= 2
        reason = f"최대 out-degree={max_out}"
    elif pattern == "CYCLE":
        passed = has_cycle
        reason = f"방향성 cycle={'있음' if has_cycle else '없음'}"
    elif pattern == "GATHER-SCATTER":
        passed = both_hub
        reason = "in/out-degree가 모두 2 이상인 중심 노드 " + ("있음" if both_hub else "없음")
    elif pattern == "SCATTER-GATHER":
        passed = max_in >= 2 and max_out >= 2
        reason = f"최대 in/out-degree={max_in}/{max_out}"
    elif pattern == "STACK":
        passed = max_hops is not None and int(max_hops) >= 2
        reason = f"cycle 제외 최대 경로 깊이={max_hops if max_hops is not None else '계산 불가'}"
    elif pattern == "BIPARTITE":
        passed = max_in >= 2 and max_out >= 2
        reason = f"최대 in/out-degree={max_in}/{max_out}"
    elif pattern == "RANDOM":
        return "manual", "RANDOM은 단일 규칙보다 시각적·시간적 검토가 필요"
    else:
        return "manual", "Patterns.txt에 구조명이 없는 거래"
    return ("pass" if passed else "review"), reason


def rows_to_edges(frame: pd.DataFrame) -> list[dict[str, object]]:
    edges: list[dict[str, object]] = []
    sort_columns = ["Timestamp"]
    if "Transaction Order" in frame.columns:
        sort_columns.append("Transaction Order")
    for _, values in frame.sort_values(sort_columns).iterrows():
        edges.append(
            {
                "s": node_id(values["From Bank"], values["Account"]),
                "t": node_id(values["To Bank"], values["Account.1"]),
                "ts": iso_minute(values["Timestamp"]),
                "received": json_safe_number(values["Amount Received"]),
                "receiving_currency": str(values["Receiving Currency"]),
                "paid": json_safe_number(values["Amount Paid"]),
                "payment_currency": str(values["Payment Currency"]),
                "format": str(values["Payment Format"]),
                "label": int(values["Is Laundering"]),
                "order": int(values.get("Transaction Order", 0)),
            }
        )
    return edges


def block_from_frame(
    frame: pd.DataFrame,
    block_id: str,
    pattern: str,
    meta: str,
    source: str,
) -> dict[str, object]:
    edge_pairs = [
        (
            node_id(row["From Bank"], row["Account"]),
            node_id(row["To Bank"], row["Account.1"]),
        )
        for _, row in frame.iterrows()
    ]
    metrics = directed_metrics(edge_pairs)
    structure_status, structure_reason = automatic_structure_check(pattern, metrics)
    start = frame["Timestamp"].min()
    end = frame["Timestamp"].max()
    duration_hours = (end - start).total_seconds() / 3600 if len(frame) else 0

    return {
        "id": block_id,
        "pattern": pattern,
        "meta": meta,
        "source": source,
        "representative": [],
        "expectation": PATTERN_EXPECTATIONS[pattern],
        "structure_status": structure_status,
        "structure_reason": structure_reason,
        "metrics": {
            **metrics,
            "transaction_count": len(frame),
            "start": iso_minute(start),
            "end": iso_minute(end),
            "duration_hours": round(duration_hours, 2),
            "currency_count": int(
                pd.concat(
                    [frame["Receiving Currency"], frame["Payment Currency"]]
                ).nunique()
            ),
            "bank_count": int(
                pd.concat([frame["From Bank"], frame["To Bank"]]).nunique()
            ),
        },
        "edges": rows_to_edges(frame),
    }


def make_pattern_blocks(patterns: pd.DataFrame) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for attempt_id, frame in patterns.groupby("Attempt ID", sort=False):
        first = frame.iloc[0]
        blocks.append(
            block_from_frame(
                frame=frame,
                block_id=str(attempt_id),
                pattern=str(first["Pattern Type"]),
                meta=str(first["Pattern Meta"]),
                source="Patterns.txt",
            )
        )
    mark_representatives(blocks)
    return blocks


def mark_representatives(blocks: list[dict[str, object]]) -> None:
    by_pattern: dict[str, list[dict[str, object]]] = defaultdict(list)
    for block in blocks:
        by_pattern[str(block["pattern"])].append(block)

    for pattern_blocks in by_pattern.values():
        ordered = sorted(
            pattern_blocks,
            key=lambda item: (item["metrics"]["transaction_count"], item["id"]),
        )
        chosen = {
            "min": ordered[0],
            "median": ordered[(len(ordered) - 1) // 2],
            "max": ordered[-1],
        }
        for label, block in chosen.items():
            block["representative"].append(label)


def make_outside_blocks(
    laundering: pd.DataFrame,
    patterns: pd.DataFrame,
    ratio: str,
) -> tuple[list[dict[str, object]], pd.DataFrame]:
    pattern_hashes = set(signature_frame(patterns).tolist())
    laundering_hashes = signature_frame(laundering)
    outside = laundering.loc[~laundering_hashes.isin(pattern_hashes)].copy()

    uf = UnionFind()
    for _, values in outside.iterrows():
        uf.union(
            node_id(values["From Bank"], values["Account"]),
            node_id(values["To Bank"], values["Account.1"]),
        )

    component_rows: dict[str, list[int]] = defaultdict(list)
    for index, row in outside.iterrows():
        source = node_id(row["From Bank"], row["Account"])
        component_rows[uf.find(source)].append(index)

    ordered_components = sorted(
        component_rows.values(), key=lambda indices: (-len(indices), min(indices))
    )
    blocks: list[dict[str, object]] = []
    for number, indices in enumerate(ordered_components, start=1):
        frame = outside.loc[indices]
        blocks.append(
            block_from_frame(
                frame=frame,
                block_id=f"{ratio}_OUT_{number:04d}",
                pattern="패턴 외",
                meta="라벨 1 거래의 약한 연결요소",
                source="Trans.csv only",
            )
        )
    return blocks, outside


def load_account_meta(path: Path) -> dict[str, dict[str, str]]:
    accounts = pd.read_csv(path, dtype=ACCOUNT_DTYPES, low_memory=False)
    meta: dict[str, dict[str, str]] = {}
    for _, values in accounts.iterrows():
        key = node_id(values["Bank ID"], values["Account Number"])
        if key not in meta:
            meta[key] = {
                "bank_name": str(values["Bank Name"]),
                "entity_id": str(values["Entity ID"]),
                "entity_name": str(values["Entity Name"]),
            }
    return meta


def build_normal_context(
    transactions: pd.DataFrame,
    suspicious_nodes: set[str],
    per_node_limit: int,
    chunk_size: int = 400_000,
) -> tuple[list[dict[str, object]], dict[str, list[int]], set[str]]:
    selected_frames: list[pd.DataFrame] = []
    for start in range(0, len(transactions), chunk_size):
        chunk = transactions.iloc[start : start + chunk_size]
        normal = chunk.loc[chunk["Is Laundering"].eq(0)]
        sources = normal["From Bank"].astype(str) + "::" + normal["Account"].astype(str)
        targets = normal["To Bank"].astype(str) + "::" + normal["Account.1"].astype(str)
        mask = sources.isin(suspicious_nodes) | targets.isin(suspicious_nodes)
        if not mask.any():
            continue
        selected = normal.loc[
            mask,
            [
                "Timestamp",
                "Amount Paid",
                "Payment Currency",
                "Payment Format",
            ],
        ].copy()
        selected["s"] = sources.loc[mask].to_numpy()
        selected["t"] = targets.loc[mask].to_numpy()
        selected_frames.append(selected)

    if not selected_frames:
        return [], {}, set()

    context = pd.concat(selected_frames, ignore_index=True)
    grouped = (
        context.groupby(
            ["s", "t", "Payment Currency", "Payment Format"],
            sort=False,
            dropna=False,
        )
        .agg(
            count=("Timestamp", "size"),
            first=("Timestamp", "min"),
            last=("Timestamp", "max"),
            median_paid=("Amount Paid", "median"),
        )
        .reset_index()
        .rename(
            columns={
                "Payment Currency": "payment_currency",
                "Payment Format": "payment_format",
            }
        )
        .sort_values(["count", "last"], ascending=[False, False])
    )

    context_edges: list[dict[str, object]] = []
    by_node: dict[str, list[int]] = defaultdict(list)
    context_nodes: set[str] = set()

    for row in grouped.itertuples(index=False):
        source = str(row.s)
        target = str(row.t)
        eligible_source = source in suspicious_nodes and len(by_node[source]) < per_node_limit
        eligible_target = target in suspicious_nodes and len(by_node[target]) < per_node_limit
        if not (eligible_source or eligible_target):
            continue
        edge_id = len(context_edges)
        context_edges.append(
            {
                "s": source,
                "t": target,
                "count": int(row.count),
                "first": iso_minute(row.first),
                "last": iso_minute(row.last),
                "median_paid": json_safe_number(row.median_paid),
                "currency": str(row.payment_currency),
                "format": str(row.payment_format),
            }
        )
        if eligible_source:
            by_node[source].append(edge_id)
        if eligible_target and target != source:
            by_node[target].append(edge_id)
        context_nodes.update((source, target))

    return context_edges, dict(by_node), context_nodes


def node_metadata(
    nodes: Iterable[str], account_meta: dict[str, dict[str, str]]
) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for key in nodes:
        bank, account = key.split("::", 1)
        lookup_key = node_id(canonical_bank_id(bank), account)
        result[key] = {
            "bank": bank,
            "account": account,
            **account_meta.get(
                lookup_key,
                {"bank_name": "", "entity_id": "", "entity_name": ""},
            ),
        }
    return result


def build_dataset(
    data_dir: Path,
    ratio: str,
    context_per_node: int,
) -> dict[str, object]:
    print(f"[{ratio}] 거래 로드 및 전처리")
    transactions, preprocessing = read_transactions(
        data_dir / f"{ratio}-Small_Trans.csv"
    )
    print(
        f"[{ratio}] {preprocessing['raw_rows']:,}행 → "
        f"{preprocessing['deduplicated_rows']:,}행 "
        f"(중복 {preprocessing['removed_duplicates']:,}행 제거)"
    )

    print(f"[{ratio}] 패턴 파싱 및 패턴 외 거래 연결요소 생성")
    patterns = parse_patterns(data_dir / f"{ratio}-Small_Patterns.txt", ratio)
    laundering = transactions.loc[transactions["Is Laundering"].eq(1)].copy()
    pattern_blocks = make_pattern_blocks(patterns)
    outside_blocks, outside = make_outside_blocks(laundering, patterns, ratio)
    blocks = pattern_blocks + outside_blocks

    matched = len(patterns)
    if matched + len(outside) != len(laundering):
        raise ValueError(
            f"{ratio}: 패턴 {matched} + 패턴 외 {len(outside)} != "
            f"자금세탁 {len(laundering)}"
        )

    suspicious_nodes = {
        node
        for block in blocks
        for edge in block["edges"]
        for node in (edge["s"], edge["t"])
    }

    print(f"[{ratio}] 정상 거래 1홉 문맥 요약")
    context_edges, context_by_node, context_nodes = build_normal_context(
        transactions=transactions,
        suspicious_nodes=suspicious_nodes,
        per_node_limit=context_per_node,
    )
    del transactions

    print(f"[{ratio}] 계좌/엔티티 메타데이터 연결")
    account_meta = load_account_meta(data_dir / f"{ratio}-Small_accounts.csv")
    all_nodes = suspicious_nodes | context_nodes

    pattern_counts = Counter(block["pattern"] for block in pattern_blocks)
    status_counts = Counter(block["structure_status"] for block in pattern_blocks)
    stats = {
        **preprocessing,
        "pattern_rows": matched,
        "outside_rows": len(outside),
        "pattern_coverage_percent": round(matched / len(laundering) * 100, 2),
        "pattern_attempts": len(pattern_blocks),
        "outside_components": len(outside_blocks),
        "outside_singletons": sum(
            block["metrics"]["transaction_count"] == 1 for block in outside_blocks
        ),
        "suspicious_nodes": len(suspicious_nodes),
        "context_edges": len(context_edges),
        "pattern_counts": dict(pattern_counts),
        "automatic_status_counts": dict(status_counts),
    }

    metadata = node_metadata(all_nodes, account_meta)
    stats["account_metadata_matched_nodes"] = sum(
        bool(values["entity_id"])
        for node, values in metadata.items()
        if node in suspicious_nodes
    )
    stats["account_metadata_match_percent"] = round(
        stats["account_metadata_matched_nodes"] / len(suspicious_nodes) * 100,
        2,
    )

    return {
        "ratio": ratio,
        "stats": stats,
        "blocks": blocks,
        "context_edges": context_edges,
        "context_by_node": context_by_node,
        "node_meta": metadata,
    }


HTML_TEMPLATE = r'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IBM AML 패턴 구조·판별 근거 감사</title>
<style>
:root{--bg:#f5f7fb;--panel:#fff;--text:#172033;--muted:#667085;--line:#d8deea;--primary:#2457d6;--danger:#c4314b;--normal:#98a2b3;--context:#64748b;--owner:#7c3aed;--good:#16845b;--warn:#b26400;--shadow:0 8px 24px rgba(24,39,75,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,"Pretendard",system-ui,-apple-system,sans-serif}button,input,select,textarea{font:inherit}header{padding:18px 22px;background:#12213f;color:#fff}header h1{font-size:21px;margin:0 0 6px}header p{margin:0;color:#cbd5e1;font-size:13px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;padding:12px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}.field{display:flex;flex-direction:column;gap:4px;min-width:130px}.field.grow{flex:1;min-width:220px}label{font-size:12px;color:var(--muted)}select,input[type=text],textarea{border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--text);padding:7px 9px}button{border:1px solid var(--line);background:#fff;color:var(--text);padding:7px 11px;border-radius:7px;cursor:pointer}button.primary{background:var(--primary);color:#fff;border-color:var(--primary)}button:hover{filter:brightness(.98)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;padding:14px}.main,.side{display:flex;flex-direction:column;gap:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:14px}.stats{display:grid;grid-template-columns:repeat(6,minmax(105px,1fr));gap:8px}.stat{padding:10px;border-left:3px solid var(--primary);background:#f8faff}.stat small{display:block;color:var(--muted);margin-bottom:3px}.stat b{font-size:17px}.title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.title-row h2{font-size:18px;margin:0}.subtitle{color:var(--muted);font-size:12px;margin-top:5px}.tag{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;background:#e8eefc;color:#244aa5}.tag.good{background:#e5f5ee;color:var(--good)}.tag.warn{background:#fff1dd;color:var(--warn)}.graph-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:10px 0}.graph-controls select{padding:5px 7px}.check{display:flex;gap:5px;align-items:center;color:var(--text)}#graph{width:100%;height:610px;border:1px solid var(--line);background:#fbfcff;border-radius:8px}.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}.legend i{display:inline-block;width:18px;height:3px;margin-right:5px;vertical-align:middle}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.metric{padding:8px;background:#f8faff;border-radius:7px}.metric small{display:block;color:var(--muted)}.metric b{font-size:14px}.ownership{font-size:12px}.owner-group{padding:8px 0;border-bottom:1px solid #edf0f5}.owner-group:last-child{border-bottom:0}.owner-group b{color:var(--owner)}.owner-accounts{color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.expectation{margin:10px 0;padding:10px;background:#f7f8fb;border-left:3px solid var(--primary);font-size:13px}.table-wrap{overflow:auto;max-height:390px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px 8px;border-bottom:1px solid #edf0f5;text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f6f8fc;z-index:1}td.num{text-align:right;font-variant-numeric:tabular-nums}.audit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.audit-grid .full{grid-column:1/-1}textarea{width:100%;min-height:100px;resize:vertical}.status{font-size:12px;color:var(--good);min-height:18px}.empty{padding:40px;text-align:center;color:var(--muted)}.blind .pattern-sensitive{filter:blur(5px);user-select:none}.blind .core-edge{stroke:var(--primary)!important}.blind .core-node{fill:#e7ecf7!important;stroke:var(--primary)!important}.small{font-size:12px;color:var(--muted)}input[type=range]{width:min(520px,100%)}@media(max-width:1050px){.layout{grid-template-columns:1fr}.side{display:grid;grid-template-columns:1fr 1fr}.stats{grid-template-columns:repeat(3,1fr)}}@media(max-width:700px){.layout{padding:8px}.side{display:flex}.stats{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:repeat(2,1fr)}#graph{height:480px}.audit-grid{grid-template-columns:1fr}.audit-grid .full{grid-column:auto}}
</style>
</head>
<body>
<header><h1>IBM AML 패턴 구조·판별 근거 감사</h1><p>패턴 이름의 구조적 타당성과 라벨을 보지 않은 사람의 자금세탁 판별 가능성을 분리해 기록합니다.</p></header>
<div class="toolbar">
  <div class="field"><label for="dataset">데이터셋</label><select id="dataset"></select></div>
  <div class="field"><label for="pattern">패턴</label><select id="pattern"></select></div>
  <div class="field"><label for="representative">대표 사례</label><select id="representative"><option value="all">전체</option><option value="min">최소 거래 수</option><option value="median">중앙 거래 수</option><option value="max">최대 거래 수</option></select></div>
  <div class="field"><label for="autoStatus">자동 구조검사</label><select id="autoStatus"><option value="all">전체</option><option value="pass">기대 구조 확인</option><option value="review">재검토 필요</option><option value="manual">수동 검토</option></select></div>
  <div class="field grow"><label for="block">Attempt / 패턴 외 블록</label><select id="block"></select></div>
  <div class="field grow"><label for="search">계좌·엔티티 검색</label><input id="search" type="text" placeholder="은행 ID, 계좌번호, 엔티티명"></div>
</div>
<div class="layout" id="app">
  <main class="main">
    <section class="panel stats" id="stats"></section>
    <section class="panel" id="graphPanel">
      <div class="title-row"><div><h2 id="blockTitle"></h2><div class="subtitle" id="blockSubtitle"></div></div><div id="autoTag"></div></div>
      <div class="expectation"><b>패턴 기대 구조:</b> <span id="expectation" class="pattern-sensitive"></span><br><b>자동 관찰:</b> <span id="autoReason"></span></div>
      <div class="graph-controls">
        <label class="check"><input type="checkbox" id="showContext"> 정상 거래 1홉 보기</label>
        <label class="check"><input type="checkbox" id="blindMode"> 블라인드 모드</label>
        <label class="check"><input type="checkbox" id="showLabels"> 밀집 그래프 라벨 표시</label>
        <label for="labelMode">노드 라벨</label><select id="labelMode"><option value="both" selected>계좌 + 소유주</option><option value="account">계좌만</option><option value="owner">소유주만</option></select>
        <button id="prevTime">이전 거래</button><button id="nextTime">다음 거래</button><button id="allTime">전체 시간</button>
        <span class="small" id="timeLabel"></span>
      </div>
      <input id="timeSlider" type="range" min="0" max="0" value="0" aria-label="거래 시간 단계">
      <svg id="graph" viewBox="0 0 1000 610" role="img" aria-label="계좌 거래 방향 그래프"></svg>
      <div class="legend"><span><i style="background:var(--danger)"></i>자금세탁 라벨 거래</span><span><i style="background:var(--normal)"></i>정상 1홉 요약</span><span>● 핵심 계좌</span><span>○ 정상 문맥 계좌</span><span style="color:var(--owner)">◎ 동일 소유주의 다계좌</span></div>
    </section>
    <section class="panel"><h3>시간순 핵심 거래</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>시각</th><th>송금 노드</th><th>송금 소유주</th><th>수취 노드</th><th>수취 소유주</th><th>지급액</th><th>지급 통화</th><th>수취액</th><th>수취 통화</th><th>방식</th></tr></thead><tbody id="transactions"></tbody></table></div></section>
  </main>
  <aside class="side">
    <section class="panel"><h3>구조 지표</h3><div class="metrics" id="metrics"></div></section>
    <section class="panel"><h3>동일 소유주 계좌</h3><div class="ownership" id="ownership"></div></section>
    <section class="panel"><h3>사람 검토 기록</h3><p class="small">구조 라벨의 적합성과, 패턴명을 숨겼을 때 자금세탁임을 설명할 수 있는지를 별도로 평가하세요.</p>
      <div class="audit-grid">
        <div class="field"><label for="structureJudgment">구조 라벨</label><select id="structureJudgment"><option value="">미검토</option><option>일치</option><option>부분 일치</option><option>불일치</option></select></div>
        <div class="field"><label for="detectability">사람 판별 가능성</label><select id="detectability"><option value="">미검토</option><option>가능</option><option>애매</option><option>불가능</option></select></div>
        <div class="field"><label for="suspicionReason">주된 의심 근거</label><select id="suspicionReason"><option value="">선택 안 함</option><option>분산·집중 구조</option><option>다단계 이동</option><option>순환 거래</option><option>빠른 입금 후 출금</option><option>평소 대비 금액 변화</option><option>통화·은행 변화</option><option>관찰 근거 없음</option><option>기타</option></select></div>
        <div class="field"><label for="actionDecision">처리 의견</label><select id="actionDecision"><option value="">미정</option><option>학습 유지</option><option>추가 분석</option><option>제외 후보</option></select></div>
        <div class="field full"><label for="notes">판단 근거 메모</label><textarea id="notes" placeholder="라벨을 보지 않고도 설명 가능한 근거와 반례를 기록하세요."></textarea></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px"><button class="primary" id="saveReview">현재 검토 저장</button><button id="exportReviews">검토 CSV 내보내기</button></div><div class="status" id="saveStatus" aria-live="polite"></div>
    </section>
  </aside>
</div>
<script>
const AML_DATA=__AML_DATA__;
const PATTERN_ORDER=["FAN-OUT","FAN-IN","CYCLE","GATHER-SCATTER","SCATTER-GATHER","BIPARTITE","STACK","RANDOM","패턴 외"];
const els=Object.fromEntries(["dataset","pattern","representative","autoStatus","block","search","stats","blockTitle","blockSubtitle","autoTag","expectation","autoReason","showContext","blindMode","showLabels","labelMode","prevTime","nextTime","allTime","timeLabel","timeSlider","graph","transactions","metrics","ownership","structureJudgment","detectability","suspicionReason","actionDecision","notes","saveReview","exportReviews","saveStatus","graphPanel"].map(id=>[id,document.getElementById(id)]));
let currentDataset=null,currentBlock=null,visibleBlocks=[],timeIndex=0;
const reviewKey="ibm-aml-pattern-audit-v1";
const reviews=JSON.parse(localStorage.getItem(reviewKey)||"{}");
const fmt=n=>new Intl.NumberFormat("ko-KR",{maximumFractionDigits:4}).format(n??0);
const esc=s=>String(s??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function fillSelect(el,items,valueFn=x=>x,labelFn=x=>x){el.innerHTML=items.map(x=>`<option value="${esc(valueFn(x))}">${esc(labelFn(x))}</option>`).join("")}
function init(){fillSelect(els.dataset,AML_DATA,d=>d.ratio,d=>`${d.ratio}-Small`);fillSelect(els.pattern,["전체",...PATTERN_ORDER]);bind();selectDataset()}
function bind(){els.dataset.onchange=selectDataset;[els.pattern,els.representative,els.autoStatus].forEach(e=>e.onchange=filterBlocks);els.block.onchange=selectBlock;els.search.oninput=filterBlocks;els.showContext.onchange=draw;els.showLabels.onchange=draw;els.labelMode.onchange=draw;els.blindMode.onchange=()=>{els.graphPanel.classList.toggle("blind",els.blindMode.checked);renderTitle();draw()};els.timeSlider.oninput=()=>{timeIndex=+els.timeSlider.value;draw()};els.prevTime.onclick=()=>{timeIndex=Math.max(0,timeIndex-1);syncTime()};els.nextTime.onclick=()=>{timeIndex=Math.min(currentBlock.edges.length,timeIndex+1);syncTime()};els.allTime.onclick=()=>{timeIndex=currentBlock.edges.length;syncTime()};els.saveReview.onclick=saveReview;els.exportReviews.onclick=exportReviews}
function selectDataset(){currentDataset=AML_DATA.find(d=>d.ratio===els.dataset.value)||AML_DATA[0];renderStats();filterBlocks()}
function renderStats(){const s=currentDataset.stats;const values=[["전체 거래",s.deduplicated_rows],["자금세탁 거래",s.laundering_rows],["패턴 소속",`${fmt(s.pattern_rows)} (${s.pattern_coverage_percent}%)`],["패턴 외",s.outside_rows],["패턴 attempt",s.pattern_attempts],["패턴 외 블록",s.outside_components]];els.stats.innerHTML=values.map(([k,v])=>`<div class="stat"><small>${k}</small><b>${typeof v==='number'?fmt(v):v}</b></div>`).join("")}
function nodeSearchText(block){const q=els.search.value.trim().toLowerCase();if(!q)return true;const nodes=new Set(block.edges.flatMap(e=>[e.s,e.t]));for(const n of nodes){const m=currentDataset.node_meta[n]||{};if(`${n} ${m.bank_name||''} ${m.entity_id||''} ${m.entity_name||''}`.toLowerCase().includes(q))return true}return false}
function filterBlocks(){const p=els.pattern.value,r=els.representative.value,a=els.autoStatus.value;visibleBlocks=currentDataset.blocks.filter(b=>(p==="전체"||b.pattern===p)&&(r==="all"||b.representative.includes(r))&&(a==="all"||b.structure_status===a)&&nodeSearchText(b));if(!visibleBlocks.length){els.block.innerHTML='<option>조건에 맞는 블록 없음</option>';currentBlock=null;renderEmpty();return}fillSelect(els.block,visibleBlocks,b=>b.id,b=>`${b.id} · ${b.pattern} · ${b.metrics.transaction_count}건${b.representative.length?' · '+b.representative.join('/'):''}`);currentBlock=visibleBlocks[0];els.block.value=currentBlock.id;loadBlock()}
function selectBlock(){currentBlock=visibleBlocks.find(b=>b.id===els.block.value);loadBlock()}
function renderEmpty(){els.blockTitle.textContent="선택 결과 없음";els.blockSubtitle.textContent="필터를 변경하세요.";els.graph.innerHTML="";els.transactions.innerHTML="";els.metrics.innerHTML=""}
function loadBlock(){if(!currentBlock)return;timeIndex=currentBlock.edges.length;els.timeSlider.max=currentBlock.edges.length;els.timeSlider.value=timeIndex;renderTitle();renderMetrics();renderOwnership();renderTransactions();loadReview();draw()}
function renderTitle(){const blind=els.blindMode.checked;els.blockTitle.innerHTML=`${esc(currentBlock.id)} · <span class="pattern-sensitive">${blind?'숨김':esc(currentBlock.pattern)}</span>`;els.blockSubtitle.textContent=`${currentBlock.source} · ${currentBlock.meta||'부가 설명 없음'} · ${currentBlock.metrics.start} ~ ${currentBlock.metrics.end}`;const label=currentBlock.structure_status==='pass'?'기대 구조 확인':currentBlock.structure_status==='review'?'재검토 필요':'수동 검토';els.autoTag.innerHTML=`<span class="tag ${currentBlock.structure_status==='pass'?'good':currentBlock.structure_status==='review'?'warn':''}">${label}</span>`;els.expectation.textContent=blind?'패턴명이 숨겨져 있습니다.':currentBlock.expectation;els.autoReason.textContent=currentBlock.structure_reason}
function coreOwnerGroups(){const coreNodes=new Set(currentBlock.edges.flatMap(e=>[e.s,e.t])),groups=new Map;for(const node of coreNodes){const m=currentDataset.node_meta[node]||{},owner=m.entity_id;if(!owner)continue;if(!groups.has(owner))groups.set(owner,{id:owner,name:m.entity_name||owner,nodes:[]});groups.get(owner).nodes.push(node)}return [...groups.values()].filter(g=>g.nodes.length>1).sort((a,b)=>b.nodes.length-a.nodes.length)}
function renderMetrics(){const m=currentBlock.metrics,ownerGroups=coreOwnerGroups();const values=[["거래",m.transaction_count],["노드",m.node_count],["동일 소유주 다계좌",ownerGroups.length],["고유 엣지",m.unique_edge_count],["연결요소",m.component_count],["자기거래",m.self_loop_count],["최대 in-degree",m.max_in_degree],["최대 out-degree",m.max_out_degree],["Cycle(자기거래 제외)",m.has_cycle?'있음':'없음'],["최대 경로 깊이",m.max_hops??'cycle로 미산출'],["기간",`${m.duration_hours}시간`],["통화",m.currency_count],["은행",m.bank_count]];els.metrics.innerHTML=values.map(([k,v])=>`<div class="metric"><small>${k}</small><b>${esc(v)}</b></div>`).join("")}
function renderOwnership(){const groups=coreOwnerGroups();if(!groups.length){els.ownership.innerHTML='<span class="small">현재 핵심 거래에서는 동일 소유주의 다계좌 관계가 확인되지 않습니다.</span>';return}els.ownership.innerHTML=groups.slice(0,20).map(g=>`<div class="owner-group"><b>${esc(g.name)}</b> <span class="small">(${esc(g.id)}, ${g.nodes.length}계좌)</span><div class="owner-accounts">${g.nodes.map(esc).join(' → ')}</div></div>`).join('')+(groups.length>20?`<div class="small">외 ${groups.length-20}개 소유주 그룹</div>`:'')}
function renderTransactions(){els.transactions.innerHTML=currentBlock.edges.map((e,i)=>{const sm=currentDataset.node_meta[e.s]||{},tm=currentDataset.node_meta[e.t]||{};return`<tr><td>${i+1}</td><td>${e.ts}</td><td>${esc(e.s)}</td><td>${esc(sm.entity_name||sm.entity_id||'')}</td><td>${esc(e.t)}</td><td>${esc(tm.entity_name||tm.entity_id||'')}</td><td class="num">${fmt(e.paid)}</td><td>${esc(e.payment_currency)}</td><td class="num">${fmt(e.received)}</td><td>${esc(e.receiving_currency)}</td><td>${esc(e.format)}</td></tr>`}).join("")}
function syncTime(){els.timeSlider.value=timeIndex;draw()}
function contextFor(coreNodes){const ids=new Set;for(const n of coreNodes){for(const id of currentDataset.context_by_node[n]||[]){ids.add(id);if(ids.size>=120)break}if(ids.size>=120)break}return [...ids].map(id=>currentDataset.context_edges[id])}
function layout(nodes,coreEdges){const W=1000,H=610,pad=70,core=[...nodes.values()].filter(n=>n.core),context=[...nodes.values()].filter(n=>!n.core);const indeg=new Map(core.map(n=>[n.id,0])),adj=new Map(core.map(n=>[n.id,[]]));for(const e of coreEdges){if(e.s!==e.t&&!adj.get(e.s).includes(e.t)){adj.get(e.s).push(e.t);indeg.set(e.t,(indeg.get(e.t)||0)+1)}}const q=core.filter(n=>indeg.get(n.id)===0).map(n=>n.id),level=new Map(core.map(n=>[n.id,0]));let done=0;while(q.length){const s=q.shift();done++;for(const t of adj.get(s)||[]){level.set(t,Math.max(level.get(t)||0,(level.get(s)||0)+1));indeg.set(t,indeg.get(t)-1);if(indeg.get(t)===0)q.push(t)}}if(done===core.length&&Math.max(...level.values(),0)>0){const groups={};for(const n of core)(groups[level.get(n.id)]??=[]).push(n);const maxL=Math.max(...level.values());for(const [l,group] of Object.entries(groups)){group.forEach((n,i)=>{n.x=pad+(W-2*pad)*(+l/Math.max(1,maxL));n.y=pad+(H-2*pad)*((i+1)/(group.length+1))})}}else{core.forEach((n,i)=>{const a=2*Math.PI*i/Math.max(1,core.length)-Math.PI/2;n.x=W/2+Math.cos(a)*Math.min(300,35*core.length);n.y=H/2+Math.sin(a)*Math.min(220,28*core.length)})}const coreMap=new Map(core.map(n=>[n.id,n]));context.forEach((n,i)=>{const links=n.links.map(id=>coreMap.get(id)).filter(Boolean);const anchor=links[0]||{x:W/2,y:H/2};const a=2*Math.PI*(i/Math.max(1,context.length));n.x=Math.max(28,Math.min(W-28,anchor.x+Math.cos(a)*(85+20*(i%3))));n.y=Math.max(28,Math.min(H-28,anchor.y+Math.sin(a)*(70+18*(i%3))))})}
function nodeLabel(n,m){
  const account=n.id.split('::')[1],owner=m.entity_name||m.entity_id||'소유주 미연결',shortOwner=owner.length>24?owner.slice(0,22)+'…':owner,y=n.y+(n.core?25:19),size=n.core?10:8;
  if(els.labelMode.value==='account')return`<text x="${n.x}" y="${y}" text-anchor="middle" font-size="${size}" fill="var(--text)">${esc(account.slice(-9))}</text>`;
  if(els.labelMode.value==='owner')return`<text x="${n.x}" y="${y}" text-anchor="middle" font-size="${size}" fill="var(--text)">${esc(shortOwner)}</text>`;
  return`<text x="${n.x}" y="${y}" text-anchor="middle" font-size="${size}" fill="var(--text)"><tspan x="${n.x}" dy="0">${esc(account.slice(-9))}</tspan><tspan x="${n.x}" dy="12" fill="var(--owner)">${esc(shortOwner)}</tspan></text>`;
}
function draw(){
  if(!currentBlock)return;
  const visibleCore=currentBlock.edges.slice(0,timeIndex),allCore=currentBlock.edges,coreNodes=new Set(allCore.flatMap(e=>[e.s,e.t])),contexts=els.showContext.checked?contextFor(coreNodes):[];
  const nodes=new Map;
  for(const id of coreNodes)nodes.set(id,{id,core:true,links:[]});
  for(const e of contexts){for(const [id,other] of [[e.s,e.t],[e.t,e.s]]){if(!nodes.has(id))nodes.set(id,{id,core:false,links:[]});if(coreNodes.has(other))nodes.get(id).links.push(other)}}
  const repeatedOwnerNodes=new Set(coreOwnerGroups().flatMap(group=>group.nodes));
  layout(nodes,allCore);
  const marker=`<defs><marker id="arrowCore" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--danger)"/></marker><marker id="arrowNormal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--normal)"/></marker></defs>`;
  const line=(e,core)=>{const s=nodes.get(e.s),t=nodes.get(e.t);if(!s||!t)return'';if(e.s===e.t)return`<path class="${core?'core-edge':''}" d="M ${s.x-4} ${s.y-13} C ${s.x-35} ${s.y-55}, ${s.x+35} ${s.y-55}, ${s.x+4} ${s.y-13}" fill="none" stroke="${core?'var(--danger)':'var(--normal)'}" stroke-width="${core?2.4:1.2}" marker-end="url(#${core?'arrowCore':'arrowNormal'})"><title>${core?`${e.ts} · ${e.payment_currency} ${fmt(e.paid)}`:`정상 ${e.count}건 · ${e.first}~${e.last}`}</title></path>`;const dx=t.x-s.x,dy=t.y-s.y,len=Math.hypot(dx,dy)||1,x1=s.x+dx/len*15,y1=s.y+dy/len*15,x2=t.x-dx/len*17,y2=t.y-dy/len*17;return`<line class="${core?'core-edge':''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${core?'var(--danger)':'var(--normal)'}" stroke-width="${core?2.4:Math.min(2,1+Math.log10(e.count||1)/3)}" opacity="${core?.9:.55}" marker-end="url(#${core?'arrowCore':'arrowNormal'})"><title>${core?`${e.ts} · ${e.payment_currency} ${fmt(e.paid)}`:`정상 ${e.count}건 · 중앙값 ${e.currency} ${fmt(e.median_paid)}`}</title></line>`};
  let svg=marker+contexts.map(e=>line(e,false)).join('')+visibleCore.map(e=>line(e,true)).join(''),showNodeLabels=nodes.size<=80||els.showLabels.checked;
  for(const n of nodes.values()){
    const m=currentDataset.node_meta[n.id]||{},title=`${n.id}\n${m.bank_name||''}\n${m.entity_name||''}\n${m.entity_id||''}`,ownerRing=repeatedOwnerNodes.has(n.id)?`<circle cx="${n.x}" cy="${n.y}" r="17" fill="none" stroke="var(--owner)" stroke-width="2" stroke-dasharray="4 3"/>`:'';
    svg+=`<g>${ownerRing}<circle class="${n.core?'core-node':''}" cx="${n.x}" cy="${n.y}" r="${n.core?11:7}" fill="${n.core?'#fee2e7':'#e5e7eb'}" stroke="${n.core?'var(--danger)':'var(--context)'}" stroke-width="${n.core?2:1}"><title>${esc(title)}</title></circle>${showNodeLabels?nodeLabel(n,m):''}</g>`;
  }
  els.graph.innerHTML=svg;
  const current=timeIndex===0?'첫 거래 전':visibleCore.at(-1)?.ts||'';
  els.timeLabel.textContent=`${timeIndex}/${allCore.length}건 · ${current}${showNodeLabels?'':` · 노드 ${nodes.size}개라 라벨 자동 숨김`}`;
}
function loadReview(){const r=reviews[currentBlock.id]||{};els.structureJudgment.value=r.structureJudgment||'';els.detectability.value=r.detectability||'';els.suspicionReason.value=r.suspicionReason||'';els.actionDecision.value=r.actionDecision||'';els.notes.value=r.notes||'';els.saveStatus.textContent=r.savedAt?`마지막 저장: ${r.savedAt}`:''}
function saveReview(){reviews[currentBlock.id]={dataset:currentDataset.ratio,blockId:currentBlock.id,pattern:currentBlock.pattern,structureJudgment:els.structureJudgment.value,detectability:els.detectability.value,suspicionReason:els.suspicionReason.value,actionDecision:els.actionDecision.value,notes:els.notes.value,savedAt:new Date().toLocaleString('ko-KR')};localStorage.setItem(reviewKey,JSON.stringify(reviews));els.saveStatus.textContent=`저장됨: ${reviews[currentBlock.id].savedAt}`}
function exportReviews(){const headers=["dataset","blockId","pattern","structureJudgment","detectability","suspicionReason","actionDecision","notes","savedAt"],rows=Object.values(reviews),quote=v=>`"${String(v??'').replaceAll('"','""')}"`,csv='\ufeff'+[headers.join(','),...rows.map(r=>headers.map(h=>quote(r[h])).join(','))].join('\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ibm_aml_pattern_reviews.csv';a.click();URL.revokeObjectURL(a.href)}
init();
</script>
</body>
</html>'''


def write_html(payload: list[dict[str, object]], output_path: Path) -> None:
    data_json = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    html = HTML_TEMPLATE.replace("__AML_DATA__", data_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")


def validate_files(data_dir: Path, ratios: list[str]) -> None:
    missing: list[Path] = []
    for ratio in ratios:
        for suffix in ("Trans.csv", "accounts.csv", "Patterns.txt"):
            path = data_dir / f"{ratio}-Small_{suffix}"
            if not path.exists():
                missing.append(path)
    if missing:
        raise FileNotFoundError(
            "필수 파일이 없습니다:\n" + "\n".join(str(path) for path in missing)
        )


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    default_data = script_dir.parents[2] / "data"
    default_output = script_dir / "outputs" / "aml_pattern_audit.html"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=default_data)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument(
        "--ratios",
        nargs="+",
        choices=["HI", "LI"],
        default=["HI", "LI"],
    )
    parser.add_argument(
        "--context-per-node",
        type=int,
        default=12,
        help="의심 계좌마다 HTML에 포함할 정상 1홉 요약 엣지 수",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = args.data_dir.resolve()
    output_path = args.output.resolve()
    validate_files(data_dir, args.ratios)

    payload = [
        build_dataset(
            data_dir=data_dir,
            ratio=ratio,
            context_per_node=args.context_per_node,
        )
        for ratio in args.ratios
    ]
    write_html(payload, output_path)

    print("\n생성 완료")
    print(f"HTML: {output_path}")
    print(f"크기: {output_path.stat().st_size / (1024 ** 2):.2f} MB")
    for dataset in payload:
        stats = dataset["stats"]
        print(
            f"{dataset['ratio']}: 패턴 {stats['pattern_rows']:,}건 / "
            f"패턴 외 {stats['outside_rows']:,}건 / "
            f"커버리지 {stats['pattern_coverage_percent']:.2f}% / "
            f"패턴 외 블록 {stats['outside_components']:,}개"
        )


if __name__ == "__main__":
    main()
