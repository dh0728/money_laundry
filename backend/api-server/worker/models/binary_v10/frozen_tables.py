"""Frozen run input -> the normalized transactions/KYC tables the v10 preprocessing expects.

Runs in model input preparation (backend worker). Reads only the run's frozen input
(TARGET and cumulative CONTEXT) and the name-free categories stored by 거래 통합.
Rules follow the delivered package (verified against its reference graphs):
- ts is the source wall clock; ingest reads report time as Asia/Seoul.
- currencies use the source names the calibration files are keyed by.
- entity_type outside the six trained categories and a missing country stay null;
  the v10 preprocessing reads null as UNKNOWN.
Account and owner UUIDs are mapped to dense integers in sorted UUID order, so the
mapping depends only on the frozen rows, not on database sequence values.
"""
import pyarrow as pa

from common.worker_transport import ProtocolError

# ISO code (ledger) -> source currency name (calibration key); inverse of ingest/report_csv.
CURRENCY_NAMES = {
    "AUD": "Australian Dollar", "BTC": "Bitcoin", "BRL": "Brazil Real", "CAD": "Canadian Dollar",
    "EUR": "Euro", "MXN": "Mexican Peso", "RUB": "Ruble", "INR": "Rupee", "SAR": "Saudi Riyal",
    "ILS": "Shekel", "CHF": "Swiss Franc", "GBP": "UK Pound", "USD": "US Dollar", "JPY": "Yen",
    "CNY": "Yuan",
}
ENTITY_TYPES = ("Corporation", "Partnership", "Sole Proprietorship", "Individual", "Country", "Direct")

TRANSACTIONS = pa.schema([
    ("edge_id", pa.int64()), ("ts", pa.timestamp("us")), ("src", pa.int64()), ("dst", pa.int64()),
    ("paid", pa.float64()), ("received", pa.float64()), ("payment_currency", pa.string()),
    ("receiving_currency", pa.string()), ("payment_format", pa.string()),
    ("duplicate_group_id", pa.int64()),
])
KYC = pa.schema([
    ("node_id", pa.int64()), ("entity_id", pa.string()), ("entity_type", pa.string()),
    ("country", pa.string()),
])

_ROWS = """
    SELECT i.tx_id, i.input_role = 'TARGET',
           (i.occurred_at AT TIME ZONE 'Asia/Seoul')::timestamp,
           i.from_account_id, i.to_account_id, i.from_owner_id, i.to_owner_id,
           fo.entity_type, too.entity_type, fb.country, tb.country,
           i.amount_paid::float8, i.amount_received::float8,
           i.payment_currency, i.receiving_currency, i.payment_format
    FROM analysis.run_inputs i
    LEFT JOIN core.owners fo ON fo.service_owner_id = i.from_owner_id
    LEFT JOIN core.owners too ON too.service_owner_id = i.to_owner_id
    LEFT JOIN core.banks fb ON fb.bank_id = i.from_bank_id
    LEFT JOIN core.banks tb ON tb.bank_id = i.to_bank_id
    WHERE i.run_id = %s
    ORDER BY i.tx_id
"""


def _currency(code):
    name = CURRENCY_NAMES.get((code or "").strip())
    if name is None:
        raise ProtocolError("Currency outside the binary_v10 calibration")
    return name


def _entity_type(value):
    return value if value in ENTITY_TYPES else None


def build(rows):
    """Rows of _ROWS -> (transactions, kyc, target_ids). Pure; raises on contract breaks."""
    edges, accounts, targets = [], {}, []
    for (tx_id, target, ts, src, dst, src_owner, dst_owner, src_type, dst_type,
         src_country, dst_country, paid, received, paid_ccy, received_ccy, fmt) in rows:
        if ts is None or paid is None or received is None or paid < 0 or received < 0:
            raise ProtocolError("Invalid frozen transaction")
        for account, owner, kind, country in ((src, src_owner, src_type, src_country),
                                              (dst, dst_owner, dst_type, dst_country)):
            record = (str(owner), _entity_type(kind), country or None)
            if accounts.setdefault(str(account), record) != record:
                raise ProtocolError("Account attributes differ within one frozen input")
        edges.append((tx_id, ts, str(src), str(dst), paid, received, _currency(paid_ccy),
                      _currency(received_ccy), fmt))
        if target:
            targets.append(tx_id)
    if not targets:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    node = {account: index for index, account in enumerate(sorted(accounts))}
    columns = list(zip(*edges))
    transactions = pa.table([
        pa.array(columns[0], pa.int64()), pa.array(columns[1], pa.timestamp("us")),
        pa.array([node[a] for a in columns[2]], pa.int64()),
        pa.array([node[a] for a in columns[3]], pa.int64()),
        pa.array(columns[4], pa.float64()), pa.array(columns[5], pa.float64()),
        pa.array(columns[6], pa.string()), pa.array(columns[7], pa.string()),
        pa.array(columns[8], pa.string()), pa.nulls(len(edges), pa.int64()),
    ], schema=TRANSACTIONS)
    ordered = sorted(accounts)
    kyc = pa.table([
        pa.array(range(len(ordered)), pa.int64()),
        pa.array([accounts[a][0] for a in ordered], pa.string()),
        pa.array([accounts[a][1] for a in ordered], pa.string()),
        pa.array([accounts[a][2] for a in ordered], pa.string()),
    ], schema=KYC)
    return transactions, kyc, targets


def read(source):
    """Frozen input of the claimed run, rechecking ownership after the read."""
    with source.connection.cursor() as cursor:
        cursor.execute(_ROWS, (str(source.execution.run_id),))
        rows = cursor.fetchall()
    source.check_current()
    return build(rows)
