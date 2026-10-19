"""Materials sent by the backend -> the normalized transactions/KYC files v10 was trained on.

Rules match the team's package (checked against its reference graphs, 2026-10-17):
- ts is the source report wall clock. The backend stores report time read as Asia/Seoul,
  so converting the UTC instant back to Asia/Seoul restores it.
- currencies use the source names the calibration files are keyed by.
- entity_type outside the six trained categories and a missing country become null,
  which the preprocessing reads as UNKNOWN; entity_id is the pseudonymous owner.
- accounts are numbered densely in sorted account-ID order; only the neighbour sampling
  hash depends on these numbers, and it stays deterministic for the same frozen input.
"""
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from common.worker_transport import ProtocolError

# ISO code (ledger) -> source currency name (calibration key).
CURRENCY_NAMES = {
    "AUD": "Australian Dollar", "BTC": "Bitcoin", "BRL": "Brazil Real", "CAD": "Canadian Dollar",
    "EUR": "Euro", "MXN": "Mexican Peso", "RUB": "Ruble", "INR": "Rupee", "SAR": "Saudi Riyal",
    "ILS": "Shekel", "CHF": "Swiss Franc", "GBP": "UK Pound", "USD": "US Dollar", "JPY": "Yen",
    "CNY": "Yuan",
}
ENTITY_TYPES = ("Corporation", "Partnership", "Sole Proprietorship", "Individual", "Country", "Direct")
REQUIRED = {
    "transactions": ("tx_id", "occurred_at", "from_account_id", "to_account_id", "amount_paid",
                     "amount_received", "payment_currency", "receiving_currency", "payment_format"),
    "accounts": ("account_id", "owner_id", "entity_type", "country"),
}


def _currency(column):
    names = [CURRENCY_NAMES.get((code or "").strip()) for code in column.to_pylist()]
    if None in names:
        raise ProtocolError("Currency outside the binary_v10 calibration")
    return pa.array(names, pa.string())


def normalize(inputs, directory):
    """Write transactions.parquet and kyc.parquet into directory; return their paths and the context end date."""
    for name, columns in REQUIRED.items():
        table = inputs.get(name)
        if table is None or any(column not in table.column_names for column in columns):
            raise ProtocolError("binary_v10 requires the transactions and accounts materials")
    transactions, accounts = inputs["transactions"], inputs["accounts"]
    if transactions.num_rows == 0:
        raise ProtocolError("No transactions in the materials")
    order = sorted(accounts.column("account_id").to_pylist())
    if len(set(order)) != len(order):
        raise ProtocolError("Duplicate account in the materials")
    node = {account: index for index, account in enumerate(order)}
    try:
        src = [node[account] for account in transactions.column("from_account_id").to_pylist()]
        dst = [node[account] for account in transactions.column("to_account_id").to_pylist()]
    except KeyError:
        raise ProtocolError("Transaction account missing from the materials") from None
    occurred = transactions.column("occurred_at")
    if not pa.types.is_timestamp(occurred.type) or occurred.type.tz is None:
        raise ProtocolError("occurred_at must be a timezone-aware instant")
    # Same instant shown in Asia/Seoul, then its wall clock without a zone.
    local = pc.local_timestamp(pc.cast(occurred, pa.timestamp("us", tz="Asia/Seoul")))
    normalized = pa.table({
        "edge_id": pc.cast(transactions.column("tx_id"), pa.int64()),
        "ts": pc.cast(local, pa.timestamp("us")),
        "src": pa.array(src, pa.int64()), "dst": pa.array(dst, pa.int64()),
        "paid": pc.cast(transactions.column("amount_paid"), pa.float64()),
        "received": pc.cast(transactions.column("amount_received"), pa.float64()),
        "payment_currency": _currency(transactions.column("payment_currency")),
        "receiving_currency": _currency(transactions.column("receiving_currency")),
        "payment_format": pc.cast(transactions.column("payment_format"), pa.string()),
        "duplicate_group_id": pa.nulls(transactions.num_rows, pa.int64()),
    })
    rows = {row["account_id"]: row for row in accounts.select(list(REQUIRED["accounts"])).to_pylist()}
    kyc = pa.table({
        "node_id": pa.array(range(len(order)), pa.int64()),
        "entity_id": pa.array([rows[a]["owner_id"] for a in order], pa.string()),
        "entity_type": pa.array([rows[a]["entity_type"] if rows[a]["entity_type"] in ENTITY_TYPES else None
                                 for a in order], pa.string()),
        "country": pa.array([rows[a]["country"] or None for a in order], pa.string()),
    })
    paths = directory / "transactions.parquet", directory / "kyc.parquet"
    pq.write_table(normalized, paths[0])
    pq.write_table(kyc, paths[1])
    context_end = pc.max(pc.cast(normalized.column("ts"), pa.date32())).as_py()
    return paths, context_end
