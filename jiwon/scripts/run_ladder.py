"""보정 사다리: run_002~006, 각각 run_001 대비 단일 변인만 변경.

사용법: python run_ladder.py <WS루트>

기준선(run_001) 설정을 BASE에 고정하고, VARIANTS의 각 항목이 딱 하나씩만 바꾼다.
피처·분할·시드는 전부 동결. 각 run마다 성능 지표 + 포화 진단을 기록한다.
"""
import copy
import json
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
RUNS = WS / "data_work" / "runs"
RUNS.mkdir(exist_ok=True)

BASE = {"objective": "multiclass", "num_class": 10, "learning_rate": 0.1,
        "num_leaves": 31, "min_data_in_leaf": 20, "feature_fraction": 1.0,
        "bagging_fraction": 1.0, "max_bin": 255, "seed": 42,
        "num_threads": 12, "verbosity": -1}  # 실측 최적값 (CLAUDE.md §8)
NUM_ROUND, ES = 300, 30
CLS9 = ["FAN-OUT", "FAN-IN", "G-SCATTER", "S-GATHER", "CYCLE",
        "RANDOM", "BIPARTITE", "STACK", "NONPAT"]  # 라벨 1~9

VARIANTS = [
    # run_002b: run_002와 완전히 동일한 설정. num_threads 변경(32->4)이 결과에
    # 영향을 주는지 확인하는 재현 검증용. PR-AUC가 0.6463과 일치해야 사다리 비교가 유효.
    ("run_002b", "재현검증: run_002와 동일 (num_threads 32 -> 4)", {"lambda_l2": 10.0}, False, False),
    ("run_002", "lambda_l2: 0 -> 10", {"lambda_l2": 10.0}, False, False),
    ("run_003", "min_sum_hessian_in_leaf: 1e-3 -> 1.0", {"min_sum_hessian_in_leaf": 1.0}, False, False),
    ("run_004", "min_data_in_leaf: 20 -> 200", {"min_data_in_leaf": 200}, False, False),
    ("run_005", "class weight: none -> inverse frequency", {}, True, False),
    ("run_006", "early stopping metric: multi_logloss -> PR-AUC(세탁점수)", {}, False, True),
    ("run_007a", "lambda_l2: 10 -> 1", {"lambda_l2": 1.0}, False, False),
    ("run_007b", "lambda_l2: 10 -> 50", {"lambda_l2": 50.0}, False, False),
    ("run_007c", "lambda_l2: 10 -> 100", {"lambda_l2": 100.0}, False, False),
    ("run_008", "num_boost_round: 300 -> 1000", {"lambda_l2": 100.0}, False, False),
    ("run_009a", "lambda_l2: 100 -> 200 (상한 1000)", {"lambda_l2": 200.0}, False, False),
    ("run_009b", "lambda_l2: 100 -> 500 (상한 1000)", {"lambda_l2": 500.0}, False, False),
    ("run_011a", "min_sum_hessian_in_leaf: 1e-3 -> 0.1 (λ=100, 상한 1000)",
     {"lambda_l2": 100.0, "min_sum_hessian_in_leaf": 0.1}, False, False),
    ("run_011b", "min_sum_hessian_in_leaf: 1e-3 -> 1.0 (λ=100, 상한 1000)",
     {"lambda_l2": 100.0, "min_sum_hessian_in_leaf": 1.0}, False, False),
    ("run_012a", "num_leaves: 31 -> 127 (011b 설정)",
     {"lambda_l2": 100.0, "min_sum_hessian_in_leaf": 1.0, "num_leaves": 127}, False, False),
    ("run_012b", "num_leaves: 31 -> 512 (011b 설정)",
     {"lambda_l2": 100.0, "min_sum_hessian_in_leaf": 1.0, "num_leaves": 512}, False, False),
]

# run_007* 는 현 기준선 run_002 대비 단일 변인. 미기재는 run_001 대비.
BASELINES = {"run_007a": "run_002", "run_007b": "run_002", "run_007c": "run_002",
             "run_008": "run_007c", "run_009a": "run_008", "run_009b": "run_008",
             "run_011a": "run_008", "run_011b": "run_008",
             "run_012a": "run_011b", "run_012b": "run_011b"}

# 라운드 상한이 단일 변인인 run 만 기재. 미기재는 NUM_ROUND.
ROUNDS = {"run_008": 1000, "run_009a": 1000, "run_009b": 1000,
          "run_011a": 1000, "run_011b": 1000, "run_012a": 1000, "run_012b": 1000}

# ---------- 데이터 (한 번만 로드) ----------
df = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                 names=["ts", "fb", "fa", "tb", "ta", "amt_recv", "cur_recv",
                        "amt_paid", "cur_paid", "fmt", "flag"],
                 header=0, dtype={"fb": str, "tb": str, "fa": str, "ta": str})
df["ts"] = pd.to_datetime(df.ts, format="%Y/%m/%d %H:%M")
lab = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")
m = (df.ts < pd.Timestamp("2022-09-11")).to_numpy()
y = lab["label"].to_numpy()[m]
gf = pd.read_parquet(WS / "data_work" / "HI-Small_features_v1.parquet")
df = df[m].reset_index(drop=True)
fx = {l.rsplit(None, 1)[0].strip(): float(l.rsplit(None, 1)[1])
      for l in open(WS / "data_work" / "fx_rates_usd.txt")}
acc = pd.read_csv(WS / "data" / "HI-Small_accounts.csv", dtype=str)
et = dict(zip(acc["Bank ID"].str.lstrip("0").fillna("") + "|" + acc["Account Number"],
              acc["Entity Name"].str.rsplit(" #", n=1).str[0]))
X = gf.drop(columns=["orig_row"])
X["payment_format"] = df.fmt.astype("category")
X["log_amount_usd"] = np.log1p(df.amt_paid / df.cur_paid.map(fx)).astype("float32")
X["amount_mismatch"] = (df.amt_paid != df.amt_recv).astype("int8")
X["payment_currency"] = df.cur_paid.astype("category")
X["receiving_currency"] = df.cur_recv.astype("category")
X["same_bank"] = (df.fb == df.tb).astype("int8")
X["self_account"] = ((df.fb == df.tb) & (df.fa == df.ta)).astype("int8")
X["from_entity_type"] = (df.fb.str.lstrip("0") + "|" + df.fa).map(et).astype("category")
X["to_entity_type"] = (df.tb.str.lstrip("0") + "|" + df.ta).map(et).astype("category")
CATS = ["payment_format", "payment_currency", "receiving_currency",
        "from_entity_type", "to_entity_type"]
tr = (df.ts < pd.Timestamp("2022-09-07")).to_numpy()
va = ((df.ts >= pd.Timestamp("2022-09-07")) & (df.ts < pd.Timestamp("2022-09-09"))).to_numpy()
Xtr, Xva, ytr, yva = X[tr], X[va], y[tr], y[va]
ybin = (yva > 0).astype(int)
print(f"train={tr.sum():,} val={va.sum():,} 피처={X.shape[1]}", flush=True)


def to_2d(preds, n):
    p = np.asarray(preds)
    if p.ndim == 2:
        return p
    return p.reshape(n, -1, order="F") if p.size == n * 10 else p.reshape(-1, n).T


def feval_prauc(preds, ds):
    yy = ds.get_label()
    p = to_2d(preds, len(yy))
    return "prauc", float(average_precision_score((yy > 0).astype(int), 1 - p[:, 0])), True


def max_abs_leaf(model):
    mx = 0.0
    for t in model.dump_model()["tree_info"]:
        st = [t["tree_structure"]]
        while st:
            n = st.pop()
            if "leaf_value" in n:
                mx = max(mx, abs(n["leaf_value"]))
            else:
                st += [n["left_child"], n["right_child"]]
    return mx


def evaluate(model, name, desc, params, weighted, custom_es, secs):
    proba = model.predict(Xva, num_iteration=model.best_iteration)
    s = 1 - proba[:, 0]
    prec, rec, thr = precision_recall_curve(ybin, s)
    f1 = 2 * prec * rec / (prec + rec + 1e-12)
    i = int(f1.argmax())
    met = {"val_pr_auc": float(average_precision_score(ybin, s)),
           "best_iteration": int(model.best_iteration),
           "max_f1": float(f1[i]), "max_f1_precision": float(prec[i]),
           "max_f1_recall": float(rec[i]),
           "n_alarms_at_max_f1": int((s >= thr[i]).sum()) if i < len(thr) else int(len(s))}
    for t in (0.5, 0.7, 0.9):
        idx = np.where(rec[:-1] >= t)[0]
        j = int(idx[-1]) if len(idx) else 0
        met[f"precision_at_recall_{t}"] = float(prec[j])
        met[f"threshold_at_recall_{t}"] = float(thr[j])
    # 보조 운영점: 패턴 8클래스 recall 0.9 닻 (NONPAT 제외) — 판정은 여전히 P@R0.7
    pat = (yva >= 1) & (yva <= 8)
    spat = np.sort(s[pat])[::-1]
    th_p = spat[int(np.ceil(0.9 * pat.sum())) - 1]
    hit_p = s >= th_p
    met["precision_at_pattern_recall_0.9"] = float((hit_p & (yva > 0)).sum() / hit_p.sum())
    met["n_alarms_at_pattern_recall_0.9"] = int(hit_p.sum())
    met["threshold_at_pattern_recall_0.9"] = float(th_p)
    # 클래스별 진단: one-vs-rest PR-AUC (자기 확률 p_k 로 그 클래스만 골라내는 순위 능력)
    met["ovr_pr_auc"] = {CLS9[k - 1]: float(average_precision_score(
        (yva == k).astype(int), proba[:, k])) for k in range(1, 10)}
    met["saturation"] = {
        "n_unique_scores": int(len(np.unique(np.round(s, 9)))),
        "frac_mid_range": float(((s > 1e-6) & (s < 0.99)).mean()),
        "n_laundering_in_mid": int(((s > 1e-6) & (s < 0.99) & (yva > 0)).sum()),
        "max_abs_leaf_value": float(max_abs_leaf(model)),
    }
    rec_json = {"run_id": name, "baseline": BASELINES.get(name, "run_001"), "single_variable": desc,
                "dataset": "HI-Small (ts < 2022-09-11)",
                "split": {"train": "09-01~06", "val": "09-07~08", "test": "미개봉"},
                "intervention": "none",
                "features": "features_v1 61개 (jiwon/features_v1.md)",
                "params": params, "num_boost_round": ROUNDS.get(name, NUM_ROUND),
                "early_stopping_rounds": ES,
                "class_weight": "inverse frequency" if weighted else "none",
                "early_stopping_metric": "PR-AUC(1-P(정상))" if custom_es else "multi_logloss",
                "train_seconds": round(secs, 1), "metrics": met, "status": "keep"}
    json.dump(rec_json, open(RUNS / f"{name}.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    model.save_model(str(RUNS / f"{name}_model.txt"), num_iteration=model.best_iteration)
    return met


only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
results = []
for name, desc, override, weighted, custom_es in VARIANTS:
    if only and name not in only:
        continue
    params = copy.deepcopy(BASE)
    params.update(override)
    w = None
    if weighted:
        cnt = np.bincount(ytr, minlength=10).astype(float)
        cw = len(ytr) / (10 * np.maximum(cnt, 1))
        w = cw[ytr]
    if custom_es:
        params["metric"] = "None"
    t0 = time.time()
    dtr = lgb.Dataset(Xtr, label=ytr, weight=w, categorical_feature=CATS)
    dva = lgb.Dataset(Xva, label=yva, reference=dtr)
    cbs = [lgb.early_stopping(ES, verbose=False), lgb.log_evaluation(0)]
    model = lgb.train(params, dtr, num_boost_round=ROUNDS.get(name, NUM_ROUND), valid_sets=[dva],
                      valid_names=["val"], feval=feval_prauc if custom_es else None,
                      callbacks=cbs)
    secs = time.time() - t0
    met = evaluate(model, name, desc, params, weighted, custom_es, secs)
    sat = met["saturation"]
    print(f"\n=== {name}: {desc} ({secs:.0f}s, iter={met['best_iteration']}) ===", flush=True)
    print(f"  PR-AUC {met['val_pr_auc']:.4f} | max-F1 {met['max_f1']*100:.2f}% "
          f"(P {met['max_f1_precision']*100:.1f}% / R {met['max_f1_recall']*100:.1f}%) | "
          f"P@R0.7 {met['precision_at_recall_0.7']*100:.4f}%", flush=True)
    print(f"  포화진단: 고유점수 {sat['n_unique_scores']:,}개, 중간구간 {sat['frac_mid_range']*100:.3f}% "
          f"(세탁 {sat['n_laundering_in_mid']}건), |리프|최대 {sat['max_abs_leaf_value']:,.1f}", flush=True)
    print(f"  P@패턴R0.9 {met['precision_at_pattern_recall_0.9']*100:.2f}% "
          f"(알람 {met['n_alarms_at_pattern_recall_0.9']:,}건)", flush=True)
    print("  OVR PR-AUC: " + " ".join(f"{n} {v:.3f}" for n, v in met["ovr_pr_auc"].items()), flush=True)
    results.append({"run": name, "변인": desc, "PR-AUC": met["val_pr_auc"],
                    "max-F1%": met["max_f1"] * 100, "P@R0.7%": met["precision_at_recall_0.7"] * 100,
                    "고유점수": sat["n_unique_scores"], "|리프|최대": sat["max_abs_leaf_value"],
                    "iter": met["best_iteration"]})

print("\n\n########## 사다리 요약 (기준선 run_001: PR-AUC 0.1146, max-F1 25.32%, 고유점수 2, |리프| 25,618,387) ##########")
print(pd.DataFrame(results).to_string(index=False, float_format=lambda x: f"{x:,.4f}"))
