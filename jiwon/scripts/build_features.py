"""그래프 피처 v1 빌더 (확정 명세: Tier1 18 + Tier2 28 + Tier3 6 = 52개).

사용법: python build_features.py <WS루트> [출력파일명]

- 대상: HI-Small, ts < 2022-09-11 (꼬리 제외)
- 모든 집계는 각 거래 시각 t "미만" 데이터만 사용 (시간순 단일 패스,
  같은 분 내에서는 파일 순서 유지 — stable sort)
- 계좌 키 = (은행, 계좌번호) 쌍
- Tier3의 edge_rev_cnt_72h / cycle3_flag_72h는 계좌당 최근 송신 50건 캡 (명세 한계)
- 출력: data_work/<출력파일명>.parquet, orig_row = 원본 csv 0-기준 행 번호
"""
import sys
import time
from collections import deque
from math import log, log1p
from pathlib import Path

import numpy as np
import pandas as pd

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
OUT_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else WS / "data_work" / "HI-Small_features_v1.parquet"
CUT = pd.Timestamp(sys.argv[3]) if len(sys.argv) > 3 else pd.Timestamp("2022-09-11")
W24, W72 = 24 * 60, 72 * 60  # 분
RECENT_SENT_CAP = 50

# ---- 로드 ----
df = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                 names=["ts", "from_bank", "from_acct", "to_bank", "to_acct",
                        "amt_recv", "cur_recv", "amt_paid", "cur_paid", "fmt", "flag"],
                 header=0, dtype={"from_bank": str, "to_bank": str,
                                  "from_acct": str, "to_acct": str})
df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
df = df[df.ts < CUT]
orig_row = df.index.to_numpy()          # 원본 csv 행 번호 (0-기준, 헤더 제외)
df = df.reset_index(drop=True)

fx = {}
for line in open(WS / "data_work" / "fx_rates_usd.txt"):
    k, v = line.rsplit(None, 1)
    fx[k.strip()] = float(v)
usd_paid = (df.amt_paid / df.cur_paid.map(fx)).to_numpy()
usd_recv = (df.amt_recv / df.cur_recv.map(fx)).to_numpy()
assert not np.isnan(usd_paid).any() and not np.isnan(usd_recv).any()

acct_from, acct_to = df.from_bank + "|" + df.from_acct, df.to_bank + "|" + df.to_acct
codes, uniques = pd.factorize(pd.concat([acct_from, acct_to], ignore_index=True))
NA = len(uniques)
u_ids = codes[:len(df)]
v_ids = codes[len(df):]
tmin = (df.ts.astype("datetime64[s]").astype("int64") // 60).to_numpy()  # epoch 분
assert tmin.max() - tmin.min() < 20 * 24 * 60, "분 단위 변환 이상"

order = np.argsort(tmin, kind="stable")
n = len(df)
print(f"rows={n:,}  accounts={NA:,}", flush=True)

# ---- 상태 ----
class Win:
    __slots__ = ("q", "sc", "rc", "su", "ru", "out", "inn")
    def __init__(self):
        self.q = deque()
        self.sc = self.rc = 0
        self.su = self.ru = 0.0
        self.out = {}
        self.inn = {}

    def expire(self, t, horizon):
        q = self.q
        while q and q[0][0] <= t - horizon:
            _, sent, usd, cp = q.popleft()
            if sent:
                self.sc -= 1; self.su -= usd
                d = self.out
            else:
                self.rc -= 1; self.ru -= usd
                d = self.inn
            c = d[cp] - 1
            if c:
                d[cp] = c
            else:
                del d[cp]

    def add(self, t, sent, usd, cp):
        self.q.append((t, sent, usd, cp))
        if sent:
            self.sc += 1; self.su += usd
            d = self.out
        else:
            self.rc += 1; self.ru += usd
            d = self.inn
        d[cp] = d.get(cp, 0) + 1

class Acct:
    __slots__ = ("sc", "rc", "su", "ru", "out", "inn", "first", "last",
                 "w24", "w72", "recent_sent")
    def __init__(self):
        self.sc = self.rc = 0
        self.su = self.ru = 0.0
        self.out = set()
        self.inn = set()
        self.first = self.last = -1
        self.w24 = Win()
        self.w72 = Win()
        self.recent_sent = deque(maxlen=RECENT_SENT_CAP)

accts = [None] * NA
def get(i):
    a = accts[i]
    if a is None:
        a = accts[i] = Acct()
    return a

edge_cnt = {}

def role_feats(a, t, buf, off):
    # Tier1 (9)
    buf[off] = a.sc; buf[off+1] = a.rc
    buf[off+2] = log1p(a.su); buf[off+3] = log1p(a.ru)
    buf[off+4] = len(a.out); buf[off+5] = len(a.inn)
    buf[off+6] = t - a.first if a.first >= 0 else 0
    buf[off+7] = t - a.last if a.last >= 0 else 0
    buf[off+8] = log((a.su + 1) / (a.ru + 1))
    # Tier2 (7×2)
    tot1 = a.sc + a.rc + 1
    o = off + 9
    for w, hz in ((a.w24, W24), (a.w72, W72)):
        w.expire(t, hz)
        buf[o] = w.sc; buf[o+1] = w.rc
        buf[o+2] = len(w.out); buf[o+3] = len(w.inn)
        buf[o+4] = log1p(w.su); buf[o+5] = log1p(w.ru)
        buf[o+6] = (w.sc + w.rc) / tot1
        o += 7

COLS = []
for r in ("u", "v"):
    COLS += [f"{r}_{c}" for c in ("sent_cnt", "recv_cnt", "sent_usd_log", "recv_usd_log",
                                  "out_deg", "in_deg", "age_min", "since_last_min", "flow_ratio")]
    for w in ("24h", "72h"):
        COLS += [f"{r}_{c}_{w}" for c in ("sent_cnt", "recv_cnt", "out_deg", "in_deg",
                                          "sent_usd_log", "recv_usd_log", "burst")]
COLS += ["edge_cnt", "edge_rev_cnt", "edge_rev_cnt_72h", "cycle3_flag_72h",
         "pass_speed_24h", "amt_vs_hist"]
assert len(COLS) == 52

F = np.zeros((n, 52), dtype=np.float32)
row = np.zeros(52)
t0 = time.time()

u_l, v_l, t_l = u_ids[order].tolist(), v_ids[order].tolist(), tmin[order].tolist()
up_l, ur_l = usd_paid[order].tolist(), usd_recv[order].tolist()

for i in range(n):
    u, v, t, up, ur = u_l[i], v_l[i], t_l[i], up_l[i], ur_l[i]
    au, av = get(u), get(v)
    role_feats(au, t, row, 0)
    role_feats(av, t, row, 23)
    # Tier3
    ek = u * NA + v
    row[46] = edge_cnt.get(ek, 0)
    row[47] = edge_cnt.get(v * NA + u, 0)
    rev72 = 0
    cyc = 0.0
    tlim = t - W72
    for t1, cp in av.recent_sent:
        if t1 <= tlim:
            continue
        if cp == u:
            rev72 += 1
        elif cp != v and edge_cnt.get(cp * NA + u, 0):
            cyc = 1.0
    row[48] = rev72
    row[49] = cyc
    row[50] = up / (au.w24.ru + 1)          # pass_speed_24h (expire는 role_feats에서 완료)
    row[51] = up / (au.su / au.sc + 1 if au.sc else 1)
    F[i] = row
    # ---- 상태 갱신 (피처 계산 후) ----
    if au.first < 0:
        au.first = t
    au.last = t
    au.sc += 1; au.su += up
    au.out.add(v)
    au.w24.add(t, 1, up, v); au.w72.add(t, 1, up, v)
    au.recent_sent.append((t, v))
    if av.first < 0:
        av.first = t
    av.last = t
    av.rc += 1; av.ru += ur
    av.inn.add(u)
    av.w24.add(t, 0, ur, u); av.w72.add(t, 0, ur, u)
    edge_cnt[ek] = edge_cnt.get(ek, 0) + 1
    if i % 500_000 == 0:
        print(f"{i:,}/{n:,}  {time.time()-t0:.0f}s", flush=True)

out = np.empty_like(F)
out[order] = F                      # 원래(꼬리 제외) 행 순서로 복원
res = pd.DataFrame(out, columns=COLS)
res.insert(0, "orig_row", orig_row)
res.to_parquet(OUT_PATH, index=False)
print(f"저장: {OUT_PATH}  ({time.time()-t0:.0f}s)")
