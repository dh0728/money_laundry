"""기준선 학습 (개입 없음): 확정 피처 61개, LightGBM 10클래스.

사용법: python train_baseline.py <WS루트> [run_id=run_001]

- 분할: train 09-01~06 / val 09-07~08 (test 미개봉)
- 평가: val, 세탁점수 = 1 - P(NORMAL), recall 0.5/0.7/0.9 역산 precision
- 기록: data_work/runs/<run_id>.json
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
RUN_ID = sys.argv[2] if len(sys.argv) > 2 else "run_001"
NAME = {0: "NORMAL", 1: "FAN-OUT", 2: "FAN-IN", 3: "GATHER-SCATTER",
        4: "SCATTER-GATHER", 5: "CYCLE", 6: "RANDOM", 7: "BIPARTITE",
        8: "STACK", 9: "NONPATTERN"}

CONFIG = {
    "run_id": RUN_ID,
    "dataset": "HI-Small (ts < 2022-09-11)",
    "split": {"train": "09-01~06", "val": "09-07~08", "test": "09-09~10 미개봉"},
    "intervention": "none",
    "features": "features_v1 명세 61개 (단건 7 + 계좌속성 2 + 그래프 52) — jiwon/features_v1.md",
    "downsampling": "none", "class_weight": "none",
    "model": "lightgbm-multiclass-10",
    "params": {"objective": "multiclass", "num_class": 10, "learning_rate": 0.1,
               "num_leaves": 31, "min_data_in_leaf": 20, "feature_fraction": 1.0,
               "bagging_fraction": 1.0, "max_bin": 255, "seed": 42,
               "num_threads": 32, "verbosity": -1},
    "num_boost_round": 300, "early_stopping_rounds": 30,
    "laundering_score": "1 - P(NORMAL)",
}

# ---- 로드 ----
df = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                 names=["ts", "from_bank", "from_acct", "to_bank", "to_acct",
                        "amt_recv", "cur_recv", "amt_paid", "cur_paid", "fmt", "flag"],
                 header=0, dtype={"from_bank": str, "to_bank": str,
                                  "from_acct": str, "to_acct": str})
df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
labels_full = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")["label"]
mask = df.ts < pd.Timestamp("2022-09-11")
y = labels_full[mask].to_numpy()
gf = pd.read_parquet(WS / "data_work" / "HI-Small_features_v1.parquet")
assert (gf.orig_row.to_numpy() == df.index[mask].to_numpy()).all(), "피처-거래 정렬 불일치"
df = df[mask].reset_index(drop=True)

fx = {}
for line in open(WS / "data_work" / "fx_rates_usd.txt"):
    k, v = line.rsplit(None, 1)
    fx[k.strip()] = float(v)

acc = pd.read_csv(WS / "data" / "HI-Small_accounts.csv", dtype=str)
etype = dict(zip(acc["Bank ID"].str.lstrip("0").fillna("") + "|" + acc["Account Number"],
                 acc["Entity Name"].str.rsplit(" #", n=1).str[0]))

X = gf.drop(columns=["orig_row"])
X["payment_format"] = df.fmt.astype("category")
X["log_amount_usd"] = np.log1p(df.amt_paid / df.cur_paid.map(fx)).astype("float32")
X["amount_mismatch"] = (df.amt_paid != df.amt_recv).astype("int8")
X["payment_currency"] = df.cur_paid.astype("category")
X["receiving_currency"] = df.cur_recv.astype("category")
X["same_bank"] = (df.from_bank == df.to_bank).astype("int8")
X["self_account"] = ((df.from_bank == df.to_bank) & (df.from_acct == df.to_acct)).astype("int8")
X["from_entity_type"] = (df.from_bank.str.lstrip("0") + "|" + df.from_acct).map(etype).astype("category")
X["to_entity_type"] = (df.to_bank.str.lstrip("0") + "|" + df.to_acct).map(etype).astype("category")
assert X.shape[1] == 61, X.shape
assert not X["from_entity_type"].isna().any() and not X["to_entity_type"].isna().any()

cat_cols = ["payment_format", "payment_currency", "receiving_currency",
            "from_entity_type", "to_entity_type"]
tr = (df.ts < pd.Timestamp("2022-09-07")).to_numpy()
va = ((df.ts >= pd.Timestamp("2022-09-07")) & (df.ts < pd.Timestamp("2022-09-09"))).to_numpy()
print(f"train={tr.sum():,}  val={va.sum():,}  피처={X.shape[1]}", flush=True)

dtrain = lgb.Dataset(X[tr], label=y[tr], categorical_feature=cat_cols)
dval = lgb.Dataset(X[va], label=y[va], reference=dtrain)
model = lgb.train(CONFIG["params"], dtrain, num_boost_round=CONFIG["num_boost_round"],
                  valid_sets=[dval], valid_names=["val"],
                  callbacks=[lgb.early_stopping(CONFIG["early_stopping_rounds"]),
                             lgb.log_evaluation(25)])

# ---- 평가 (val) ----
proba = model.predict(X[va], num_iteration=model.best_iteration)
score = 1.0 - proba[:, 0]
y_bin = (y[va] > 0).astype(int)
prec, rec, thr = precision_recall_curve(y_bin, score)
metrics = {"val_pr_auc": float(average_precision_score(y_bin, score)),
           "best_iteration": model.best_iteration}
for tgt in [0.5, 0.7, 0.9]:
    i = np.where(rec[:-1] >= tgt)[0][-1]
    metrics[f"precision_at_recall_{tgt}"] = float(prec[i])
    metrics[f"threshold_at_recall_{tgt}"] = float(thr[i])

print("\n=== val 이진 평가 ===")
for k, v in metrics.items():
    print(f"  {k}: {v:.6f}" if isinstance(v, float) else f"  {k}: {v}")

pred = proba.argmax(axis=1)
print("\n=== val 혼동 (참값 기준 행, argmax) ===")
print(pd.crosstab(pd.Series(y[va], name="true").map(NAME),
                  pd.Series(pred, name="pred").map(NAME)).to_string())

imp = pd.Series(model.feature_importance("gain"), index=X.columns).sort_values(ascending=False)
print("\n=== 피처 중요도 상위 15 (gain) ===")
print((imp.head(15) / imp.sum() * 100).round(2).to_string())

runs = WS / "data_work" / "runs"
runs.mkdir(exist_ok=True)
json.dump({**CONFIG, "metrics": metrics, "status": "keep"},
          open(runs / f"{RUN_ID}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
model.save_model(str(runs / f"{RUN_ID}_model.txt"), num_iteration=model.best_iteration)
print(f"\n기록: data_work/runs/{RUN_ID}.json (+모델)")
