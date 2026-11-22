"""What analysis_entry hands every analysis stage's run(connection, execution, context)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class StageContext:
    storage_dir: str
    model_kind: str | None = None  # INFERENCE PUBLISH only
    settings: object = None  # remote inference settings, stages that talk to the inference worker
    s3: object = None
