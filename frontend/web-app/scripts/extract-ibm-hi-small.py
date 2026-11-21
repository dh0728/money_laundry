"""Build the local benchmark from IBM AMLworld HI-Small_Trans.csv (CDLA-Sharing-1.0).

Usage: python3 scripts/extract-ibm-hi-small.py INPUT_CSV live-layout/ibm-hi-small-data.json
"""

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path


CSV_HEADER = [
    "Timestamp", "From Bank", "Account", "To Bank", "Account", "Amount Received",
    "Receiving Currency", "Amount Paid", "Payment Currency", "Payment Format", "Is Laundering",
]
PERIOD = {"start": "2022-09-01", "end": "2022-09-18"}
MAX_JSON_BYTES = 1_500_000


def update_first_seen(first_days, key, date):
    if first_days.setdefault(key, date) > date:
        first_days[key] = date


def extract(input_path):
    days = {}
    first_account_dates, first_bank_dates = {}, {}
    labeled_rows, unlabeled_examples = defaultdict(list), defaultdict(list)
    with input_path.open(newline="", encoding="utf-8-sig") as source:
        rows = csv.reader(source)
        if next(rows, None) != CSV_HEADER:
            raise ValueError("Unexpected HI-Small transaction header")
        for ordinal, fields in enumerate(rows, 1):
            timestamp, source_bank, source_account, target_bank, target_account, received, received_currency, paid, paid_currency, method, label = fields
            day = days.get(timestamp[:10])
            if day is None:
                date = timestamp[:10].replace("/", "-")
                day = days[timestamp[:10]] = {"date": date, "total": 0, "labeled": 0}
            date = day["date"]
            if label not in {"0", "1"}:
                raise ValueError(f"Unexpected label at CSV transaction {ordinal}")
            labeled = label == "1"
            day["total"] += 1
            day["labeled"] += labeled
            for bank, account in ((source_bank, source_account), (target_bank, target_account)):
                update_first_seen(first_account_dates, (bank, account), date)
                update_first_seen(first_bank_dates, bank, date)
            examples = labeled_rows[date] if labeled else unlabeled_examples[date]
            if labeled or len(examples) < 5:
                examples.append((ordinal, {
                    "code": f"T-{date[2:].replace('-', '')}-{ordinal:08}",
                    "timestamp": timestamp.replace("/", "-"),
                    "from": {"bank": source_bank, "account": source_account},
                    "to": {"bank": target_bank, "account": target_account},
                    "receivedAmount": float(received),
                    "receivedCurrency": received_currency,
                    "paidAmount": float(paid),
                    "paidCurrency": paid_currency,
                    "method": method,
                    "labeled": labeled,
                }))

    days = sorted(days.values(), key=lambda day: day["date"])
    new_accounts = Counter(first_account_dates.values())
    new_banks = Counter(first_bank_dates.values())
    for day in days:
        day["newAccounts"] = new_accounts[day["date"]]
        day["newBanks"] = new_banks[day["date"]]
    total = sum(day["total"] for day in days)
    labeled = sum(day["labeled"] for day in days)
    if (total, labeled) != (5_078_345, 5_177):
        raise ValueError(f"Unexpected HI-Small row totals: {total:,} transactions and {labeled:,} labels")
    if days[0]["date"] != PERIOD["start"] or days[-1]["date"] != PERIOD["end"]:
        raise ValueError("Unexpected HI-Small transaction period")
    benchmark = {
        "source": "IBM AMLworld HI-Small",
        "provenance": {
            "provider": "IBM",
            "sourceUrl": "https://github.com/IBM/AML-Data",
            "license": "CDLA-Sharing-1.0",
            "licenseUrl": "https://cdla.dev/sharing-1-0/",
            "changes": "Selected and reformatted HI-Small_Trans.csv rows and computed daily benchmark totals.",
        },
        "period": PERIOD,
        "totals": {
            "transactions": total, "labeled": labeled,
            "accounts": len(first_account_dates), "banks": len(first_bank_dates),
        },
        "days": days,
    }
    return benchmark, labeled_rows, unlabeled_examples


def encode(benchmark, labeled_rows, unlabeled_examples, per_day_limit=None):
    selected = [row for examples in unlabeled_examples.values() for row in examples]
    for rows in labeled_rows.values():
        if per_day_limit is not None and len(rows) > per_day_limit:
            # Evenly space picks by source ordinal within each date, including both endpoints.
            selected.extend(rows[i * (len(rows) - 1) // (per_day_limit - 1)] for i in range(per_day_limit))
        else:
            selected.extend(rows)
    benchmark["records"] = [row for _, row in sorted(selected)]
    return json.dumps(benchmark, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    benchmark, labeled_rows, unlabeled_examples = extract(args.input_csv)
    report = encode(benchmark, labeled_rows, unlabeled_examples)
    if len(report.encode("utf-8")) > MAX_JSON_BYTES:
        report = encode(benchmark, labeled_rows, unlabeled_examples, per_day_limit=300)
    if len(report.encode("utf-8")) > MAX_JSON_BYTES:
        raise ValueError("The ledger benchmark exceeded its JSON size limit")
    args.output_json.write_text(report, encoding="utf-8")
    summary_path = args.output_json.with_name("ibm-hi-small-summary.json")
    summary = {key: value for key, value in benchmark.items() if key != "records"}
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(benchmark['records']):,} ledger records, {len(report.encode('utf-8')):,} bytes")


if __name__ == "__main__":
    main()
