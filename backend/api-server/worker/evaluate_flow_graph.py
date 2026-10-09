"""Read-only HI-Small/top10 quality evaluation; ground truth never enters the builder.

Print JSON lines. Labels simulate controlled seed errors; these are NOT model
performance measurements. No database, network, cache files or input writes.
"""
import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import Decimal
import gc
import hashlib
import json
import random
import sys
import time
from pathlib import Path
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

from flow_graph import (EdgeTable, FlowIndex, FlowPolicy, GraphBudgetExceeded,
                        HOUR_US, build_flow_graphs)

KST = ZoneInfo("Asia/Seoul")


def process_memory():
    """Whole-process RSS/peak, including loader and preceding variants."""
    if sys.platform != "win32":
        return {}
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "peak_working", "working", "peak_paged", "paged", "peak_nonpaged",
                "nonpaged", "pagefile", "peak_pagefile")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return {"unavailable": True}
    return {"rss_mib": round(counters.working / 1048576, 1),
            "process_peak_rss_mib": round(counters.peak_working / 1048576, 1)}


def transaction_key(row):
    return (row[0], int(row[1]), row[2], int(row[3]), row[4],
            Decimal(row[5]), row[6], Decimal(row[7]), row[8], row[9])


def read_patterns(path, shift_days=0):
    by_key, metadata = defaultdict(list), {}
    pattern_id = -1
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for line in stream:
            if line.startswith("BEGIN"):
                pattern_id += 1
                metadata[pattern_id] = {"kind": line.split(" - ", 1)[1].split(":", 1)[0].strip(),
                                        "original_count": 0}
            elif line[:4].isdigit():
                if pattern_id < 0:
                    raise ValueError("Pattern transaction before BEGIN")
                row = next(csv.reader([line]))
                if shift_days:
                    row[0] = (datetime.strptime(row[0], "%Y/%m/%d %H:%M")
                              + timedelta(days=shift_days)).strftime("%Y/%m/%d %H:%M")
                by_key[transaction_key(row)].append(pattern_id)
                metadata[pattern_id]["original_count"] += 1
    return by_key, metadata


def source_rows(transactions=None, top10_dir=None):
    if transactions is not None:
        with transactions.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream)
            header = next(reader)
            if len(header) != 11 or header[:2] != ["Timestamp", "From Bank"]:
                raise ValueError("Unexpected transaction CSV schema")
            # Raw files contain duplicate 'Account' headers; DictReader would lose one.
            for row in reader:
                if len(row) != 11:
                    raise ValueError("Malformed transaction row")
                yield row
        return
    files = sorted(top10_dir.glob("*/*.csv"))
    if not files:
        raise ValueError("No bank reports")
    banks = {int(path.stem.split("_")[1]) for path in files}
    columns = ("Timestamp", "From Bank", "From Account", "To Bank", "To Account",
               "Amount Received", "Receiving Currency", "Amount Paid",
               "Payment Currency", "Payment Format", "Is Laundering")
    for path in files:
        reporting_bank = int(path.stem.split("_")[1])
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for record in csv.DictReader(stream):
                row = [record[name] for name in columns]
                canonical_bank = int(row[1]) if int(row[1]) in banks else int(row[3])
                if reporting_bank == canonical_bank:
                    yield row


@dataclass(slots=True)
class Dataset:
    edges: EdgeTable
    positives: set[int]
    truth: dict[int, set[int]]
    metadata: dict
    tx_pattern: dict[int, int]
    audit: dict


def load_dataset(transactions, top10_dir, patterns, shift_days=0, end_day=None):
    expected, metadata = read_patterns(patterns, shift_days)
    edges, positives = EdgeTable(), set()
    accounts, timestamps, matches = {}, {}, defaultdict(list)
    counts = Counter()
    first_time = None
    digest = hashlib.sha256()
    for row in source_rows(transactions, top10_dir):
        counts["source_rows"] += 1
        if row[0] not in timestamps:
            dt = datetime.strptime(row[0], "%Y/%m/%d %H:%M").replace(tzinfo=KST)
            timestamps[row[0]] = int(dt.timestamp()) * 1_000_000
        occurred_us = timestamps[row[0]]
        # File rows need not be sorted; anchor by the date, not first observed hour.
        day_start = occurred_us - (occurred_us + 9 * HOUR_US) % (24 * HOUR_US)
        first_time = day_start if first_time is None else min(first_time, day_start)
        # HI-Small dates are validated below; prefix cutoff cannot depend on row order.
        if end_day is not None:
            cutoff = end_day
            if occurred_us >= cutoff:
                counts["excluded_after_cutoff"] += 1
                continue
        if row[10] not in ("0", "1"):
            raise ValueError("Invalid ground-truth label")
        digest.update(("\x1f".join(row) + "\n").encode("utf-8"))
        account_ids = []
        for bank, account in ((int(row[1]), row[2]), (int(row[3]), row[4])):
            key = (bank, account)
            if key not in accounts:
                accounts[key] = len(accounts) + 1
            account_ids.append(accounts[key])
        # Stable occurrence IDs even when a prefix cutoff excludes earlier file rows.
        tx_id = counts["source_rows"]
        edges.append(tx_id, occurred_us, *account_ids)
        if row[10] == "1":
            positives.add(tx_id)
            key = transaction_key(row)
            if key in expected:
                matches[key].append(tx_id)
    truth, tx_pattern = defaultdict(set), {}
    for key, row_ids in matches.items():
        pattern_ids = expected[key]
        # Identical occurrences cannot be assigned to different attempts by row order.
        if len(set(pattern_ids)) != 1 or len(row_ids) != len(pattern_ids):
            counts["ambiguous_pattern_rows"] += len(row_ids)
            continue
        pattern_id = pattern_ids[0]
        truth[pattern_id].update(row_ids)
        tx_pattern.update((tx_id, pattern_id) for tx_id in row_ids)
    counts.update(rows=len(edges), positive_rows=len(positives), accounts=len(accounts),
                  mapped_rows=len(tx_pattern), patterns_with_observed_rows=len(truth),
                  source_patterns=len(metadata),
                  fully_observed_patterns=sum(len(rows) == metadata[pattern_id]["original_count"]
                                              for pattern_id, rows in truth.items()),
                  unmapped_positive_rows=len(positives - tx_pattern.keys()))
    audit = dict(counts)
    audit.update(canonical_input_sha256=digest.hexdigest(),
                 min_time_us=min(edges.occurred_us, default=None),
                 max_time_us=max(edges.occurred_us, default=None),
                 first_business_day_us=first_time)
    return Dataset(edges.freeze(), positives, dict(truth), metadata, tx_pattern, audit)


def metric(groups, data, seeds, selected_patterns=None):
    selected_patterns = set(data.truth) if selected_patterns is None else set(selected_patterns)
    multi = {pattern_id: rows for pattern_id, rows in data.truth.items()
             if pattern_id in selected_patterns and len(rows) >= 2}
    eligible = {pattern_id: rows for pattern_id, rows in multi.items() if rows & seeds}
    # Invert sparse memberships; never scan every Alert for every expected pattern.
    memberships = defaultdict(list)
    sizes, distinct, represented, mixed = [], set(), set(), 0
    for group_id, (anchors, members) in enumerate(groups):
        sizes.append(len(members))
        distinct.update(members)
        represented.update(anchors)
        patterns = {data.tx_pattern[tx_id] for tx_id in members if tx_id in data.tx_pattern}
        mixed += len(patterns) > 1
        for tx_id in anchors:
            if tx_id in data.tx_pattern:
                memberships[data.tx_pattern[tx_id]].append(group_id)
    recovered, fragmented, fractions = set(), 0, []
    for pattern_id, expected in eligible.items():
        candidate_ids = set(memberships[pattern_id])
        best = max((len(groups[group_id][1] & expected) for group_id in candidate_ids), default=0)
        if best == len(expected):
            recovered.add(pattern_id)
        fractions.append(best / len(expected))
        fragmented += len(candidate_ids) > 1
    sizes.sort()
    by_kind = defaultdict(lambda: {"eligible": 0, "full": 0})
    for pattern_id in eligible:
        kind = data.metadata[pattern_id]["kind"]
        by_kind[kind]["eligible"] += 1
        by_kind[kind]["full"] += pattern_id in recovered
    return {
        "workload_scope": "all_graphs",
        "single_transaction_pattern_blocks": sum(len(data.truth[pattern_id]) == 1
                                                 for pattern_id in selected_patterns),
        "graphs": len(groups), "observed_multi_blocks": len(multi),
        "eligible_blocks": len(eligible), "seed_zero_blocks": len(multi) - len(eligible),
        "full_blocks": len(recovered),
        "mean_best_recovery": round(sum(fractions) / len(fractions), 6) if fractions else None,
        "fragmented_blocks": fragmented, "mixed_known_blocks": mixed,
        "memberships": sum(sizes), "unique_members": len(distinct),
        "duplicate_memberships": sum(sizes) - len(distinct),
        "normal_label_memberships": sum(len(members - data.positives) for _, members in groups),
        "missing_seeds": len(seeds - represented),
        "size_p95": sizes[int(.95 * (len(sizes) - 1))] if sizes else 0,
        "size_max": max(sizes, default=0), "by_pattern": dict(by_kind),
    }


def choose_seeds(data, scenario, random_seed=20261007):
    if scenario == "demo":
        # Actual dev demo calculation and default threshold; evaluation IDs are
        # not database IDs, so this reproduces density, not an exact dev run.
        from demo_calculator import build_targets, calculate, MODEL_VERSION, FEATURE_VERSION
        selected = set()
        for start in range(0, len(data.edges), 10_000):
            scores = calculate(build_targets(data.edges.tx_ids[start:start + 10_000]),
                               'binary', model_version=MODEL_VERSION,
                               feature_version=FEATURE_VERSION)
            selected.update(key for key, value in zip(scores['tx_id'].to_pylist(),
                            scores['p_laundering'].to_pylist()) if value >= 0.7)
        return selected
    positives = data.positives
    if scenario == "oracle":
        return set(positives)
    if scenario == "half":
        return set(random.Random(random_seed).sample(sorted(positives), len(positives) // 2))
    if scenario == "cluster_fn":
        # Lose every positive edge whose sender lies in one deterministic account partition.
        edges = data.edges
        return {tx_id for tx_id in positives
                if edges.from_accounts[edges.position(tx_id)] % 2 == 0}
    if scenario == "hub_fp":
        # Concentrated false positives at one high-activity sender, selected without Patterns.
        edges = data.edges
        sender_counts = Counter(edges.from_accounts)
        hub = min(sender_counts, key=lambda account: (-sender_counts[account], account))
        normal_rows = [tx_id for pos, tx_id in enumerate(edges.tx_ids)
                       if edges.from_accounts[pos] == hub and tx_id not in positives]
        injected = random.Random(418).sample(normal_rows, min(len(positives), len(normal_rows)))
        return positives | set(injected)
    if scenario == "one":
        return {min(rows, key=lambda tx_id: (data.edges.occurred_us[data.edges.position(tx_id)], tx_id))
                for rows in data.truth.values()}
    if scenario == "fp":
        # Reservoir sample normal rows without allocating a 5M-element normal-ID set.
        rng, reservoir, seen = random.Random(73), [], 0
        for tx_id in data.edges.tx_ids:
            if tx_id in positives:
                continue
            seen += 1
            if len(reservoir) < len(positives):
                reservoir.append(tx_id)
            else:
                slot = rng.randrange(seen)
                if slot < len(reservoir):
                    reservoir[slot] = tx_id
        return positives | set(reservoir)
    raise ValueError("Unknown seed scenario")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--transactions", type=Path)
    source.add_argument("--top10-dir", type=Path)
    parser.add_argument("--patterns", type=Path, required=True)
    parser.add_argument("--shift-days", type=int, default=0)
    parser.add_argument("--cutoff", help="Exclusive YYYY-MM-DD KST; fixed before reading rows")
    parser.add_argument("--split-at", help="YYYY-MM-DD KST holdout boundary; crossing blocks reported")
    parser.add_argument("--scenarios", nargs="+",
                        choices=("oracle", "half", "one", "fp", "cluster_fn", "hub_fp", "demo"),
                        default=["oracle", "half", "one", "fp"])
    parser.add_argument("--hops", type=int, default=2)
    parser.add_argument("--context", type=int, default=100)
    parser.add_argument("--context-total", type=int, default=200)
    args = parser.parse_args()
    policy = FlowPolicy(max_hops=args.hops, context_per_seed=args.context,
                        max_context_edges=args.context_total)
    policy.validate()
    source_hashes = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                     for name in ("flow_graph.py", "evaluate_flow_graph.py")}
    if 'demo' in args.scenarios:
        source_hashes['demo_calculator.py'] = hashlib.sha256(
            Path(__file__).with_name('demo_calculator.py').read_bytes()).hexdigest()
    print(json.dumps({"stage": "configuration", "policy": asdict(policy),
                      "source_sha256": source_hashes, "cutoff": args.cutoff,
                      "split_at": args.split_at, "scenarios": args.scenarios,
                      "demo_seed_contract": {"model": "demo-random-v1", "threshold": 0.7,
                          "identity": "evaluation_ids_not_dev_database_ids"} if 'demo' in args.scenarios else None,
                      "patterns_sha256": hashlib.sha256(args.patterns.read_bytes()).hexdigest()}),
          flush=True)
    cutoff = (int(datetime.fromisoformat(args.cutoff).replace(tzinfo=KST).timestamp()) * 1_000_000
              if args.cutoff else None)
    started = time.perf_counter()
    data = load_dataset(args.transactions, args.top10_dir, args.patterns, args.shift_days, cutoff)
    print(json.dumps({"stage": "input", "audit": data.audit,
                      "load_seconds": round(time.perf_counter() - started, 3),
                      "memory": process_memory()}), flush=True)
    split = None
    if args.split_at:
        at = int(datetime.fromisoformat(args.split_at).replace(tzinfo=KST).timestamp()) * 1_000_000
        split = {"train": set(), "holdout": set(), "crossing": set()}
        for pattern_id, tx_ids in data.truth.items():
            values = [data.edges.occurred_us[data.edges.position(tx_id)] for tx_id in tx_ids]
            bucket = "train" if max(values) < at else "holdout" if min(values) >= at else "crossing"
            split[bucket].add(pattern_id)
        print(json.dumps({"stage": "split", "patterns": {key: len(value) for key, value in split.items()}}),
              flush=True)
    started = time.perf_counter()
    index = FlowIndex(data.edges)
    index_seconds = time.perf_counter() - started
    print(json.dumps({"stage": "index", "variant": "flow",
                      "seconds": round(index_seconds, 3)}), flush=True)
    failed = False
    for scenario in args.scenarios:
        seeds = choose_seeds(data, scenario)
        started = time.perf_counter()
        try:
            batch = build_flow_graphs(index, seeds, policy)
        except GraphBudgetExceeded as exc:
            failed = True
            print(json.dumps({"stage": "failed", "variant": "flow", "scenario": scenario,
                              "reason": str(exc), "seeds": len(seeds),
                              "seconds": round(time.perf_counter() - started, 3)}), flush=True)
            continue
        groups = [(set(graph.seed_ids), set(graph.seed_ids + graph.connection_ids + graph.context_ids))
                  for graph in batch.graphs]
        counters = {"edge_visits": batch.edge_visits,
                    "policy_digest": batch.policy_digest,
                    "unassigned_reasons": dict(Counter(item.reason for item in batch.unassigned)),
                    "rejected_reasons": dict(Counter(item.reason for item in batch.rejected_relations)),
                    "neighbor_selected_windows": batch.selected_neighbor_windows,
                    "rejected_span_relations": batch.rejected_span_relations,
                    "core_max": max((len(graph.seed_ids) + len(graph.connection_ids)
                                     for graph in batch.graphs), default=0)}
        elapsed = time.perf_counter() - started
        report = {"stage": "result", "variant": "flow", "scenario": scenario, "seeds": len(seeds),
                  "build_seconds": round(elapsed, 3),
                  "index_seconds_separate": round(index_seconds, 3),
                  "metrics": metric(groups, data, seeds), "counters": counters,
                  "memory": process_memory()}
        if split:
            report["split_metrics"] = {name: metric(groups, data, seeds, pattern_ids)
                                       for name, pattern_ids in split.items()}
        print(json.dumps(report), flush=True)
        del groups
        del batch
        gc.collect()
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

