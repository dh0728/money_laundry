"""targets.parquet rows as the backend's demo input builder writes them (tx_id, demo_value)."""
import pyarrow as pa


def build_targets(ids):
    ids = sorted(ids)
    return pa.table({"tx_id": pa.array(ids, type=pa.int64()),
                     "demo_value": pa.array([value % 100 for value in ids], type=pa.int64())})
