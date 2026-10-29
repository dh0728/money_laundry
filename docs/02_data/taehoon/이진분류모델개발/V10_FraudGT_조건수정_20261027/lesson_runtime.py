"""Small notebook conveniences; model, sampler and training remain in fraudgt_lab."""
from pathlib import Path
import inspect
import time

import numpy as np
import pandas as pd
import torch
from IPython.display import Code, display

from fraudgt_lab.config import VARIANTS, digest
from fraudgt_lab.data import FeatureAdapter
from fraudgt_lab.models import make_model
from fraudgt_lab.official_loader import PeriodGraph
from fraudgt_lab.population import Labels
from fraudgt_lab.training import sample_next
from notebook_display import LiveTrainingDisplay, METRIC_COLUMNS, read_result_json
from notebook_memory import MemoryMaintenance

PREDICTION_COLUMNS = ["transaction_id", "actual_label", "positive_probability", "predicted_label", "scored", "correct"]


def history_frame(run_dir, variant):
    """Return the real saved epoch rows, with stable columns even before training."""
    rows = read_result_json(Path(run_dir) / "models" / variant / "history.json", [])
    return pd.DataFrame(rows).reindex(columns=METRIC_COLUMNS)


class LearningCallbacks:
    """Refresh the existing gauges and figures without changing checkpoint selection."""

    def __init__(self, run_dir, config, refresh_seconds=2):
        self.run_dir = Path(run_dir)
        self.config = config
        self.refresh_seconds = refresh_seconds
        self.viewer = None
        self.last_refresh = 0.0
        self.memory = MemoryMaintenance(run_dir, config.seed_batch)

    def start(self):
        self.viewer = LiveTrainingDisplay(self.run_dir, self.config, VARIANTS)
        self.viewer.refresh()

    def on_progress(self, progress):
        self.memory.on_progress(progress)
        now = time.monotonic()
        phase = progress["phase"]
        complete = progress[phase]["percent"] >= 100
        if now - self.last_refresh >= self.refresh_seconds or complete:
            if self.viewer is not None:
                self.viewer.refresh()
            self.last_refresh = now

    def on_epoch(self, history, variant, best_epoch, eta):
        self.memory.cleanup('epoch_end')
        if self.viewer is not None:
            self.viewer.refresh()

    def finish(self):
        self.memory.cleanup('callback_finish')
        if self.viewer is not None:
            self.viewer.refresh()


def show_implementation(value):
    """Show the actual imported implementation, not a second copy of the model."""
    display(Code(inspect.getsource(value), language="python"))


def prediction_frame(ids, labels, rows, selection, logits):
    """Join by requested row positions; keep unscored requests visible as missing."""
    probability = np.full(len(ids), np.nan, dtype=np.float64)
    scored_rows = np.asarray(rows, dtype=np.int64)[np.asarray(selection, dtype=np.int64)]
    assert len(np.unique(scored_rows)) == len(scored_rows)
    probability[scored_rows] = torch.sigmoid(torch.as_tensor(logits)).numpy()
    frame = pd.DataFrame({
        "transaction_id": np.asarray(ids, dtype=np.int64),
        "actual_label": (np.asarray(labels) > 0).astype(np.int8),
        "positive_probability": probability,
        "predicted_label": pd.array([pd.NA] * len(ids), dtype="Int64"),
        "scored": np.isfinite(probability),
        "correct": pd.array([pd.NA] * len(ids), dtype="boolean"),
    })
    mask = frame["scored"]
    frame.loc[mask, "predicted_label"] = (frame.loc[mask, "positive_probability"] > 0.5).astype(int)
    frame.loc[mask, "correct"] = frame.loc[mask, "predicted_label"] == frame.loc[mask, "actual_label"]
    return frame[PREDICTION_COLUMNS]


def predict_examples(run_dir, variant, config, ids):
    """Small validation-only preview on CPU; not a performance evaluation."""
    from dataclasses import asdict, replace
    folder = Path(run_dir) / "models" / variant
    saved = torch.load(folder / "best.pt", map_location="cpu", weights_only=False)
    assert saved["config"] == asdict(config), "체크포인트와 현재 학습 설정이 다릅니다."
    assert saved["protocol_sha256"] == digest(Path(run_dir) / "protocol.json")
    preview_config = replace(config, loader_workers=0)
    # Do not consume the training kernel's RNG while making an inspection model.
    with torch.random.fork_rng(devices=[]):
        model = make_model(variant, config).eval()
    model.load_state_dict(saved["state_dict"])
    graph = PeriodGraph("val", variant, preview_config)
    adapter = FeatureAdapter(variant != "fraudgt_format")
    labels = Labels()(ids)
    iterator = iter(graph.loader(ids, batch_size=len(ids)))
    sampled = sample_next(iterator, preview_config, "preview", 0, 0)
    rows, batch, _ = adapter.materialize(graph, sampled, ids)
    with torch.inference_mode():
        logits, selection = model(batch)
    return prediction_frame(ids, labels, rows, selection.numpy(), logits.numpy())
