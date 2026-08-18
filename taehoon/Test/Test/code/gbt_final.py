"""최종 확정 실험: G19 조합 다중시드 + 교차 임계값.

- 시드 3개로 train+valid 재학습 모델(B)을 만들고 test 확률을 평균 (앙상블)
- 임계값은 train-only 모델(A)의 valid 예측으로 선택 (교차 임계값, in-sample 아님)
- B 모델들의 valid 평균 예측으로 고른 in-sample 임계값도 병기
- 최종 앙상블 모델을 joblib으로 저장
환경변수: HYB_DS, DS_SUFFIX, 피처 토글, GBT_NEG, EXP_NAME
"""
import json
import os
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import precision_recall_curve

EXP_NAME = os.environ.get("EXP_NAME", "gbt_final_debug")
os.environ["EXP_NAME"] = EXP_NAME

DS = os.environ["HYB_DS"]

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train_gnn_exp as T  # noqa: E402

OUT = T.OUT
log = T.log


def fit_gbt(X, y, sd, sample_weight=None):
    es = os.environ.get("GBT_ES", "1") != "0"
    kw = dict(
        max_iter=int(os.environ.get("GBT_ITERS", "500")),
        learning_rate=float(os.environ.get("GBT_LR", "0.05")),
        max_leaf_nodes=int(os.environ.get("GBT_LEAVES", "31")),
        random_state=sd)
    if es:
        kw.update(early_stopping=True, validation_fraction=0.1, n_iter_no_change=30)
    else:
        kw.update(early_stopping=False)
    m = HistGradientBoostingClassifier(**kw)
    m.fit(X, y, sample_weight=sample_weight)
    return m


def best_f1_threshold(y_true, p):
    prec, rec, thr = precision_recall_curve(y_true, p)
    f1 = 2 * prec * rec / np.clip(prec + rec, 1e-12, None)
    return float(thr[int(np.argmax(f1[:-1]))])


def main():
    t0 = time.time()
    seeds, feat, X_nf, graphs, n_nodes, n_edge_feats = T.prepare_dataset(DS)

    import torch

    def build_X(split):
        s = seeds[split]
        xs = X_nf[split][s["src"].to(T.DEVICE)].cpu().numpy()
        xd = X_nf[split][s["dst"].to(T.DEVICE)].cpu().numpy()
        xe = feat[torch.from_numpy(s["idx"]).to(T.DEVICE)].cpu().numpy()
        return np.concatenate([xs, xd, xe], axis=1).astype(np.float32)

    gbt_neg = int(os.environ.get("GBT_NEG", "400000"))
    Xtr, ytr = build_X("train"), seeds["train"]["y"]
    Xv, yv = build_X("valid"), seeds["valid"]["y"]
    Xt, yt = build_X("test"), seeds["test"]["y"]

    # 시간 감쇠 가중치 (선택): 최근 거래일수록 가중 — recency 강화
    decay_hl = float(os.environ.get("GBT_DECAY_HL", "0"))  # 반감기(일), 0=미사용
    wtr = wv = None
    if decay_hl > 0:
        import pandas as pd
        ts_all = pd.read_parquet(
            T.DATA / f"edges_{DS}_{T.DS_SUFFIX}.parquet", columns=["timestamp"]
        )["timestamp"].astype("int64").to_numpy()
        day = 86_400_000_000_000
        t_max = ts_all[seeds["valid"]["idx"]].max()  # valid 끝 기준 (test 시각 미사용)
        wtr = 0.5 ** ((t_max - ts_all[seeds["train"]["idx"]]) / (decay_hl * day))
        wv = 0.5 ** ((t_max - ts_all[seeds["valid"]["idx"]]) / (decay_hl * day))
        log(f"시간 감쇠 가중치 적용: 반감기 {decay_hl}일")

    pt_ens = np.zeros(len(yt))
    per_seed = []
    models = []
    seed_list = [int(x) for x in os.environ.get("GBT_SEEDS", "42,1042,2042").split(",")]
    for k, sd in enumerate(seed_list):
        rng = np.random.default_rng(sd)
        pos, neg = np.flatnonzero(ytr == 1), np.flatnonzero(ytr == 0)
        sel = np.sort(np.concatenate(
            [pos, rng.choice(neg, min(gbt_neg, len(neg)), replace=False)]))
        # A: train-only → 교차 임계값
        mA = fit_gbt(Xtr[sel], ytr[sel], sd,
                     wtr[sel] if wtr is not None else None)
        thr_cross = best_f1_threshold(yv, mA.predict_proba(Xv)[:, 1])
        # B: train+valid 재학습
        Xb = np.concatenate([Xtr[sel], Xv])
        yb = np.concatenate([ytr[sel], yv])
        wb = (np.concatenate([wtr[sel], wv]) if wtr is not None else None)
        mB = fit_gbt(Xb, yb, sd, wb)
        pt = mB.predict_proba(Xt)[:, 1]
        pt_ens += pt
        res_cross = T.eval_at(yt, pt, thr_cross)
        per_seed.append({"seed": sd, "n_trees_B": int(mB.n_iter_),
                         "thr_cross": thr_cross,
                         "test_cross": res_cross})
        log(f"시드 {sd}: B {mB.n_iter_} trees, 교차임계값 test "
            f"AP={res_cross['AP']:.4f} F1={res_cross['F1']:.4f} ({time.time()-t0:.0f}s)")
        models.append(mB)
        del mA
    pt_ens /= len(seed_list)

    thr_x = float(np.mean([p["thr_cross"] for p in per_seed]))
    res = {
        "exp_name": EXP_NAME, "dataset": DS, "type": "gbt_tov_ensemble",
        "n_seeds": len(seed_list), "per_seed": per_seed,
        "threshold": thr_x,
        "test": T.eval_at(yt, pt_ens, thr_x),
        "total_seconds": round(time.time() - t0, 1),
    }
    log(f"최종 앙상블(3시드, 교차임계값): test AP={res['test']['AP']:.4f} "
        f"F1={res['test']['F1']:.4f}")
    with open(OUT / f"metrics_{DS}.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    with open(OUT / "config.json", "w", encoding="utf-8") as f:
        json.dump({"exp_name": EXP_NAME, "type": "gbt_tov_ensemble", "dataset": DS,
                   "ds_suffix": T.DS_SUFFIX, "n_seeds": len(seed_list), "gbt_neg": gbt_neg,
                   "features": {"time_freq": T.TIME_FREQ, "curr_z": T.CURR_Z,
                                "curr_usd": T.CURR_USD, "pattern": T.PATTERN,
                                "cycle": T.CYCLE, "passthru": T.PASSTHRU,
                                "pairagg": T.PAIRAGG},
                   "train_on_valid": True}, f, ensure_ascii=False, indent=2)
    joblib.dump(models, OUT / "checkpoint_gbt_ens3.joblib")
    log(f"모델 저장: checkpoint_gbt_ens3.joblib | 완료: {EXP_NAME}")


if __name__ == "__main__":
    main()
