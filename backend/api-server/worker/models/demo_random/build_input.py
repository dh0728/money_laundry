"""Model input preparation (backend worker): frozen TARGET IDs -> targets.parquet.

Never copies raw report or label columns. The caller owns the stream and must
recheck ownership before recording the artifact.
"""
from collections.abc import Iterable

import pyarrow as pa
import pyarrow.parquet as pq

from common.score_contract import target_ids
from common.worker_transport import ProtocolError


def build_targets(ids: Iterable[int]) -> pa.Table:
    """Accept frozen TARGET IDs only; never copy raw report or label columns."""
    ids = target_ids(ids)
    return pa.table({
        "tx_id": pa.array(ids, type=pa.int64()),
        "demo_value": pa.array([value % 100 for value in ids], type=pa.int64()),
    })


def write_input(source, output) -> int:
    """Write targets.parquet to a caller-owned stream; return the TARGET count.

    Success is not permission to publish: the caller must recheck ownership when
    recording artifacts. Any exception invalidates the entire output stream.
    """
    batches = (build_targets(ids) for ids in source.target_pages())
    first = next(batches, None)
    if first is None:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    count = first.num_rows
    with pq.ParquetWriter(output, first.schema) as writer:
        writer.write_table(first)
        for batch in batches:
            writer.write_table(batch)
            count += batch.num_rows
    source.check_current()
    return count
