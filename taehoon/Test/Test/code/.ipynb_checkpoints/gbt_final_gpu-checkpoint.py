# -*- coding: utf-8 -*-
"""gbt_final.py의 메모리 절약 버전 — G31 학습 프로토콜 동일, memmap 행렬 사용.

cgroup 27GB 제한 대응 설계:
  - 피처 행렬(featmat_*.npy)은 memmap으로 두고, 상주 배열은 valid(1.8GB)만
  - train은 시드별 다운샘플 선택분(1.9GB)만 transient로 읽음
  - test 예측은 200만 건 청크로 스트리밍 (전체 행렬 비상주)

프로토콜(gbt_final.py와 동일):
  - 시드 3개(42,1042,2042), 세탁 전수 + 정상 GBT_NEG 다운샘플
  - A: train-only 모델 → valid 예측으로 F1 최적 교차 임계값
  - B: train+valid 재학습 → test 확률, 시드 평균 앙상블
  - test 평가는 교차 임계값 평균으로 1회

환경변수: HYB_DS, DS_SUFFIX, EXP_NAME, FEAT_NPY(필수), GBT_* ,
          BOOSTER=hgb(기본)|xgb(SM75+ 전용)
"""
import gc
import json
import os
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_curve
from sklearn.model_selection import train_test_split

EXP_NAME = os.environ.get("EXP_NAME", "gbt_final_memmap_debug")
os.environ["EXP_NAME"] = EXP_NAME

DS = os.environ["HYB_DS"]

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train_gnn_exp as T  # noqa: E402

OUT = T.OUT
log = T.log


def fit_model(X, y, sd):
    """부스터 선택: BOOSTER=hgb(기본, G31과 동일 알고리즘) | xgb(CUDA, SM75+)."""
    lr = float(os.environ.get("GBT_LR", "0.005"))
    iters = int(os.environ.get("GBT_ITERS", "8000"))
    leaves = int(os.environ.get("GBT_LEAVES", "63"))
    if os.environ.get("BOOSTER", "hgb") == "xgb":
        from xgboost import XGBClassifier
        Xtr, Xes, ytr, yes = train_test_split(
            X, y, test_size=0.1, random_state=sd, stratify=y)
        m = XGBClassifier(
            tree_method="hist", device="cuda",
            learning_rate=lr, max_leaves=leaves, n_estimators=iters,
            early_stopping_rounds=30, random_state=sd,
            n_jobs=int(os.environ.get("N_JOBS", "10")))
        m.fit(Xtr, ytr, eval_set=[(Xes, yes)], verbose=False)
        m.n_iter_report_ = m.best_iteration + 1
        return m
    from sklearn.ensemble import HistGradientBoostingClassifier
    m = HistGradientBoostingClassifier(
        max_iter=iters, learning_rate=lr, max_leaf_nodes=leaves,
        early_stopping=True, validation_fraction=0.1, n_iter_no_change=30,
        random_state=sd)
    m.fit(X, y)
    m.n_iter_report_ = m.n_iter_
    return m


def best_f1_threshold(y_true, p):
    prec, rec, thr = precision_recall_curve(y_true, p)
    f1 = 2 * prec * rec / np.clip(prec + rec, 1e-12, None)
    return float(thr[int(np.argmax(f1[:-1]))])


def batched_predict_proba(m, X, batch=2_000_000):
    ps = []
    for i in range(0, len(X), batch):
        ps.append(m.predict_proba(X[i:i + batch])[:, 1])
    return np.concatenate(ps)


def main():
    t0 = time.time()
    import torch

    feat_npy = os.environ["FEAT_NPY"]
    df = pd.read_parquet(
        T.DATA / f"edges_{DS}_{T.DS_SUFFIX}.parquet",
        columns=["from_id", "to_id", "is_laundering", "split"])
    split = df["split"].to_numpy()
    src = df["from_id"].to_numpy(np.int64)
    dst = df["to_id"].to_numpy(np.int64)
    y_all = df["is_laundering"].to_numpy(np.int8)
    del df
    seeds = {}
    for s in ("train", "valid", "test"):
        idx = np.flatnonzero(split == s)
        seeds[s] = {"idx": idx, "src": src[idx], "dst": dst[idx], "y": y_all[idx]}
        log(f"타겟 {s}: {len(idx):,}건 (세탁 {y_all[idx].sum():,})")
    del split, src, dst, y_all
    feat_np = np.load(feat_npy, mmap_mode="r")
    X_nf, n_nodes = T.load_node_features(DS)
    log(f"피처 행렬 메모리맵 로드: {feat_np.shape}")

    def build_rows(split_name, rows):
        """split 내 위치 rows에 해당하는 99차원 행을 transient로 구성."""
        s = seeds[split_name]
        xs = X_nf[split_name][
            torch.from_numpy(s["src"][rows]).to(T.DEVICE)].cpu().numpy()
        xd = X_nf[split_name][
            torch.from_numpy(s["dst"][rows]).to(T.DEVICE)].cpu().numpy()
        xe = np.asarray(feat_np[s["idx"][rows]], dtype=np.float32)
        return np.concatenate([xs, xd, xe], axis=1)

    def predict_split(m, split_name, batch=2_000_000):
        n = len(seeds[split_name]["y"])
        ps = np.empty(n, dtype=np.float64)
        for i in range(0, n, batch):
            j = min(i + batch, n)
            Xc = build_rows(split_name, np.arange(i, j))
            ps[i:j] = m.predict_proba(Xc)[:, 1]
            del Xc
        gc.collect()
        return ps

    ytr, yv, yt = seeds["train"]["y"], seeds["valid"]["y"], seeds["test"]["y"]
    gbt_neg = int(os.environ.get("GBT_NEG", "400000"))
    low_mem = os.environ.get("GBT_LOW_MEM") == "1"
    n_v = len(yv)

    # valid만 상주 (임계값 선택용). 저메모리 모드: 시드별 구축 후 해제
    if low_mem:
        Xv = None
        log("저메모리 모드(GBT_LOW_MEM): valid 행렬 시드별 구축·해제")
    else:
        Xv = build_rows("valid", np.arange(n_v))
        log(f"valid 행렬 상주: {Xv.shape} ({time.time()-t0:.0f}s)")

    pt_ens = np.zeros(len(yt))
    per_seed = []
    models = []
    seed_list = [int(x) for x in os.environ.get("GBT_SEEDS", "42,1042,2042").split(",")]
    for sd in seed_list:
        rng = np.random.default_rng(sd)
        pos, neg = np.flatnonzero(ytr == 1), np.flatnonzero(ytr == 0)
        sel = np.sort(np.concatenate(
            [pos, rng.choice(neg, min(gbt_neg, len(neg)), replace=False)]))
        # A: train-only → 교차 임계값
        if low_mem:
            Xv = build_rows("valid", np.arange(n_v))
        Xsel = build_rows("train", sel)
        mA = fit_model(Xsel, ytr[sel], sd)
        thr_cross = best_f1_threshold(yv, batched_predict_proba(mA, Xv))
        n_a = mA.n_iter_report_
        del mA
        gc.collect()
        # B: train+valid 재학습 (사전할당 후 채움 — 임시 복사본 없음)
        Xb = np.empty((len(sel) + len(Xv), Xv.shape[1]), dtype=np.float32)
        Xb[:len(sel)] = Xsel
        Xb[len(sel):] = Xv
        yb = np.concatenate([ytr[sel], yv])
        del Xsel
        if low_mem:
            del Xv
        gc.collect()
        mB = fit_model(Xb, yb, sd)
        del Xb, yb
        gc.collect()
        pt = predict_split(mB, "test")
        pt_ens += pt
        res_cross = T.eval_at(yt, pt, thr_cross)
        del pt
        gc.collect()
        per_seed.append({"seed": sd, "n_trees_A": n_a,
                         "n_trees_B": int(mB.n_iter_report_),
                         "thr_cross": thr_cross,
                         "test_cross": res_cross})
        log(f"시드 {sd}: A {n_a} / B {mB.n_iter_report_} trees, 교차임계값 test "
            f"AP={res_cross['AP']:.4f} F1={res_cross['F1']:.4f} ({time.time()-t0:.0f}s)")
        models.append(mB)
    pt_ens /= len(seed_list)

    thr_x = float(np.mean([p["thr_cross"] for p in per_seed]))
    booster = os.environ.get("BOOSTER", "hgb")
    res = {
        "exp_name": EXP_NAME, "dataset": DS, "type": f"{booster}_tov_ensemble",
        "n_seeds": len(seed_list), "per_seed": per_seed,
        "threshold": thr_x,
        "test": T.eval_at(yt, pt_ens, thr_x),
        "total_seconds": round(time.time() - t0, 1),
    }
    log(f"최종 앙상블({len(seed_list)}시드, 교차임계값): test AP={res['test']['AP']:.4f} "
        f"F1={res['test']['F1']:.4f}")
    with open(OUT / f"metrics_{DS}.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    with open(OUT / "config.json", "w", encoding="utf-8") as f:
        json.dump({"exp_name": EXP_NAME, "type": f"{booster}_tov_ensemble",
                   "dataset": DS, "ds_suffix": T.DS_SUFFIX,
                   "n_seeds": len(seed_list), "gbt_neg": gbt_neg,
                   "booster": booster,
                   "features": {"time_freq": T.TIME_FREQ, "curr_z": T.CURR_Z,
                                "curr_usd": T.CURR_USD, "pattern": T.PATTERN,
                                "cycle": T.CYCLE, "passthru": T.PASSTHRU,
                                "pairagg": T.PAIRAGG},
                   "train_on_valid": True}, f, ensure_ascii=False, indent=2)
    joblib.dump(models, OUT / "checkpoint_gbt_ens3.joblib")
    log(f"모델 저장: checkpoint_gbt_ens3.joblib | 완료: {EXP_NAME}")


if __name__ == "__main__":
    main()
