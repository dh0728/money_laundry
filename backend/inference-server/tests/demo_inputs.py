"""Request inputs as the backend writes them: demo targets (tx_id, demo_value) and Alert type inputs."""
from datetime import datetime, timezone
from decimal import Decimal

import pyarrow as pa

from models.alert_type_tree.model import TRANSACTIONS


def build_targets(ids):
    ids = sorted(ids)
    return pa.table({"tx_id": pa.array(ids, type=pa.int64()),
                     "demo_value": pa.array([value % 100 for value in ids], type=pa.int64())})


def build_alerts(keys):
    """targets and alert_transactions of an Alert type request: each Alert is a fan-out of three."""
    rows = [dict(alert_key=key, tx_id=key * 10 + index,
                 occurred_at=datetime(2023, 8, 1, index, tzinfo=timezone.utc),
                 from_account_id=f"hub-{key}", to_account_id=f"leaf-{key}-{index}",
                 amount_usd=Decimal("100.000000"), payment_format="ACH") for key in sorted(keys) for index in range(3)]
    return dict(targets=pa.table({"alert_key": pa.array(sorted(keys), type=pa.int64())}),
                alert_transactions=pa.Table.from_pylist(rows, schema=TRANSACTIONS))
