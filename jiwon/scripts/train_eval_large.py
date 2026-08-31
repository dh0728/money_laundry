"""HI-Large 학습+평가 (run_101+): run_011b 설정 승계, run_ladder.py 지표 계약 이식.

사용법: python train_eval_large.py <WS루트> <run_id> [--sample normal_rus100_seed42]
        [--smoke]

- train = 세탁 전량 + 표본 파일의 NORMAL (orig_row). val/test 원본 유지.
- Large 적응(계약): 조기종료 val = val 창 세탁 전량 + NORMAL RUS 100:1(시드 43)
  부표본(multi_logloss). 최종 지표는 val 전량 청크 predict.
- --smoke: 배관 검증용 — train 1/20, 라운드 30, 최종 평가도 ES 부표본으로.
- 기록: data_work/runs/<run_id>.json + 모델. 층화(노출/미노출)·미노출 닻·Σp_패턴·
  OVR·포화 진단 정의는 run_ladder.py 와 동일.
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import psutil
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.metrics import average_precision_score, precision_recall_curve

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
RUN_ID = sys.argv[2] if len(sys.argv) > 2 else "run_101"
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
SAMPLE = arg("--sample", "normal_rus100_seed42")
RATIO_LABEL = arg("--ratio", "100") + ":1"
L2 = float(arg("--l2", "100"))
BINARY = int(arg("--binary", "-1"))  # 1~9: 해당 클래스 전용 이진 (OvR 프로브)
DROP_NONPAT = "--drop-nonpat" in sys.argv  # 개입: train 에서 label 9 행 제거 (val/test 불변)
NINE = "--nine" in sys.argv  # 9클래스: NONPAT(9)→패턴아님(0) 병합 (2026-08-30 팀 확정 구조)
SMOKE = "--smoke" in sys.argv

DIR = WS / "data_work" / "HI-Large"
RUNS = WS / "data_work" / "runs"
RUNS.mkdir(exist_ok=True)
def epmin(y, mo, d):
    return int(datetime(y, mo, d, tzinfo=timezone.utc).timestamp() // 60)
B_VAL, B_TEST = epmin(2022, 9, 24), epmin(2022, 10, 15)
ES_SEED, ES_RATIO = 43, 100
BATCH = 2_000_000
proc = psutil.Process()

PARAMS = {"objective": "multiclass", "num_class": 10, "learning_rate": 0.1,
          "num_leaves": 31, "min_data_in_leaf": 20, "feature_fraction": 1.0,
          "bagging_fraction": 1.0, "max_bin": 255, "seed": 42,
          "num_threads": 12, "verbosity": -1,
          "lambda_l2": L2, "min_sum_hessian_in_leaf": 1.0}
if NINE:
    PARAMS["num_class"] = 9
if BINARY > 0:
    del PARAMS["num_class"]
    PARAMS["objective"] = "binary"
    SPW = float(arg("--spw", "0"))  # 이진 가중 변형 (0 = 미사용)
    if SPW > 0:
        PARAMS["scale_pos_weight"] = SPW
NUM_ROUND, ES = (30, 10) if SMOKE else (1000, 30)
CLS9 = ["FAN-OUT", "FAN-IN", "G-SCATTER", "S-GATHER", "CYCLE",
        "RANDOM", "BIPARTITE", "STACK", "NONPAT"]

GRAPH_COLS = []
for r in ("u", "v"):
    GRAPH_COLS += [f"{r}_{c}" for c in ("sent_cnt", "recv_cnt", "sent_usd_log", "recv_usd_log",
                                        "out_deg", "in_deg", "age_min", "since_last_min", "flow_ratio")]
    for w in ("24h", "72h"):
        GRAPH_COLS += [f"{r}_{c}_{w}" for c in ("sent_cnt", "recv_cnt", "out_deg", "in_deg",
                                                "sent_usd_log", "recv_usd_log", "burst")]
GRAPH_COLS += ["edge_cnt", "edge_rev_cnt", "edge_rev_cnt_72h", "cycle3_flag_72h",
               "pass_speed_24h", "amt_vs_hist"]
FV = arg("--fv", "1")  # 피처 버전: 1(52개) | 2(75개, features_v2.md)
if FV == "2":
    for r in ("u", "v"):
        GRAPH_COLS += [f"{r}_{c}" for c in ("dk7_sent_cnt", "dk7_recv_cnt", "dk7_sent_usd_log",
                                            "dk7_recv_usd_log", "dk7_flow_ratio", "dk30_new_in",
                                            "dk30_new_out", "once_in_ratio", "once_out_ratio")]
    GRAPH_COLS += ["relay_amt_logratio", "relay_gap_min", "backfill_amt_logratio",
                   "backfill_gap_min", "cycle3_flag_30d"]
NG = len(GRAPH_COLS)
FEAT_PATH_NAME = f"features_v{FV}.parquet"
CATS = ["payment_format", "payment_currency", "receiving_currency",
        "from_entity_type", "to_entity_type"]

# ---- vocab · 계좌 유형 ----
cur_names = [l.rstrip("\n") for l in open(DIR / "cur_vocab.txt")]
fmt_names = [l.rstrip("\n") for l in open(DIR / "fmt_vocab.txt")]
acct_keys = [l.rstrip("\n") for l in open(DIR / "acct_vocab.txt")]
NA = len(acct_keys)
acc = pd.read_csv(WS / "data" / "HI-Large_accounts.csv", dtype=str)
et_map = dict(zip(acc["Bank ID"].str.lstrip("0").fillna("") + "|" + acc["Account Number"],
                  acc["Entity Name"].str.rsplit(" #", n=1).str[0]))
ET_NAMES = sorted(set(et_map.values()))
et_idx = {n: i for i, n in enumerate(ET_NAMES)}
ent_of = np.empty(NA, dtype=np.int8)
n_miss = 0
for i, k in enumerate(acct_keys):
    bank, acct_no = k.split("|", 1)
    e = et_map.get(bank.lstrip("0") + "|" + acct_no)
    if e is None:
        n_miss += 1
        ent_of[i] = -1
    else:
        ent_of[i] = et_idx[e]
assert n_miss == 0, f"entity 매칭 실패 {n_miss}계좌"
print(f"accounts {NA:,}, entity types {ET_NAMES}", flush=True)

# ---- attempt span (층화용) ----
att_first = {}
pf_t = pq.ParquetFile(DIR / "trans_sorted.parquet")
for b in pf_t.iter_batches(batch_size=10_000_000, columns=["tmin", "attempt_id"]):
    a = b.column("attempt_id").to_numpy()
    t = b.column("tmin").to_numpy()
    m = a >= 0
    for aid, tm in zip(a[m].tolist(), t[m].tolist()):
        if aid not in att_first or tm < att_first[aid]:
            att_first[aid] = tm
STRAD_ATT = np.array(sorted(k for k, v in att_first.items() if v < B_VAL))
print(f"attempts {len(att_first):,}, 노출(시작<val) {len(STRAD_ATT):,}", flush=True)

# ---- 정렬 스트림 (features ↔ trans 행 정합 재배치) ----
def aligned_stream(columns_f, columns_t):
    """두 parquet 을 같은 크기 배치로 재배치해 (features, trans) 쌍으로 낸다."""
    def rebatch(path, cols):
        buf = []
        n_buf = 0
        for b in pq.ParquetFile(path).iter_batches(batch_size=BATCH, columns=cols):
            buf.append(b)
            n_buf += b.num_rows
            while n_buf >= BATCH:
                t = pa.Table.from_batches(buf)
                yield t.slice(0, BATCH)
                t = t.slice(BATCH)
                buf = t.to_batches()
                n_buf = t.num_rows
        if n_buf:
            yield pa.Table.from_batches(buf)
    gf = rebatch(DIR / FEAT_PATH_NAME, columns_f)
    gt = rebatch(DIR / "trans_sorted.parquet", columns_t)
    for tf, tt in zip(gf, gt):
        assert tf.num_rows == tt.num_rows
        yield tf, tt

T_COLS = ["tmin", "u_id", "v_id", "usd_paid", "fmt_id", "cur_paid_id", "cur_recv_id",
          "amount_mismatch", "same_bank", "label", "orig_row"]
F_COLS = ["orig_row"] + GRAPH_COLS

EXTRA_SPECS = [("fmt_code", np.int8), ("log_amount_usd", np.float32),
               ("amount_mismatch", np.int8), ("cur_p_code", np.int8),
               ("cur_r_code", np.int8), ("same_bank", np.int8),
               ("self_account", np.int8), ("ent_u_code", np.int8), ("ent_v_code", np.int8)]

def extract(tf, tt, sel):
    """선택 행의 피처 원료 (numpy dict)."""
    n = int(sel.sum())
    if n == 0:
        return None
    g = np.empty((n, NG), np.float32)
    for j, c in enumerate(GRAPH_COLS):
        g[:, j] = tf.column(c).to_numpy()[sel]
    u = tt.column("u_id").to_numpy()[sel]
    v = tt.column("v_id").to_numpy()[sel]
    return {"graph": g,
            "fmt_code": tt.column("fmt_id").to_numpy()[sel],
            "log_amount_usd": np.log1p(tt.column("usd_paid").to_numpy()[sel]).astype(np.float32),
            "amount_mismatch": tt.column("amount_mismatch").to_numpy()[sel],
            "cur_p_code": tt.column("cur_paid_id").to_numpy()[sel],
            "cur_r_code": tt.column("cur_recv_id").to_numpy()[sel],
            "same_bank": tt.column("same_bank").to_numpy()[sel],
            "self_account": (u == v).astype(np.int8),
            "ent_u_code": ent_of[u], "ent_v_code": ent_of[v]}

def to_frame(d):
    X = pd.DataFrame(d["graph"], columns=GRAPH_COLS, copy=False)
    X["payment_format"] = pd.Categorical.from_codes(d["fmt_code"], categories=fmt_names)
    X["log_amount_usd"] = d["log_amount_usd"]
    X["amount_mismatch"] = d["amount_mismatch"]
    X["payment_currency"] = pd.Categorical.from_codes(d["cur_p_code"], categories=cur_names)
    X["receiving_currency"] = pd.Categorical.from_codes(d["cur_r_code"], categories=cur_names)
    X["same_bank"] = d["same_bank"]
    X["self_account"] = d["self_account"]
    X["from_entity_type"] = pd.Categorical.from_codes(d["ent_u_code"], categories=ET_NAMES)
    X["to_entity_type"] = pd.Categorical.from_codes(d["ent_v_code"], categories=ET_NAMES)
    return X

def assemble(tf, tt, sel):
    d = extract(tf, tt, sel)
    return None if d is None else to_frame(d)

# ---- train + ES val 조립 ----
sample = np.load(DIR / "samples" / f"{SAMPLE}.npy")
rng_es = np.random.default_rng(ES_SEED)
ES_RATE = ES_RATIO * 49_950 / 39_124_372  # val 실측 (phase2 기록)

def train_sel(t, lab, orig):
    idx = np.searchsorted(sample, orig)
    idx[idx >= len(sample)] = len(sample) - 1
    laund = (lab > 0) & (lab != 9) if DROP_NONPAT else (lab > 0)
    sel = (t < B_VAL) & (laund | (sample[idx] == orig))
    if SMOKE:
        sel &= (orig % 20) == 0
    return sel

# 사전 카운트 → train 행렬 예할당 (concat 이중 복사 회피)
t0 = time.time()
n_tr = 0
for b in pq.ParquetFile(DIR / "trans_sorted.parquet").iter_batches(
        batch_size=10_000_000, columns=["tmin", "label", "orig_row"]):
    n_tr += int(train_sel(b.column("tmin").to_numpy(), b.column("label").to_numpy(),
                          b.column("orig_row").to_numpy()).sum())
tr_d = {"graph": np.empty((n_tr, NG), np.float32),
        **{k: np.empty(n_tr, dt) for k, dt in EXTRA_SPECS}}
ytr = np.empty(n_tr, np.int8)
print(f"train 예할당 {n_tr:,}행 [{time.time()-t0:.0f}s]", flush=True)

t0 = time.time()
pos = 0
es_parts, yes_parts = [], []
for tf, tt in aligned_stream(F_COLS, T_COLS):
    assert np.array_equal(tf.column("orig_row").to_numpy(), tt.column("orig_row").to_numpy())
    t = tt.column("tmin").to_numpy()
    lab = tt.column("label").to_numpy()
    orig = tt.column("orig_row").to_numpy()
    sel = train_sel(t, lab, orig)
    d = extract(tf, tt, sel)
    if d is not None:
        n = len(d["graph"])
        tr_d["graph"][pos:pos + n] = d["graph"]
        for k, _ in EXTRA_SPECS:
            tr_d[k][pos:pos + n] = d[k]
        ytr[pos:pos + n] = lab[sel]
        pos += n
    sel_es = (t >= B_VAL) & (t < B_TEST) & ((lab > 0) | (rng_es.random(len(t)) < ES_RATE))
    Xp = assemble(tf, tt, sel_es)
    if Xp is not None:
        es_parts.append(Xp)
        yes_parts.append(lab[sel_es])
assert pos == n_tr
Xtr = to_frame(tr_d)
Xes = pd.concat(es_parts, ignore_index=True); yes = np.concatenate(yes_parts)
del es_parts, tr_d
print(f"train {len(Xtr):,} (세탁 {(ytr>0).sum():,}) / ES-val {len(Xes):,} "
      f"[{time.time()-t0:.0f}s, RSS {proc.memory_info().rss/2**30:.1f}GB]", flush=True)

# ---- 학습 ----
t0 = time.time()
def fit_labels(y):
    if BINARY > 0:
        return (y == BINARY).astype(np.int8)
    if NINE:
        z = y.copy()
        z[z == 9] = 0
        return z
    return y
ytr_fit = fit_labels(ytr)
yes_fit = fit_labels(yes)
dtr = lgb.Dataset(Xtr, label=ytr_fit, categorical_feature=CATS)
des = lgb.Dataset(Xes, label=yes_fit, reference=dtr)
model = lgb.train(PARAMS, dtr, num_boost_round=NUM_ROUND, valid_sets=[des],
                  valid_names=["es_val"],
                  callbacks=[lgb.early_stopping(ES, verbose=False), lgb.log_evaluation(50)])
train_secs = time.time() - t0
imp = pd.Series(model.feature_importance("gain"), index=Xtr.columns).sort_values(ascending=False)
del dtr, des, Xtr
print(f"학습 {train_secs:.0f}s, best_iter {model.best_iteration}, "
      f"RSS {proc.memory_info().rss/2**30:.1f}GB", flush=True)

# ---- val 전량 청크 predict (--smoke 는 ES 부표본으로 대체) ----
t0 = time.time()
if SMOKE:
    proba = model.predict(Xes, num_iteration=model.best_iteration).astype(np.float32)
    yva = yes
    ava = np.full(len(yva), -1, np.int32)  # smoke 에선 층화 생략
else:
    pr_parts, y_parts, a_parts = [], [], []
    for tf, tt in aligned_stream(F_COLS, T_COLS + ["attempt_id"]):
        t = tt.column("tmin").to_numpy()
        sel = (t >= B_VAL) & (t < B_TEST)
        Xp = assemble(tf, tt, sel)
        if Xp is None:
            continue
        pr_parts.append(model.predict(Xp, num_iteration=model.best_iteration).astype(np.float32))
        y_parts.append(tt.column("label").to_numpy()[sel])
        a_parts.append(tt.column("attempt_id").to_numpy()[sel])
    proba = np.concatenate(pr_parts); yva = np.concatenate(y_parts); ava = np.concatenate(a_parts)
    del pr_parts
print(f"predict {len(yva):,}행 [{time.time()-t0:.0f}s]", flush=True)

# ---- 이진 프로브 (OvR): 클래스 닻 지표만 계산하고 종료 ----
if BINARY > 0:
    p = proba.astype(np.float64)
    ybink = (yva == BINARY).astype(np.int8)
    prec, rec, thr = precision_recall_curve(ybink, p)
    met = {"class": CLS9[BINARY - 1],
           "binary_pr_auc": float(average_precision_score(ybink, p)),
           "best_iteration": int(model.best_iteration),
           "n_val_class_rows": int(ybink.sum())}
    for tgt in (0.5, 0.7, 0.9):
        idx = np.where(rec[:-1] >= tgt)[0]
        j = int(idx[-1]) if len(idx) else 0
        met[f"class_precision_at_recall_{tgt}"] = float(prec[j])
    rec_json = {"run_id": RUN_ID, "baseline": "run_101 (파생 p_k)",
                "single_variable": f"전용 이진 OvR 프로브: {CLS9[BINARY - 1]}",
                "dataset": "HI-Large (08-01~11-05, 꼬리 제외)",
                "split": {"train": "08-01~09-23", "val": "09-24~10-14", "test": "10-15~11-05 미개봉"},
                "preprocessing": {"normal_downsample": SAMPLE, "ratio": RATIO_LABEL},
                "features": f"features_v{FV} ({NG}+9개)",
                "params": PARAMS, "num_boost_round": NUM_ROUND, "early_stopping_rounds": ES,
                "smoke": SMOKE, "train_seconds": round(train_secs, 1),
                "n_train": int(len(ytr)), "n_val_eval": int(len(yva)),
                "metrics": met, "status": "smoke" if SMOKE else "keep"}
    out = RUNS / (f"{RUN_ID}_smoke.json" if SMOKE else f"{RUN_ID}.json")
    json.dump(rec_json, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if not SMOKE:
        model.save_model(str(RUNS / f"{RUN_ID}_model.txt"), num_iteration=model.best_iteration)
    print(f"\n=== {RUN_ID}{' (SMOKE)' if SMOKE else ''} 이진 {CLS9[BINARY - 1]} ===")
    print(f"binary PR-AUC {met['binary_pr_auc']:.4f} | 클래스 P@R0.5 {met['class_precision_at_recall_0.5']*100:.2f}% "
          f"| P@R0.7 {met['class_precision_at_recall_0.7']*100:.2f}% | P@R0.9 {met['class_precision_at_recall_0.9']*100:.2f}%")
    print(f"기록: {out}")
    sys.exit(0)

# ---- 지표 (run_ladder.evaluate 이식) ----
s = 1.0 - proba[:, 0].astype(np.float64)
ybin = (yva > 0).astype(np.int8)
prec, rec, thr = precision_recall_curve(ybin, s)
f1 = 2 * prec * rec / (prec + rec + 1e-12)
i = int(f1.argmax())
met = {"val_pr_auc": float(average_precision_score(ybin, s)),
       "best_iteration": int(model.best_iteration),
       "max_f1": float(f1[i]), "max_f1_precision": float(prec[i]),
       "max_f1_recall": float(rec[i]),
       "n_alarms_at_max_f1": int((s >= thr[i]).sum()) if i < len(thr) else int(len(s))}
for tgt in (0.5, 0.7, 0.9):
    idx = np.where(rec[:-1] >= tgt)[0]
    j = int(idx[-1]) if len(idx) else 0
    met[f"precision_at_recall_{tgt}"] = float(prec[j])
    met[f"threshold_at_recall_{tgt}"] = float(thr[j])
pat = (yva >= 1) & (yva <= 8)
spat = np.sort(s[pat])[::-1]
th_p = spat[int(np.ceil(0.9 * pat.sum())) - 1]
hit_p = s >= th_p
met["precision_at_pattern_recall_0.9"] = float((hit_p & (yva > 0)).sum() / hit_p.sum())
met["n_alarms_at_pattern_recall_0.9"] = int(hit_p.sum())
met["threshold_at_pattern_recall_0.9"] = float(th_p)
STRAD = pat & np.isin(ava, STRAD_ATT)
CONT = pat & ~np.isin(ava, STRAD_ATT)
hit07 = s >= met["threshold_at_recall_0.7"]
if CONT.any() and STRAD.any():
    met["det_R0.7_straddle_pattern"] = float(hit07[STRAD].mean())
    met["det_R0.7_contained_pattern"] = float(hit07[CONT].mean())
    s_pat9 = proba[:, 1:9].sum(axis=1).astype(np.float64)
    sc = np.sort(s_pat9[CONT])[::-1]
    th_c = sc[int(np.ceil(0.9 * CONT.sum())) - 1]
    hit_c = s_pat9 >= th_c
    met["precision_at_contained_pattern_recall_0.9"] = float((hit_c & (yva > 0)).sum() / hit_c.sum())
    met["n_alarms_at_contained_pattern_recall_0.9"] = int(hit_c.sum())
    met["n_val_pattern_straddle"] = int(STRAD.sum())
    met["n_val_pattern_contained"] = int(CONT.sum())
met["ovr_pr_auc"] = {CLS9[k - 1]: float(average_precision_score(
    (yva == k).astype(np.int8), proba[:, k])) for k in range(1, 9 if NINE else 10)}
met["saturation"] = {
    "n_unique_scores": int(len(np.unique(np.round(s, 9)))),
    "frac_mid_range": float(((s > 1e-6) & (s < 0.99)).mean()),
    "n_laundering_in_mid": int(((s > 1e-6) & (s < 0.99) & (yva > 0)).sum()),
}
# 혼동행렬 (argmax, 행=정답 0~9, 열=예측 0~9)
pred = proba.argmax(axis=1)
met["confusion_matrix"] = np.bincount(
    yva.astype(np.int64) * 10 + pred, minlength=100).reshape(10, 10).tolist()

rec_json = {"run_id": RUN_ID,
            "baseline": "HI-Small run_011b (설정 승계)" if RUN_ID == "run_101" else "run_101",
            "label_scheme": "9class (NONPAT->패턴아님 병합)" if NINE else "10class",
            "single_variable": ("라벨 10->9클래스 (팀 확정 구조 전환)" if NINE else
                                "개입: train NONPAT(label 9) 행 제거" if DROP_NONPAT else
                                f"피처 v1 -> v{FV} ({NG + 9}개)" if FV != "1" else
                                f"lambda_l2 100 -> {L2:g}" if L2 != 100.0 else
                                f"전처리: {SAMPLE} ({RATIO_LABEL})" if SAMPLE != "normal_rus100_seed42" else
                                "데이터셋 HI-Small -> HI-Large (+ Large 공통 전처리 도입)"),
            "dataset": "HI-Large (08-01~11-05, 꼬리 제외)",
            "split": {"train": "08-01~09-23", "val": "09-24~10-14", "test": "10-15~11-05 미개봉"},
            "intervention": "train NONPAT(label 9) 제거" if DROP_NONPAT else "none",
            "preprocessing": {"normal_downsample": SAMPLE, "ratio": RATIO_LABEL,
                              "es_val": f"세탁 전량 + NORMAL RUS {ES_RATIO}:1 (seed {ES_SEED})"},
            "features": f"features_v{FV} ({NG}+9개)",
            "params": PARAMS, "num_boost_round": NUM_ROUND, "early_stopping_rounds": ES,
            "smoke": SMOKE, "train_seconds": round(train_secs, 1),
            "n_train": int(len(ytr)), "n_val_eval": int(len(yva)),
            "feature_importance_gain_top15": (imp.head(15) / imp.sum() * 100).round(2).to_dict(),
            "metrics": met, "status": "smoke" if SMOKE else "keep"}
out = RUNS / (f"{RUN_ID}_smoke.json" if SMOKE else f"{RUN_ID}.json")
json.dump(rec_json, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
if not SMOKE:
    model.save_model(str(RUNS / f"{RUN_ID}_model.txt"), num_iteration=model.best_iteration)

print(f"\n=== {RUN_ID}{' (SMOKE)' if SMOKE else ''} ===")
print(f"PR-AUC {met['val_pr_auc']:.4f} | max-F1 {met['max_f1']*100:.2f}% | "
      f"P@R0.7 {met['precision_at_recall_0.7']*100:.4f}% | P@R0.5 {met['precision_at_recall_0.5']*100:.2f}% | "
      f"P@R0.9 {met['precision_at_recall_0.9']*100:.4f}%")
print(f"P@패턴R0.9 {met['precision_at_pattern_recall_0.9']*100:.2f}%")
if "det_R0.7_straddle_pattern" in met:
    print(f"탐지@R0.7 노출 {met['det_R0.7_straddle_pattern']*100:.1f}% / 미노출 {met['det_R0.7_contained_pattern']*100:.1f}%"
          f"  (노출 {met['n_val_pattern_straddle']:,} / 미노출 {met['n_val_pattern_contained']:,}행)")
    print(f"P@미노출패턴R0.9(sum_p패턴) {met['precision_at_contained_pattern_recall_0.9']*100:.2f}%")
print("OVR: " + " ".join(f"{n} {v:.3f}" for n, v in met["ovr_pr_auc"].items()))
print(f"기록: {out}")
