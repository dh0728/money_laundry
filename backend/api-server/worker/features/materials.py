"""Model-independent materials sent with every model input: the run's frozen transactions
and, per account, the name-free categories stored by 거래 통합.

Every model receives the same files, so a model or feature change never changes what the
backend sends. Values are the frozen input as stored (UTC instants, exact decimals, ISO
currencies, pseudonymous UUIDs); each model derives its own features on the inference server.

With a ledger position (replica plan) the inference server keeps a copy of the frozen input:
"full" sends the run's whole frozen input, "delta" only what changed since the copy's base
position (rows new or changed since then, plus the tx_ids removed since then).
"""
import pyarrow as pa
import pyarrow.parquet as pq

from common.worker_transport import ProtocolError

MATERIALS = ("transactions", "accounts")
# With a ledger position: the copy also needs the transactions removed since its base.
REPLICA_MATERIALS = ("transactions", "accounts", "removed")
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
REMOVED = pa.schema([("tx_id", pa.int64())])
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
# Rows of this run's frozen input that are new or changed since the copy's base position: ledger
# versions opened after it, and the run's own TARGET rows. Values come from run_inputs, like the
# full file.
_CHANGED_IDS = """
    WITH changed AS (
      SELECT tx_id FROM analysis.input_ledger
      WHERE valid_from_seq>%(base)s AND valid_from_seq<=%(seq)s AND (valid_to_seq IS NULL OR valid_to_seq>%(seq)s)
      UNION SELECT tx_id FROM analysis.input_transactions WHERE run_id=%(run)s AND input_role='TARGET'),
    rows AS (SELECT * FROM analysis.run_inputs WHERE run_id=%(run)s AND tx_id IN (SELECT tx_id FROM changed))
"""
_CHANGED = _CHANGED_IDS + """
    SELECT tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
           from_account_id::text,to_account_id::text,from_owner_id::text,to_owner_id::text,
           amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd
    FROM rows ORDER BY tx_id
"""
# Accounts of the changed rows, with their current values; the copy keeps every other account.
_CHANGED_ACCOUNTS = _CHANGED_IDS + """,
    parties AS (SELECT from_account_id AS account_id,from_bank_id AS bank_id,from_owner_id AS owner_id FROM rows
                UNION SELECT to_account_id,to_bank_id,to_owner_id FROM rows)
    SELECT p.account_id::text,p.bank_id,p.owner_id::text,o.entity_type,b.country
    FROM parties p
    LEFT JOIN core.owners o ON o.service_owner_id=p.owner_id
    LEFT JOIN core.banks b ON b.bank_id=p.bank_id
    ORDER BY p.account_id
"""
# Ledger versions the copy holds that ended since its base (removed, or replaced by a changed row).
_REMOVED = """
    SELECT DISTINCT tx_id FROM analysis.input_ledger
    WHERE valid_to_seq>%(base)s AND valid_to_seq<=%(seq)s ORDER BY tx_id
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


def write_materials(source, directory, *, replica=None, batch_size=50000):
    """Write the materials files for the claimed run into directory.

    Without a replica plan: the whole frozen input (transactions, accounts). With one: the
    whole input for "full" or only the changes since base_seq for "delta", plus removed.
    Returns {name: row_count}. The caller records the files and rechecks ownership; any
    exception invalidates every file written here.
    """
    run = str(source.execution.run_id)
    connection = source.connection
    if replica is None or replica["mode"] == "full":
        counts = {
            "transactions": _write(connection, _TRANSACTIONS, (run,), TRANSACTIONS,
                                   directory / "transactions.parquet", batch_size),
            "accounts": _write(connection, _ACCOUNTS, (run, run), ACCOUNTS,
                               directory / "accounts.parquet", batch_size),
        }
        if not counts["transactions"] or not counts["accounts"]:
            raise ProtocolError("Frozen input has no transactions")
        if replica is not None:
            counts["removed"] = _write(connection, "SELECT NULL::bigint WHERE false", (), REMOVED,
                                       directory / "removed.parquet", batch_size)
    elif replica["mode"] == "delta":
        arguments = dict(run=run, base=replica["base_seq"], seq=replica["seq"])
        counts = {
            "transactions": _write(connection, _CHANGED, arguments, TRANSACTIONS,
                                   directory / "transactions.parquet", batch_size),
            "accounts": _write(connection, _CHANGED_ACCOUNTS, arguments, ACCOUNTS,
                               directory / "accounts.parquet", batch_size),
            "removed": _write(connection, _REMOVED, arguments, REMOVED,
                              directory / "removed.parquet", batch_size),
        }
    else:
        raise ProtocolError("Unknown replica mode")
    source.check_current()
    return counts
