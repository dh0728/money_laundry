"""HI-Large 피처 빌더 검증 — 표본 행 브루트포스 재계산 대조.

사용법: python verify_features_large.py <WS루트> [--dryrun] [--n 표본수]

trans_sorted.parquet 에서 표본 행의 52개 피처를 정의대로 직접 재계산해
features_v1.parquet 의 값과 비교한다. 이력 = 정렬 위치 기준 앞 행 전부
(t 미만 + 같은 분은 파일 순서 앞 행 — 빌더와 동일 규약).
표본: 무작위 + 세탁 행 + 자기거래 행. 허용 오차 rtol/atol 1e-4.
"""
import sys
from math import log, log1p
from pathlib import Path

import numpy as np
import pandas as pd

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
DIR = WS / "data_work" / ("HI-Large_dryrun" if "--dryrun" in sys.argv else "HI-Large")
N_SAMPLE = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 200
W24, W72 = 24 * 60, 72 * 60
CAP = 50
rng = np.random.default_rng(42)

tr = pd.read_parquet(DIR / "trans_sorted.parquet",
                     columns=["tmin", "u_id", "v_id", "usd_paid", "usd_recv",
                              "label", "orig_row"])
ft = pd.read_parquet(DIR / "features_v1.parquet")
assert (ft.orig_row.to_numpy() == tr.orig_row.to_numpy()).all(), "정렬 불일치"
n = len(tr)
T = tr.tmin.to_numpy(np.int64)
U = tr.u_id.to_numpy(np.int64)
V = tr.v_id.to_numpy(np.int64)
UP = tr.usd_paid.to_numpy()
UR = tr.usd_recv.to_numpy()

idx = set(rng.choice(n, min(N_SAMPLE, n), replace=False).tolist())
laund = np.where(tr.label.to_numpy() > 0)[0]
if len(laund):
    idx |= set(rng.choice(laund, min(40, len(laund)), replace=False).tolist())
selfr = np.where(U == V)[0]
if len(selfr):
    idx |= set(rng.choice(selfr, min(20, len(selfr)), replace=False).tolist())
idx = sorted(idx)
print(f"rows={n:,}  표본={len(idx)}")

def role(a, i, t):
    """계좌 a의 Tier1(9) + Tier2(14) — 이력 = 위치 [0, i)."""
    s_mask = U[:i] == a
    r_mask = V[:i] == a
    sc = int(s_mask.sum()); rc = int(r_mask.sum())
    su = UP[:i][s_mask].sum(); ru = UR[:i][r_mask].sum()
    out_deg = len(np.unique(V[:i][s_mask])); in_deg = len(np.unique(U[:i][r_mask]))
    act = T[:i][s_mask | r_mask]
    age = t - act.min() if len(act) else 0
    since = t - act.max() if len(act) else 0
    flow = log((su + 1) / (ru + 1))
    out = [sc, rc, log1p(su), log1p(ru), out_deg, in_deg, age, since, flow]
    tot1 = sc + rc + 1
    for hz in (W24, W72):
        sw = s_mask & (T[:i] > t - hz)
        rw = r_mask & (T[:i] > t - hz)
        out += [int(sw.sum()), int(rw.sum()),
                len(np.unique(V[:i][sw])), len(np.unique(U[:i][rw])),
                log1p(UP[:i][sw].sum()), log1p(UR[:i][rw].sum()),
                (int(sw.sum()) + int(rw.sum())) / tot1]
    return out, su, sc, UR[:i][r_mask & (T[:i] > t - W24)].sum()

bad = 0
cols = [c for c in ft.columns if c not in ("orig_row", "tmin", "label", "attempt_id")]
maxdiff = {}
for i in idx:
    u, v, t, up = int(U[i]), int(V[i]), int(T[i]), UP[i]
    role_u, su_u, sc_u, w24ru_u = role(u, i, t)
    role_v, _, _, _ = role(v, i, t)
    exp = role_u + role_v
    # Tier3
    e_uv = int(((U[:i] == u) & (V[:i] == v)).sum())
    e_vu = int(((U[:i] == v) & (V[:i] == u)).sum())
    sent_v = np.where(U[:i] == v)[0][-CAP:]          # v의 최근 송신 50건 (캡)
    rev72 = 0; cyc = 0.0
    for j in sent_v:
        if T[j] <= t - W72:
            continue
        cp = int(V[j])
        if cp == u:
            rev72 += 1
        elif cp != v and ((U[:i] == cp) & (V[:i] == u)).any():
            cyc = 1.0
    exp += [e_uv, e_vu, rev72, cyc,
            up / (w24ru_u + 1),
            up / ((su_u / sc_u + 1) if sc_u else 1)]
    got = ft.iloc[i][cols].to_numpy(np.float64)
    exp = np.array(exp, np.float64)
    ok = np.isclose(got, exp, rtol=1e-4, atol=1e-4)
    for k in np.where(~ok)[0]:
        bad += 1
        if abs(got[k] - exp[k]) > maxdiff.get(cols[k], (0,))[0]:
            maxdiff[cols[k]] = (abs(got[k] - exp[k]), i, exp[k], got[k])

if bad:
    print(f"불일치 {bad}건:")
    for c, (d, i, e, g) in sorted(maxdiff.items(), key=lambda x: -x[1][0]):
        print(f"  {c}: row {i} expected {e:.6g} got {g:.6g} (diff {d:.3g})")
    sys.exit(1)
print(f"OK: 표본 {len(idx)}행 x 52피처 전부 일치 (rtol/atol 1e-4)")
