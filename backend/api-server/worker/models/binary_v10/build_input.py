"""Model input preparation (backend worker): frozen TARGET IDs -> targets.parquet (tx_id only).

v10 builds its features from the materials sent with every request, so the targets file
names only the transactions to score.
"""
import pyarrow as pa
import pyarrow.parquet as pq

from common.score_contract import target_ids
from common.worker_transport import ProtocolError

SCHEMA = pa.schema([("tx_id", pa.int64())])


def write_input(source, output) -> int:
    """Write targets.parquet to a caller-owned stream; return the TARGET count."""
    count = 0
    with pq.ParquetWriter(output, SCHEMA) as writer:
        for ids in source.target_pages():
            writer.write_table(pa.table({"tx_id": pa.array(target_ids(ids), pa.int64())}, schema=SCHEMA))
            count += len(ids)
    if not count:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    source.check_current()
    return count
