"""검증 ①: 무작위 표본 행의 피처를 브루트포스로 재계산해 빌더 결과와 대조.

사용법: python3 verify_features.py <WS루트> [표본수=150]

브루트포스 기준: 시간 stable 정렬에서 자기보다 앞선 행 전체를 pandas/numpy
마스크로 집계 (빌더와 독립된 경로).
- edge_rev_cnt_72h / cycle3_flag_72h는 캡 50 때문에, v의 누적 송신이 50건
  이하인 표본에서만 대조한다 (그 경우 deque가 완전하므로 캡 무영향).
"""
import sys
from math import log, log1p
from pathlib import Path

import numpy as np
import pandas as pd

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
NS = int(sys.argv[2]) if len(sys.argv) > 2 else 150
W24, W72 = 24 * 60, 72 * 60
rng = np.random.default_rng(7)

df = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                 names=["ts", "from_bank", "from_acct", "to_bank", "to_acct",
                        "amt_recv", "cur_recv", "amt_paid", "cur_paid", "fmt", "flag"],
                 header=0, dtype={"from_bank": str, "to_bank": str,
                                  "from_acct": str, "to_acct": str})
df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
df = df[df.ts < pd.Timestamp("2022-09-11")].reset_index(drop=True)
feat = pd.read_parquet(WS / "data_work" / "HI-Small_features_v1.parquet")
assert len(df) == len(feat)

fx = {}
for line in open(WS / "data_work" / "fx_rates_usd.txt"):
    k, v = line.rsplit(None, 1)
    fx[k.strip()] = float(v)
usd_p = (df.amt_paid / df.cur_paid.map(fx)).to_numpy()
usd_r = (df.amt_recv / df.cur_recv.map(fx)).to_numpy()
codes, uniques = pd.factorize(pd.concat([df.from_bank + "|" + df.from_acct,
                                         df.to_bank + "|" + df.to_acct], ignore_index=True))
u_ids, v_ids = codes[:len(df)], codes[len(df):]
# 빌더와 다른 경로로 분 변환 (같은 버그 공유 방지)
tmin = ((df.ts - pd.Timestamp("1970-01-01")).dt.total_seconds() // 60).astype("int64").to_numpy()
assert tmin.max() - tmin.min() < 20 * 24 * 60, "분 단위 변환 이상"

order = np.argsort(tmin, kind="stable")
# 정렬 도메인 배열
su_, sv_, st_ = u_ids[order], v_ids[order], tmin[order]
sp_, sr_ = usd_p[order], usd_r[order]
pos_of = np.empty(len(df), dtype=np.int64)   # 원래 행 -> 정렬 위치
pos_of[order] = np.arange(len(df))

samples = rng.choice(len(df), NS, replace=False)
# 표본 보강: 세탁 행 + 자기거래 행도 섞는다
labels = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")["label"].to_numpy()
labels = labels[feat.orig_row.to_numpy()]
samples = np.concatenate([samples,
                          rng.choice(np.where(labels > 0)[0], 25, replace=False),
                          rng.choice(np.where(u_ids == v_ids)[0], 25, replace=False)])

def acct_feats(a, pos, t):
    prev = np.arange(len(df)) < pos
    sent = prev & (su_ == a)
    recv = prev & (sv_ == a)
    su = sp_[sent].sum(); ru = sr_[recv].sum()
    any_ = sent | recv
    first = st_[any_].min() if any_.any() else None
    last = st_[any_].max() if any_.any() else None
    out = {}
    for w, hz in (("24h", W24), ("72h", W72)):
        sw = sent & (st_ > t - hz); rw = recv & (st_ > t - hz)
        out.update({f"sent_cnt_{w}": sw.sum(), f"recv_cnt_{w}": rw.sum(),
                    f"out_deg_{w}": len(set(sv_[sw])), f"in_deg_{w}": len(set(su_[rw])),
                    f"sent_usd_log_{w}": log1p(sp_[sw].sum()),
                    f"recv_usd_log_{w}": log1p(sr_[rw].sum()),
                    f"burst_{w}": (sw.sum() + rw.sum()) / (sent.sum() + recv.sum() + 1)})
    return {"sent_cnt": sent.sum(), "recv_cnt": recv.sum(),
            "sent_usd_log": log1p(su), "recv_usd_log": log1p(ru),
            "out_deg": len(set(sv_[sent])), "in_deg": len(set(su_[recv])),
            "age_min": t - first if first is not None else 0,
            "since_last_min": t - last if last is not None else 0,
            "flow_ratio": log((su + 1) / (ru + 1)), **out}, su, sent.sum()

bad = 0
checked = 0
for row_i in samples:
    pos = pos_of[row_i]
    t = tmin[row_i]
    u, v = u_ids[row_i], v_ids[row_i]
    got = feat.iloc[row_i]
    exp = {}
    fu, su_sum, u_sc = acct_feats(u, pos, t)
    fv, _, v_sc = acct_feats(v, pos, t)
    exp.update({f"u_{k}": x for k, x in fu.items()})
    exp.update({f"v_{k}": x for k, x in fv.items()})
    prev = np.arange(len(df)) < pos
    exp["edge_cnt"] = (prev & (su_ == u) & (sv_ == v)).sum()
    exp["edge_rev_cnt"] = (prev & (su_ == v) & (sv_ == u)).sum()
    v_sent_total = (prev & (su_ == v)).sum()
    if v_sent_total <= 50:
        rev72_mask = prev & (su_ == v) & (sv_ == u) & (st_ > t - W72)
        exp["edge_rev_cnt_72h"] = rev72_mask.sum()
        cyc = 0.0
        mids = set(sv_[prev & (su_ == v) & (st_ > t - W72)]) - {u, v}
        for x in mids:
            if (prev & (su_ == x) & (sv_ == u)).any():
                cyc = 1.0
                break
        exp["cycle3_flag_72h"] = cyc
    ru24 = np.expm1(fu["recv_usd_log_24h"])
    exp["pass_speed_24h"] = usd_p[row_i] / (ru24 + 1)
    exp["amt_vs_hist"] = usd_p[row_i] / (su_sum / u_sc + 1 if u_sc else 1)
    for k, e in exp.items():
        checked += 1
        g = float(got[k])
        if not np.isclose(g, float(e), rtol=1e-4, atol=1e-4):
            bad += 1
            print(f"MISMATCH row={row_i} {k}: got={g} expected={float(e)}")

print(f"\n표본 {len(samples)}행 × 피처 대조 {checked}건, 불일치 {bad}건")
print("결과:", "PASS" if bad == 0 else "FAIL")
