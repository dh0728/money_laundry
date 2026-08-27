"""전 실험 모델을 val 로 재평가해 종합/클래스별 지표를 md 표로 출력.

사용법: python summarize_runs.py <WS루트> [confusion 상세 run=run_007c]
data_work/runs/ 의 run_*_model.txt 전부를 대상으로 한다. 표준출력만 —
runs/metrics_summary.md 갱신은 출력을 검토해 수동으로 반영한다.
D 절: argmax 10클래스 분류 채점. 분류 recall 은 전 run, 전체 confusion matrix 는
두 번째 인자의 run 하나만 출력한다. val 클래스 건수는 C·D-1 표 끝 줄에 붙는다.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve

WS = Path(sys.argv[1])
CM_RUN = sys.argv[2] if len(sys.argv) > 2 else "run_007c"
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
_g = pd.Series(df.ts.to_numpy()).groupby(aid)
_first = _g.min()
STRAD_ATT = set(_first[(_first.index >= 0) & (_first.to_numpy() < np.datetime64("2022-09-07"))].index)
Xva, yva, ava = X[va], y[va], aid[va]
del df, gf, lab, acc, X
ybin = (yva > 0).astype(int)
ypat = (yva >= 1) & (yva <= 8)
STRAD = ypat & np.isin(ava, list(STRAD_ATT))
CONT = ypat & ~np.isin(ava, list(STRAD_ATT))
cls_cnt = np.bincount(yva, minlength=10)
CNT_ROW = "| (건수) | " + " | ".join(str(c) for c in np.bincount(yva, minlength=10)) + " |"
n_attempt = len(set(ava[ava >= 0]))
print(f"<!-- val={va.sum():,} 세탁={int(ybin.sum()):,} attempt={n_attempt} -->", flush=True)

order = [f.stem.replace("_model", "") for f in sorted(RUNS.glob("run_*_model.txt"))]
rows_main, rows_cls, rows_cfg, cms, rows_ovr = [], {}, [], {}, {}
for name in order:
    j = json.load(open(RUNS / f"{name}.json", encoding="utf-8"))
    model = lgb.Booster(model_file=str(RUNS / f"{name}_model.txt"))
    proba = model.predict(Xva)
    if proba.shape[1] != 10:
        print(f"<!-- {name}: 10클래스 아님(shape {proba.shape[1]}) — 건너뜀 -->")
        continue
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
            met["탐지@R0.7걸침"] = float(hit[STRAD].mean()) * 100
            met["탐지@R0.7포함"] = float(hit[CONT].mean()) * 100
    spat = np.sort(s[ypat])[::-1]
    th_p = spat[int(np.ceil(0.9 * ypat.sum())) - 1]
    hit_p = s >= th_p
    met["P@패턴R0.9"] = float((hit_p & (ybin == 1)).sum() / hit_p.sum()) * 100
    met["alarm@패턴R0.9"] = int(hit_p.sum())
    # 포함(신규 수법) 닻 + 패턴점수(Σp패턴) — 일반화 성능의 정직한 패턴 큐 지표
    s_pat9 = proba[:, 1:9].sum(axis=1)
    sc = np.sort(s_pat9[CONT])[::-1]
    th_c = sc[int(np.ceil(0.9 * CONT.sum())) - 1]
    hit_c = s_pat9 >= th_c
    met["P@포함패턴R0.9"] = float((hit_c & (ybin == 1)).sum() / hit_c.sum()) * 100
    met["alarm@포함패턴R0.9"] = int(hit_c.sum())
    rows_ovr[name] = [average_precision_score((yva == c).astype(int), proba[:, c]) * 100
                      for c in range(1, 10)]
    pred = proba.argmax(axis=1)
    cms[name] = np.bincount(yva * 10 + pred, minlength=100).reshape(10, 10)
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

# 건너뛴 run(10클래스 아님)은 이후 표 순회에서 제외
order = [r for r in order if r in rows_cls]
pd.set_option("display.width", 250)
print("\n## A. 설정")
print(pd.DataFrame(rows_cfg).to_markdown(index=False))
print("\n## B. 종합 지표")
mn = pd.DataFrame(rows_main)
for c in mn.columns:
    if mn[c].dtype == float:
        mn[c] = mn[c].round(4 if c == "PR-AUC" else 2)
print(mn.to_markdown(index=False))
print("\n## C. 클래스별 탐지율 (%) — 전체 recall 고정점별")
for t in (0.5, 0.7, 0.9):
    print(f"\n### 전체 recall {t}")
    tbl = pd.DataFrame({r: rows_cls[r][t] for r in order}, index=CLS).T.round(1)
    md = tbl.to_markdown().split(chr(10))
    print(chr(10).join(md[:2] + [CNT_ROW] + md[2:]))
print()
print("## D. 10클래스 분류 (argmax 채점)")
print()
print("### D-1. 클래스별 분류 recall (%) — 대각선/행합. C 표와 달리 패턴까지 맞혀야 정답")
diag = pd.DataFrame({r: cms[r].diagonal() / cms[r].sum(axis=1) * 100 for r in order},
                    index=CLS).T.round(1)
md = diag.to_markdown().split(chr(10))
print(chr(10).join(md[:2] + [CNT_ROW] + md[2:]))
if CM_RUN in cms:
    cm = cms[CM_RUN]
    print()
    print(f"### D-2. confusion matrix — {CM_RUN} (행=정답, 열=예측, 건수)")
    print(pd.DataFrame(cm, index=CLS, columns=CLS).to_markdown())
    print()
    print(f"### D-3. confusion matrix — {CM_RUN} (행 내 비율 %)")
    print(pd.DataFrame(cm / cm.sum(axis=1, keepdims=True) * 100,
                       index=CLS, columns=CLS).round(1).to_markdown())

print()
print("### D-4. 클래스별 one-vs-rest PR-AUC (x100) — p_k 로 그 클래스만 골라내는 순위 능력, threshold 무관")
ovr = pd.DataFrame({r: rows_ovr[r] for r in order}, index=CLS[1:]).T.round(1)
md = ovr.to_markdown().split(chr(10))
cnt9 = "| (건수) | " + " | ".join(str(c) for c in np.bincount(yva, minlength=10)[1:]) + " |"
print(chr(10).join(md[:2] + [cnt9] + md[2:]))

