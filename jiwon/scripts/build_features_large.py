"""HI-Large 그래프 피처 v2 빌더 — v1 52개(의미·순서 동일) + 클래스 타깃 23개 = 75개.

사용법: python build_features_large.py <WS루트> [--dryrun]

v1 52개는 HI-Small 빌더와 동일 의미·순서(features_v1.md). 신규 23개는
features_v2.md 명세: 감쇠 카운터(HL 7d/30d)·신규 상대 유입·일회성 간선 비율·
중계/되돌림·cycle3_30d — 전부 계좌당 O(1) 상태(큐·dict 추가 없음).
(features_v1.parquet 는 확장 전 버전으로 빌드됨 — v1 52개 정의는 불변이므로
v2 산출물의 앞 52열이 곧 v1 이다.) 구현 교체 사항:
- 입력: prepare_hi_large.py 의 trans_sorted.parquet (시간 정렬, 같은 분 내 원본
  파일 순서 = HI-Small 의 stable sort 규약과 동일)
- 계좌별 파이썬 객체(HI-Small: 계좌당 ~3KB → 213만 계좌 불가) 대신:
  스칼라 상태 = numpy 배열, 24h/72h 윈도우 = 단일 이벤트 링 버퍼(이중 만료
  head — 24h 는 72h 의 부분집합) + 카운터 배열 + (계좌,상대,방향,윈도우)
  단일 dict, recent_sent = 고정 링 버퍼(50)
- 출력: features_v1.parquet 배치 append (orig_row·tmin·label·attempt_id + 52 float32)
"""
import sys
import time
from math import exp, log, log1p
from pathlib import Path

import numpy as np
import psutil
import pyarrow as pa
import pyarrow.parquet as pq

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
DIR = WS / "data_work" / ("HI-Large_dryrun" if "--dryrun" in sys.argv else "HI-Large")
IN_PATH = DIR / "trans_sorted.parquet"
OUT_PATH = DIR / "features_v2.parquet"
W24, W72 = 24 * 60, 72 * 60
W30D = 30 * 1440
LAM7 = log(2) / (7 * 1440)    # 감쇠율 (반감기 7일, 분 단위)
LAM30 = log(2) / (30 * 1440)
CAP = 50  # recent_sent 캡 (명세 한계)
BATCH = 2_000_000

NA = sum(1 for _ in open(DIR / "acct_vocab.txt"))
print(f"accounts={NA:,}", flush=True)

# ---- 상태 ----
sc = np.zeros(NA, np.int64); rc = np.zeros(NA, np.int64)
su = np.zeros(NA, np.float64); ru = np.zeros(NA, np.float64)
first = np.full(NA, -1, np.int64); last = np.full(NA, -1, np.int64)
out_deg = np.zeros(NA, np.int32); in_deg = np.zeros(NA, np.int32)
# 윈도우: 인덱스 0=24h, 1=72h
wsc = [np.zeros(NA, np.int32), np.zeros(NA, np.int32)]
wrc = [np.zeros(NA, np.int32), np.zeros(NA, np.int32)]
wsu = [np.zeros(NA, np.float64), np.zeros(NA, np.float64)]
wru = [np.zeros(NA, np.float64), np.zeros(NA, np.float64)]
wod = [np.zeros(NA, np.int32), np.zeros(NA, np.int32)]
wid = [np.zeros(NA, np.int32), np.zeros(NA, np.int32)]
# 이벤트 링 버퍼(단일) + 이중 head: head72 <= head24 <= tail (논리 인덱스).
# 24h 윈도우는 72h 의 부분집합이므로 큐를 하나만 유지하고 만료 포인터를 둘 둔다.
ring_cap = 4_000_000
er_t = np.zeros(ring_cap, np.int32)
er_u = np.zeros(ring_cap, np.int32)
er_v = np.zeros(ring_cap, np.int32)
er_p = np.zeros(ring_cap, np.float64)
er_r = np.zeros(ring_cap, np.float64)
head24 = head72 = tail = 0
win_cnt = {}   # ((acct*NA+cp)<<2 | dir<<1 | h) -> count.  dir: 0=송신, 1=수신
edge_cnt = {}  # u*NA+v -> count
rs_t = np.zeros((NA, CAP), np.int32)
rs_cp = np.full((NA, CAP), -1, np.int32)
rs_start = np.zeros(NA, np.int16); rs_len = np.zeros(NA, np.int16)
# ---- v2 상태 (features_v2.md — 전부 O(1)/계좌) ----
d7s_c = np.zeros(NA, np.float64); d7s_u = np.zeros(NA, np.float64); d7s_t = np.zeros(NA, np.int64)
d7r_c = np.zeros(NA, np.float64); d7r_u = np.zeros(NA, np.float64); d7r_t = np.zeros(NA, np.int64)
d30i_c = np.zeros(NA, np.float64); d30i_t = np.zeros(NA, np.int64)
d30o_c = np.zeros(NA, np.float64); d30o_t = np.zeros(NA, np.int64)
in_once = np.zeros(NA, np.int32); out_once = np.zeros(NA, np.int32)
last_recv_t = np.full(NA, -1, np.int64); last_recv_usd = np.zeros(NA, np.float64)
last_sent_t = np.full(NA, -1, np.int64); last_sent_usd = np.zeros(NA, np.float64)

def dk(val, lt, t, lam):
    """감쇠값 읽기 (상태 불변). 값 0이면 exp 생략."""
    return val * exp(-lam * (t - lt)) if val else 0.0

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
# v2 신규 23: 역할별 9×2 + 거래 단위 5 (features_v2.md 순서)
for r in ("u", "v"):
    COLS += [f"{r}_{c}" for c in ("dk7_sent_cnt", "dk7_recv_cnt", "dk7_sent_usd_log",
                                  "dk7_recv_usd_log", "dk7_flow_ratio", "dk30_new_in",
                                  "dk30_new_out", "once_in_ratio", "once_out_ratio")]
COLS += ["relay_amt_logratio", "relay_gap_min", "backfill_amt_logratio",
         "backfill_gap_min", "cycle3_flag_30d"]
assert len(COLS) == 75

def role_feats(a, t, buf, off):
    buf[off] = sc[a]; buf[off+1] = rc[a]
    buf[off+2] = log1p(su[a]); buf[off+3] = log1p(ru[a])
    buf[off+4] = out_deg[a]; buf[off+5] = in_deg[a]
    buf[off+6] = t - first[a] if first[a] >= 0 else 0
    buf[off+7] = t - last[a] if last[a] >= 0 else 0
    buf[off+8] = log((su[a] + 1) / (ru[a] + 1))
    tot1 = sc[a] + rc[a] + 1
    o = off + 9
    for h in (0, 1):
        buf[o] = wsc[h][a]; buf[o+1] = wrc[h][a]
        buf[o+2] = wod[h][a]; buf[o+3] = wid[h][a]
        buf[o+4] = log1p(wsu[h][a]); buf[o+5] = log1p(wru[h][a])
        buf[o+6] = (int(wsc[h][a]) + int(wrc[h][a])) / tot1
        o += 7

def role_feats_v2(a, t, buf, off):
    su_d = dk(d7s_u[a], d7s_t[a], t, LAM7)
    ru_d = dk(d7r_u[a], d7r_t[a], t, LAM7)
    buf[off] = dk(d7s_c[a], d7s_t[a], t, LAM7)
    buf[off+1] = dk(d7r_c[a], d7r_t[a], t, LAM7)
    buf[off+2] = log1p(su_d); buf[off+3] = log1p(ru_d)
    buf[off+4] = log((su_d + 1) / (ru_d + 1))
    buf[off+5] = dk(d30i_c[a], d30i_t[a], t, LAM30)
    buf[off+6] = dk(d30o_c[a], d30o_t[a], t, LAM30)
    buf[off+7] = in_once[a] / (in_deg[a] + 1)
    buf[off+8] = out_once[a] / (out_deg[a] + 1)

pf = pq.ParquetFile(IN_PATH)
n_total = pf.metadata.num_rows
schema = pa.schema([("orig_row", pa.int64()), ("tmin", pa.int32()),
                    ("label", pa.int8()), ("attempt_id", pa.int32())]
                   + [(c, pa.float32()) for c in COLS])
writer = pq.ParquetWriter(OUT_PATH, schema)
proc = psutil.Process()
row = np.zeros(75)
done = 0
t0 = time.time()

for batch in pf.iter_batches(batch_size=BATCH,
                             columns=["tmin", "u_id", "v_id", "usd_paid", "usd_recv",
                                      "label", "attempt_id", "orig_row"]):
    n = batch.num_rows
    t_l = batch.column("tmin").to_numpy().tolist()
    u_l = batch.column("u_id").to_numpy().tolist()
    v_l = batch.column("v_id").to_numpy().tolist()
    up_l = batch.column("usd_paid").to_numpy().tolist()
    ur_l = batch.column("usd_recv").to_numpy().tolist()
    F = np.zeros((n, 75), np.float32)
    for i in range(n):
        u = u_l[i]; v = v_l[i]; t = t_l[i]; up = up_l[i]; ur = ur_l[i]
        # ---- 전역 만료 (원본 Win.expire 와 동일 조건: t0 <= t - horizon) ----
        lim = t - W72
        while head72 < tail and er_t[head72 % ring_cap] <= lim:
            p = head72 % ring_cap
            a = int(er_u[p]); b = int(er_v[p]); p0 = er_p[p]; r0 = er_r[p]
            wsc[1][a] -= 1; wsu[1][a] -= p0
            k = ((a * NA + b) << 2) | 1
            c = win_cnt[k] - 1
            if c: win_cnt[k] = c
            else: del win_cnt[k]; wod[1][a] -= 1
            wrc[1][b] -= 1; wru[1][b] -= r0
            k = ((b * NA + a) << 2) | 3
            c = win_cnt[k] - 1
            if c: win_cnt[k] = c
            else: del win_cnt[k]; wid[1][b] -= 1
            head72 += 1
        lim = t - W24
        while head24 < tail and er_t[head24 % ring_cap] <= lim:
            p = head24 % ring_cap
            a = int(er_u[p]); b = int(er_v[p]); p0 = er_p[p]; r0 = er_r[p]
            wsc[0][a] -= 1; wsu[0][a] -= p0
            k = ((a * NA + b) << 2) | 0
            c = win_cnt[k] - 1
            if c: win_cnt[k] = c
            else: del win_cnt[k]; wod[0][a] -= 1
            wrc[0][b] -= 1; wru[0][b] -= r0
            k = ((b * NA + a) << 2) | 2
            c = win_cnt[k] - 1
            if c: win_cnt[k] = c
            else: del win_cnt[k]; wid[0][b] -= 1
            head24 += 1
        # ---- 피처 (상태 갱신 전) ----
        role_feats(u, t, row, 0)
        role_feats(v, t, row, 23)
        ek = u * NA + v
        row[46] = edge_cnt.get(ek, 0)
        row[47] = edge_cnt.get(v * NA + u, 0)
        rev72 = 0; cyc = 0.0; cyc30 = 0.0
        tlim72 = t - W72
        tlim30 = t - W30D
        m = rs_len[v]
        st = rs_start[v]
        for j in range(m - 1, -1, -1):  # 최신 → 과거, 30d 만료 시 중단
            p = (st + j) % CAP
            t1 = rs_t[v, p]
            if t1 <= tlim30:
                break
            cp = int(rs_cp[v, p])  # numpy int32 * NA 오버플로 방지
            if cp == u:
                if t1 > tlim72:
                    rev72 += 1
            elif cp != v and edge_cnt.get(cp * NA + u, 0):
                cyc30 = 1.0
                if t1 > tlim72:
                    cyc = 1.0
        row[48] = rev72; row[49] = cyc
        row[50] = up / (wru[0][u] + 1)
        row[51] = up / ((su[u] / sc[u] + 1) if sc[u] else 1)
        # ---- v2 (features_v2.md) ----
        role_feats_v2(u, t, row, 52)
        role_feats_v2(v, t, row, 61)
        lr = last_recv_t[u]
        if lr < 0:
            row[70] = 0.0; row[71] = -1.0
        else:
            row[70] = log((up + 1) / (last_recv_usd[u] + 1)); row[71] = t - lr
        ls = last_sent_t[v]
        if ls < 0:
            row[72] = 0.0; row[73] = -1.0
        else:
            row[72] = log((ur + 1) / (last_sent_usd[v] + 1)); row[73] = t - ls
        row[74] = cyc30
        F[i] = row
        # ---- 상태 갱신 ----
        if first[u] < 0: first[u] = t
        last[u] = t
        sc[u] += 1; su[u] += up
        if first[v] < 0: first[v] = t
        last[v] = t
        rc[v] += 1; ru[v] += ur
        # v2: 감쇠 7d (u 송신 / v 수신 — last_t 는 쌍 공유)
        e = exp(-LAM7 * (t - d7s_t[u]))
        d7s_c[u] = d7s_c[u] * e + 1; d7s_u[u] = d7s_u[u] * e + up; d7s_t[u] = t
        e = exp(-LAM7 * (t - d7r_t[v]))
        d7r_c[v] = d7r_c[v] * e + 1; d7r_u[v] = d7r_u[v] * e + ur; d7r_t[v] = t
        # v2: 중계/되돌림 최근값
        last_sent_t[u] = t; last_sent_usd[u] = up
        last_recv_t[v] = t; last_recv_usd[v] = ur
        c = edge_cnt.get(ek, 0)
        if c == 0:
            out_deg[u] += 1; in_deg[v] += 1
            out_once[u] += 1; in_once[v] += 1
            e = exp(-LAM30 * (t - d30o_t[u]))
            d30o_c[u] = d30o_c[u] * e + 1; d30o_t[u] = t
            e = exp(-LAM30 * (t - d30i_t[v]))
            d30i_c[v] = d30i_c[v] * e + 1; d30i_t[v] = t
        elif c == 1:
            out_once[u] -= 1; in_once[v] -= 1
        edge_cnt[ek] = c + 1
        rk = v * NA + u
        for h in (0, 1):
            k = ((ek) << 2) | h
            c = win_cnt.get(k, 0)
            if c == 0: wod[h][u] += 1
            win_cnt[k] = c + 1
            k = (rk << 2) | 2 | h
            c = win_cnt.get(k, 0)
            if c == 0: wid[h][v] += 1
            win_cnt[k] = c + 1
            wsc[h][u] += 1; wsu[h][u] += up
            wrc[h][v] += 1; wru[h][v] += ur
        if tail - head72 >= ring_cap:  # 링 확장 (활성 구간 보존)
            nc = ring_cap * 2
            span = np.arange(head72, tail)
            src = span % ring_cap
            dst = span % nc
            def _grow(old):
                new = np.zeros(nc, old.dtype)
                new[dst] = old[src]
                return new
            er_t = _grow(er_t); er_u = _grow(er_u); er_v = _grow(er_v)
            er_p = _grow(er_p); er_r = _grow(er_r)
            ring_cap = nc
            print(f"  ring 확장 -> {ring_cap/1e6:.0f}M", flush=True)
        p = tail % ring_cap
        er_t[p] = t; er_u[p] = u; er_v[p] = v; er_p[p] = up; er_r[p] = ur
        tail += 1
        m = rs_len[u]
        if m < CAP:
            rs_t[u, (rs_start[u] + m) % CAP] = t
            rs_cp[u, (rs_start[u] + m) % CAP] = v
            rs_len[u] = m + 1
        else:
            rs_t[u, rs_start[u]] = t
            rs_cp[u, rs_start[u]] = v
            rs_start[u] = (rs_start[u] + 1) % CAP
    arrs = [batch.column("orig_row"), batch.column("tmin"),
            batch.column("label"), batch.column("attempt_id")]
    arrs += [pa.array(F[:, j]) for j in range(75)]
    writer.write_table(pa.Table.from_arrays(arrs, schema=schema))
    done += n
    el = time.time() - t0
    print(f"{done/1e6:.0f}M/{n_total/1e6:.0f}M  {el:.0f}s  {done/el/1000:.0f}k rows/s  "
          f"RSS {proc.memory_info().rss/2**30:.2f}GB  edge {len(edge_cnt)/1e6:.1f}M  "
          f"win {len(win_cnt)/1e6:.1f}M  ring {(tail-head72)/1e6:.1f}M/{ring_cap/1e6:.0f}M", flush=True)

writer.close()
print(f"저장: {OUT_PATH}  총 {(time.time()-t0)/60:.1f}분", flush=True)
