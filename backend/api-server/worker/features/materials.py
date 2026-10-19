"""Model-independent materials sent with every model input: the run's frozen transactions
and, per account, the name-free categories stored by 거래 통합.

Every model receives the same files, so a model or feature change never changes what the
backend sends. Values are the frozen input as stored (UTC instants, exact decimals, ISO
currencies, pseudonymous UUIDs); each model derives its own features on the inference server.
"""
import pyarrow as pa
import pyarrow.parquet as pq

from common.worker_transport import ProtocolError

MATERIALS = ("transactions", "accounts")
AMOUNT = pa.decimal128(24, 6)
TRANSACTIONS = pa.schema([
    ("tx_id", pa.int64()), ("input_role", pa.string()), ("occurred_at", pa.timestamp("us", tz="UTC")),
    ("business_date", pa.date32()), ("from_bank_id", pa.int32()), ("to_bank_id", pa.int32()),
    ("from_account_id", pa.string()), ("to_account_id", pa.string()),
    ("from_owner_id", pa.string()), ("to_owner_id", pa.string()),
    ("amount_received", AMOUNT), ("receiving_currency", pa.string()),
    ("amount_paid", AMOUNT), ("payment_currency", pa.string()),
    ("payment_format", pa.string()), ("amount_usd", AMOUNT),
])
ACCOUNTS = pa.schema([
    ("account_id", pa.string()), ("bank_id", pa.int32()), ("owner_id", pa.string()),
    ("entity_type", pa.string()), ("country", pa.string()),
])
_TRANSACTIONS = """
    SELECT tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
           from_account_id::text,to_account_id::text,from_owner_id::text,to_owner_id::text,
           amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd
    FROM analysis.run_inputs WHERE run_id=%s ORDER BY tx_id
"""
_ACCOUNTS = """
    WITH parties AS (
      SELECT from_account_id AS account_id,from_bank_id AS bank_id,from_owner_id AS owner_id
      FROM analysis.run_inputs WHERE run_id=%s
      UNION SELECT to_account_id,to_bank_id,to_owner_id FROM analysis.run_inputs WHERE run_id=%s)
    SELECT p.account_id::text,p.bank_id,p.owner_id::text,o.entity_type,b.country
    FROM parties p
    LEFT JOIN core.owners o ON o.service_owner_id=p.owner_id
    LEFT JOIN core.banks b ON b.bank_id=p.bank_id
    ORDER BY p.account_id
"""


def _write(connection, query, arguments, schema, path, batch_size):
    """Stream one query into one Parquet file; returns the row count."""
    count = 0
    with connection.transaction(), connection.cursor(name="materials") as cursor, \
            pq.ParquetWriter(path, schema) as writer:
        cursor.execute(query, arguments)
        while rows := cursor.fetchmany(batch_size):
            writer.write_table(pa.Table.from_pylist(
                [dict(zip(schema.names, row)) for row in rows], schema=schema))
            count += len(rows)
    return count


def write_materials(source, directory, *, batch_size=50000):
    """Write transactions.parquet and accounts.parquet for the claimed run into directory.

    Returns {name: row_count}. The caller records the files and rechecks ownership; any
    exception invalidates every file written here.
    """
    run = str(source.execution.run_id)
    counts = {
        "transactions": _write(source.connection, _TRANSACTIONS, (run,), TRANSACTIONS,
                               directory / "transactions.parquet", batch_size),
        "accounts": _write(source.connection, _ACCOUNTS, (run, run), ACCOUNTS,
                           directory / "accounts.parquet", batch_size),
    }
    if not counts["transactions"] or not counts["accounts"]:
        raise ProtocolError("Frozen input has no transactions")
    source.check_current()
    return counts
