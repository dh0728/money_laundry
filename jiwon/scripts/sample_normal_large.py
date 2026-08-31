"""HI-Large train NORMAL 다운샘플 표본 생성 (run_101+ 공통 / run_102~105 사다리).

사용법: python sample_normal_large.py <WS루트> [--method rus|cssmc|kproto]
        [--ratio 100] [--seed 42] [--k 15] [--alloc prop|equal] [--cands 3]

train 창(tmin < 2022-09-24)의 NORMAL 행에서 NORMAL:세탁 = ratio:1 표본을 뽑아
orig_row(int64) 배열로 저장. 세탁 행은 학습 시 항상 전량 사용. val/test 불변 (§6).

- rus:    비례 베르누이 (일자별 기대 비례)
- cssmc:  MiniBatchKMeans(표준화 그래프 52) 군집 → 층화추출(alloc: prop=비례,
          equal=군집당 동수) → 후보 cands개 중 KLD(52피처 50-bin 히스토그램,
          모집단 대비) 최소 subset 채택. 군집 적합은 5% 부표본.
- kproto: cssmc 와 동일하되 군집 공간에 범주형 one-hot 추가
          (fmt 7 + from/to entity 6×2 = +19차원). kmodes 미설치로 one-hot 근사.

출력: data_work/HI-Large/samples/normal_<method이름>.npy + 동명 .report.txt
"""
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
METHOD = arg("--method", "rus")
RATIO = int(arg("--ratio", "100"))
SEED = int(arg("--seed", "42"))
K = int(arg("--k", "15"))
ALLOC = arg("--alloc", "prop")
CANDS = int(arg("--cands", "3"))

DIR = WS / "data_work" / "HI-Large"
OUT = DIR / "samples"
OUT.mkdir(exist_ok=True)
B_VAL = int(datetime(2022, 9, 24, tzinfo=timezone.utc).timestamp() // 60)
BATCH = 2_000_000
FIT_FRAC = 0.05
NBIN = 50

GRAPH_COLS = []
for r in ("u", "v"):
    GRAPH_COLS += [f"{r}_{c}" for c in ("sent_cnt", "recv_cnt", "sent_usd_log", "recv_usd_log",
                                        "out_deg", "in_deg", "age_min", "since_last_min", "flow_ratio")]
    for w in ("24h", "72h"):
        GRAPH_COLS += [f"{r}_{c}_{w}" for c in ("sent_cnt", "recv_cnt", "out_deg", "in_deg",
                                                "sent_usd_log", "recv_usd_log", "burst")]
GRAPH_COLS += ["edge_cnt", "edge_rev_cnt", "edge_rev_cnt_72h", "cycle3_flag_72h",
               "pass_speed_24h", "amt_vs_hist"]

if METHOD == "rus":
    NAME = f"normal_rus{RATIO}_seed{SEED}"
else:
    NAME = f"normal_{METHOD}{RATIO}_k{K}_{ALLOC}_seed{SEED}"
report = []
def rep(m):
    print(m, flush=True)
    report.append(m)

# ---- 공통: train 창 카운트 ----
t0 = time.time()
pf_t = pq.ParquetFile(DIR / "trans_sorted.parquet")
n_normal = n_laund = 0
for b in pf_t.iter_batches(batch_size=10_000_000, columns=["tmin", "label"]):
    t = b.column("tmin").to_numpy()
    lab = b.column("label").to_numpy()
    m = t < B_VAL
    n_laund += int((lab[m] > 0).sum())
    n_normal += int((lab[m] == 0).sum())
TARGET = RATIO * n_laund
rep(f"train 창: NORMAL {n_normal:,} / 세탁 {n_laund:,} -> 목표 {TARGET:,} [{time.time()-t0:.0f}s]")

def save(sample_rows):
    sample_rows = np.sort(sample_rows)
    np.save(OUT / f"{NAME}.npy", sample_rows)
    rep(f"추출 {len(sample_rows):,}행 (목표 대비 {len(sample_rows)/TARGET*100:.2f}%)")
    rep(f"저장: {OUT / NAME}.npy")
    (OUT / f"{NAME}.report.txt").write_text("\n".join(report), encoding="utf-8")

# ================ RUS ================
if METHOD == "rus":
    rate = TARGET / n_normal
    rng = np.random.default_rng(SEED)
    picks = []
    for b in pf_t.iter_batches(batch_size=10_000_000, columns=["tmin", "label", "orig_row"]):
        t = b.column("tmin").to_numpy()
        lab = b.column("label").to_numpy()
        m = (t < B_VAL) & (lab == 0)
        sel = m & (rng.random(len(t)) < rate)
        picks.append(b.column("orig_row").to_numpy()[sel])
    save(np.concatenate(picks))
    sys.exit(0)

# ================ cssmc / kproto ================
from sklearn.cluster import MiniBatchKMeans

def rebatch(path, cols):
    buf, n_buf = [], 0
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

T_COLS = ["tmin", "label", "orig_row"] + (["fmt_id", "u_id", "v_id"] if METHOD == "kproto" else [])
def aligned():
    for tf, tt in zip(rebatch(DIR / "features_v1.parquet", GRAPH_COLS + ["orig_row"]),
                      rebatch(DIR / "trans_sorted.parquet", T_COLS)):
        assert tf.num_rows == tt.num_rows
        yield tf, tt

NFMT = sum(1 for _ in open(DIR / "fmt_vocab.txt"))
if METHOD == "kproto":
    acct_keys = [l.rstrip("\n") for l in open(DIR / "acct_vocab.txt")]
    acc = pd.read_csv(WS / "data" / "HI-Large_accounts.csv", dtype=str)
    et_map = dict(zip(acc["Bank ID"].str.lstrip("0").fillna("") + "|" + acc["Account Number"],
                      acc["Entity Name"].str.rsplit(" #", n=1).str[0]))
    ET_NAMES = sorted(set(et_map.values()))
    NET = len(ET_NAMES)
    et_idx = {n: i for i, n in enumerate(ET_NAMES)}
    ent_of = np.array([et_idx[et_map[k.split("|", 1)[0].lstrip("0") + "|" + k.split("|", 1)[1]]]
                       for k in acct_keys], dtype=np.int8)
    NDIM = 52 + NFMT + 2 * NET
else:
    NDIM = 52

def feat_block(tf, tt, sel):
    """선택 행의 군집 입력 (표준화 전, float32)."""
    n = int(sel.sum())
    X = np.zeros((n, NDIM), np.float32)
    for j, c in enumerate(GRAPH_COLS):
        X[:, j] = tf.column(c).to_numpy()[sel]
    if METHOD == "kproto":
        r = np.arange(n)
        X[r, 52 + tt.column("fmt_id").to_numpy()[sel]] = 1.0
        X[r, 52 + NFMT + ent_of[tt.column("u_id").to_numpy()[sel]]] = 1.0
        X[r, 52 + NFMT + NET + ent_of[tt.column("v_id").to_numpy()[sel]]] = 1.0
    return X

# ---- 1) 통계 + 적합용 부표본 ----
t0 = time.time()
rng_fit = np.random.default_rng(SEED + 1000)
s1 = np.zeros(NDIM, np.float64)
s2 = np.zeros(NDIM, np.float64)
n_pop = 0
fit_parts = []
for tf, tt in aligned():
    t = tt.column("tmin").to_numpy()
    lab = tt.column("label").to_numpy()
    m = (t < B_VAL) & (lab == 0)
    if not m.any():  # val/test 구간 배치
        continue
    X = feat_block(tf, tt, m)
    s1 += X.sum(axis=0, dtype=np.float64)
    s2 += (X ** 2).sum(axis=0, dtype=np.float64)
    n_pop += len(X)
    sub = rng_fit.random(len(X)) < FIT_FRAC
    fit_parts.append(X[sub])
mean = (s1 / n_pop).astype(np.float32)
std = np.sqrt(np.maximum(s2 / n_pop - (s1 / n_pop) ** 2, 1e-12)).astype(np.float32)
Xfit = (np.concatenate(fit_parts) - mean) / std
del fit_parts
rep(f"통계+부표본: 모집단 {n_pop:,}, 적합 표본 {len(Xfit):,} [{time.time()-t0:.0f}s]")

# ---- 2) 군집 적합 + 부표본 기반 군집 크기 추정 ----
t0 = time.time()
km = MiniBatchKMeans(n_clusters=K, random_state=SEED, batch_size=262_144, n_init=3)
lab_fit = km.fit_predict(Xfit)
n_c_est = np.bincount(lab_fit, minlength=K) / len(Xfit) * n_pop
del Xfit, lab_fit
if ALLOC == "prop":
    rates = np.full(K, TARGET / n_pop)
else:  # equal: 군집당 동수
    rates = np.minimum((TARGET / K) / np.maximum(n_c_est, 1), 1.0)
rep(f"군집 적합 k={K} [{time.time()-t0:.0f}s], 추정 군집 크기: " +
    " ".join(f"{int(v)/1e6:.1f}M" for v in n_c_est))
rep(f"할당({ALLOC}) rate: " + " ".join(f"{r:.4f}" for r in rates))

# ---- 3) 배정 + 후보 추출 + 히스토그램 ----
t0 = time.time()
BINS = np.linspace(-5, 5, NBIN + 1)
pop_hist = np.zeros((NDIM, NBIN), np.int64)
cand_hist = np.zeros((CANDS, NDIM, NBIN), np.int64)
cand_rows = [[] for _ in range(CANDS)]
rng_c = [np.random.default_rng(SEED + 10 + c) for c in range(CANDS)]
n_c_real = np.zeros(K, np.int64)
def add_hist(H, Xz):
    for j in range(NDIM):  # 열 단위 — 전행렬 digitize 의 int64 임시본 회피
        q = np.clip(np.digitize(Xz[:, j], BINS) - 1, 0, NBIN - 1)
        H[j] += np.bincount(q, minlength=NBIN)
for tf, tt in aligned():
    t = tt.column("tmin").to_numpy()
    lab = tt.column("label").to_numpy()
    m = (t < B_VAL) & (lab == 0)
    if not m.any():  # val/test 구간 배치
        continue
    X = feat_block(tf, tt, m)
    Xz = (X - mean) / std
    cl = km.predict(Xz)
    n_c_real += np.bincount(cl, minlength=K)
    add_hist(pop_hist, Xz)
    orig = tt.column("orig_row").to_numpy()[m]
    r_cl = rates[cl]
    for c in range(CANDS):
        sel = rng_c[c].random(len(cl)) < r_cl
        cand_rows[c].append(orig[sel])
        add_hist(cand_hist[c], Xz[sel])
rep(f"배정+추출 [{time.time()-t0:.0f}s], 실측 군집 크기: " +
    " ".join(f"{v/1e6:.1f}M" for v in n_c_real))

# ---- 4) KLD 최소 후보 선택 ----
def kld(P, Q):  # sum_j KL(P_j || Q_j), 라플라스 평활
    p = (P + 1) / (P + 1).sum(axis=1, keepdims=True)
    q = (Q + 1) / (Q + 1).sum(axis=1, keepdims=True)
    return float((p * np.log(p / q)).sum())
scores = [kld(cand_hist[c], pop_hist) for c in range(CANDS)]
best = int(np.argmin(scores))
rep("후보 KLD: " + " ".join(f"{v:.5f}" for v in scores) + f" -> 후보 {best} 채택")
save(np.concatenate(cand_rows[best]))
