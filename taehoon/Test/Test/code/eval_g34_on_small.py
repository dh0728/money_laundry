# -*- coding: utf-8 -*-
"""G34(HI-medium 학습 모델)를 HI-Small v2에 적용해 medium→small 전이 성능 평가.

MVP 시나리오 검증용: medium으로 학습한 모델을 small 운영 환경에 투입할 때의 성능.
- 범주형 원핫 컬럼은 medium train 기준으로 맞춤 (모델 입력 차원 일치)
- 임계값: ① G34 자체 교차 임계값(medium valid 기준, 순수 전이)
          ② small valid 최적 임계값(운영 적응 시나리오)

환경변수: EXP_NAME(기본 G35_g34_on_small), G34_DIR
"""
import json
import os
import time

os.environ.setdefault("EXP_NAME", "G35_g34_on_small")
os.environ.setdefault("DS_SUFFIX", "v2")
for k in ("TIME_FREQ", "CURR_Z", "CURR_USD", "PATTERN", "CYCLE", "PASSTHRU", "PAIRAGG"):
    os.environ[k] = "1"

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train_gnn_exp as T  # noqa: E402

OUT = T.OUT
log = T.log

G34_DIR = os.environ.get(
    "G34_DIR", str(T.BASE / "results" / "experiments" / "G34_medium_hgb"))


def medium_train_cat_cols():
    """medium train 분할의 범주형 원핫 컬럼 (G34 모델이 기대하는 레이아웃)."""
    cols = list(dict.fromkeys(T.EDGE_NUM + T.EDGE_CAT + ["split"]))
    df = pd.read_parquet(T.DATA / "edges_hi_medium.parquet", columns=cols)
    df = df.loc[df["split"] == "train"]
    _, cat_cols, _ = T.build_edge_features(df)
    log(f"medium train 범주 원핫 컬럼 {len(cat_cols)}개 확보")
    return cat_cols


def best_f1_threshold(y_true, p):
    prec, rec, thr = precision_recall_curve(y_true, p)
    f1 = 2 * prec * rec / np.clip(prec + rec, 1e-12, None)
    return float(thr[int(np.argmax(f1[:-1]))])


def eval_at(y, p, thr):
    yhat = (p >= thr).astype(int)
    return {
        "F1": float(f1_score(y, yhat)),
        "precision": float(precision_score(y, yhat, zero_division=0)),
        "recall": float(recall_score(y, yhat, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, yhat).tolist(),
    }


def batched_predict_proba(m, X, batch=2_000_000):
    ps = []
    for i in range(0, len(X), batch):
        ps.append(m.predict_proba(X[i:i + batch])[:, 1])
    return np.concatenate(ps)


def main():
    t0 = time.time()
    with open(os.path.join(G34_DIR, "metrics_hi.json")) as f:
        g34_metrics = json.load(f)
    g34_thr = g34_metrics["threshold"]
    log(f"G34 모델 임계값(medium valid 기준): {g34_thr:.4f}")

    cat_cols = medium_train_cat_cols()

    orig_build = T.build_edge_features

    def patched(df, train_cols=None, num_stats=None):
        return orig_build(
            df,
            train_cols=cat_cols if train_cols is None else train_cols,
            num_stats=num_stats,
        )

    T.build_edge_features = patched
    seeds, feat, X_nf, graphs, n_nodes, n_edge_feats = T.prepare_dataset("hi")
    T.build_edge_features = orig_build

    import torch

    def build_X(split):
        s = seeds[split]
        xs = X_nf[split][s["src"].to(T.DEVICE)].cpu().numpy()
        xd = X_nf[split][s["dst"].to(T.DEVICE)].cpu().numpy()
        xe = feat[torch.from_numpy(s["idx"]).to(T.DEVICE)].cpu().numpy()
        return np.concatenate([xs, xd, xe], axis=1).astype(np.float32)

    log(f"small 피처 행렬 구성 (엣지 {n_edge_feats} + 노드 9*2 = {n_edge_feats+18}차원)")
    Xv, yv = build_X("valid"), seeds["valid"]["y"]
    Xt, yt = build_X("test"), seeds["test"]["y"]

    models = joblib.load(os.path.join(G34_DIR, "checkpoint_gbt_ens3.joblib"))
    for i, m in enumerate(models):
        assert m.n_features_in_ == Xv.shape[1], (
            f"차원 불일치: 모델 {m.n_features_in_} vs 입력 {Xv.shape[1]}")
    log(f"모델 {len(models)}개, 입력 {models[0].n_features_in_}차원 일치 확인")

    pv = np.mean([batched_predict_proba(m, Xv) for m in models], axis=0)
    pt = np.mean([batched_predict_proba(m, Xt) for m in models], axis=0)

    thr_small_valid = best_f1_threshold(yv, pv)
    log(f"small valid 최적 임계값: {thr_small_valid:.4f} (G34 임계값: {g34_thr:.4f})")

    metrics = {
        "exp_name": T.EXP_NAME,
        "type": "g34_medium_model_on_small_transfer",
        "dataset": "hi",
        "ds_suffix": T.DS_SUFFIX,
        "source_model": "G34_medium_hgb (HI-medium 학습, 3시드 HGB 앙상블)",
        "valid": {
            "AP": float(average_precision_score(yv, pv)),
            "ROC_AUC": float(roc_auc_score(yv, pv)),
            "n": int(len(yv)), "n_pos": int(yv.sum()),
        },
        "test": {
            "AP": float(average_precision_score(yt, pt)),
            "ROC_AUC": float(roc_auc_score(yt, pt)),
            "n": int(len(yt)), "n_pos": int(yt.sum()),
            "at_g34_threshold": {"threshold": g34_thr, **eval_at(yt, pt, g34_thr)},
            "at_small_valid_threshold": {
                "threshold": thr_small_valid,
                **eval_at(yt, pt, thr_small_valid)},
        },
        "total_seconds": round(time.time() - t0, 1),
    }
    with open(OUT / "metrics_hi.json", "w") as f:
        json.dump(metrics, f, indent=2)
    with open(OUT / "config.json", "w") as f:
        json.dump({
            "exp_name": T.EXP_NAME, "type": metrics["type"], "dataset": "hi",
            "ds_suffix": T.DS_SUFFIX, "source": G34_DIR,
            "cat_cols": "medium_train"}, f, indent=2)
    log(f"완료 ({time.time()-t0:.1f}s) → {OUT / 'metrics_hi.json'}")
    log(f"small test AP {metrics['test']['AP']:.4f} | "
        f"F1@G34_thr {metrics['test']['at_g34_threshold']['F1']:.4f} | "
        f"F1@small_valid_thr {metrics['test']['at_small_valid_threshold']['F1']:.4f}")


if __name__ == "__main__":
    main()
