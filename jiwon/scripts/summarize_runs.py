"""전 실험 모델을 val 로 재평가해 종합/클래스별 지표를 md 표로 출력.

사용법: python summarize_runs.py <WS루트>
data_work/runs/ 의 run_*_model.txt 전부를 대상으로 한다. 표준출력만 —
runs/metrics_summary.md 갱신은 출력을 검토해 수동으로 반영한다.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve

WS = Path(sys.argv[1])
RUNS = WS / "data_work" / "runs"
CLS = ["NORMAL", "FAN-OUT", "FAN-IN", "G-SCATTER", "S-GATHER",
       "CYCLE", "RANDOM", "BIPARTITE", "STACK", "NONPAT"]

# ---------- val 데이터 (run_ladder.py 와 동일 파이프라인) ----------
df = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                 names=["ts", "fb", "fa", "tb", "ta", "amt_recv", "cur_recv",
                        "amt_paid", "cur_paid", "fmt", "flag"],
                 header=0, dtype={"fb": str, "tb": str, "fa": str, "ta": str})
df["ts"] = pd.to_datetime(df.ts, format="%Y/%m/%d %H:%M")
lab = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")
m = (df.ts < pd.Timestamp("2022-09-11")).to_numpy()
y = lab["label"].to_numpy()[m]
aid = lab["attempt_id"].to_numpy()[m]
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
va = ((df.ts >= pd.Timestamp("2022-09-07")) & (df.ts < pd.Timestamp("2022-09-09"))).to_numpy()
Xva, yva, ava = X[va], y[va], aid[va]
del df, gf, lab, acc, X
ybin = (yva > 0).astype(int)
n_attempt = len(set(ava[ava >= 0]))
print(f"<!-- val={va.sum():,} 세탁={int(ybin.sum()):,} attempt={n_attempt} -->", flush=True)

order = [f.stem.replace("_model", "") for f in sorted(RUNS.glob("run_*_model.txt"))]
rows_main, rows_cls, rows_cfg = [], {}, []
for name in order:
    j = json.load(open(RUNS / f"{name}.json", encoding="utf-8"))
    model = lgb.Booster(model_file=str(RUNS / f"{name}_model.txt"))
    proba = model.predict(Xva)
    s = 1 - proba[:, 0]
    prec, rec, thr = precision_recall_curve(ybin, s)
    f1 = 2 * prec * rec / (prec + rec + 1e-12)
    i = int(f1.argmax())
    p = j["params"]
    met = {"run": name, "PR-AUC": average_precision_score(ybin, s),
           "max-F1": f1[i] * 100, "F1-P": prec[i] * 100, "F1-R": rec[i] * 100}
    per = {}
    for t in (0.5, 0.7, 0.9):
        idx = np.where(rec[:-1] >= t)[0]
        k = int(idx[-1]) if len(idx) else 0
        th = thr[k]
        met[f"P@R{t}"] = prec[k] * 100
        met[f"alarm@R{t}"] = int((s >= th).sum())
        hit = s >= th
        per[t] = [float(hit[yva == c].mean()) * 100 if (yva == c).sum() else float("nan")
                  for c in range(10)]
        if t == 0.7:
            det = set(ava[(hit) & (ava >= 0)])
            met["attempt@R0.7"] = len(det) / n_attempt * 100
    met["iter"] = j["metrics"]["best_iteration"]
    met["train_s"] = j.get("train_seconds", float("nan"))
    rows_main.append(met)
    rows_cls[name] = per
    rows_cfg.append({"run": name, "baseline": j.get("baseline", "-"),
                     "단일 변인": j["single_variable"] if "single_variable" in j else "(기준선)",
                     "lambda_l2": p.get("lambda_l2", 0), "라운드 상한": j["num_boost_round"],
                     "class_weight": j.get("class_weight", "none"),
                     "ES 지표": j.get("early_stopping_metric", "multi_logloss"),
                     "threads": p.get("num_threads"), "상태": j.get("status", "?")})

pd.set_option("display.width", 250)
print("\n## A. 설정")
print(pd.DataFrame(rows_cfg).to_markdown(index=False))
print("\n## B. 종합 지표")
mn = pd.DataFrame(rows_main)
for c in mn.columns:
    if mn[c].dtype == float:
        mn[c] = mn[c].round(4 if c == "PR-AUC" else 2)
print(mn.to_markdown(index=False))
print("\n## C. 클래스별 recall (%) — 전체 recall 고정점별")
for t in (0.5, 0.7, 0.9):
    print(f"\n### 전체 recall {t}")
    tbl = pd.DataFrame({r: rows_cls[r][t] for r in order}, index=CLS).T.round(1)
    print(tbl.to_markdown())
print("\n## D. val 클래스 분포")
cnt = pd.Series(yva).value_counts().sort_index()
dist = pd.DataFrame({"클래스": CLS, "건수": cnt.values,
                     "비율(%)": (cnt.values / len(yva) * 100).round(4)})
print(dist.to_markdown(index=False))
