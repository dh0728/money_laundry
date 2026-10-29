"""Model input preparation (backend worker): Alerts' core transactions -> targets.parquet and
alert_transactions.parquet.

The tree builds its graph features on the inference server from these rows alone, so the
files carry each Alert's transactions as they appear in the Alert's evidence.
"""
import pyarrow as pa
import pyarrow.parquet as pq

from common.score_contract import target_ids
from common.worker_transport import ProtocolError

FILES = ("targets", "alert_transactions")
TARGETS = pa.schema([("alert_key", pa.int64())])
TRANSACTIONS = pa.schema([
    ("alert_key", pa.int64()), ("tx_id", pa.int64()), ("occurred_at", pa.timestamp("us", tz="UTC")),
    ("from_account_id", pa.string()), ("to_account_id", pa.string()),
    ("amount_usd", pa.decimal128(24, 6)), ("payment_format", pa.string()),
])


def write_input(alerts, folder) -> int:
    """Write both files into folder; return the Alert count.

    alerts yields (alert_key, rows) in ascending alert_key order, rows being dicts with the
    TRANSACTIONS columns other than alert_key.
    """
    keys = []
    with pq.ParquetWriter(folder / "alert_transactions.parquet", TRANSACTIONS) as writer:
        for key, rows in alerts:
            if not rows:
                raise ProtocolError("An Alert type input needs the Alert's core transactions")
            keys.append(key)
            writer.write_table(pa.Table.from_pylist([dict(row, alert_key=key) for row in rows], schema=TRANSACTIONS))
    if not keys:
        raise ProtocolError("No Alert to classify must complete without inference")
    pq.write_table(pa.table({"alert_key": pa.array(target_ids(keys), pa.int64())}, schema=TARGETS),
                   folder / "targets.parquet")
    return len(keys)
