"""HI-Large 그래프 피처 v1 빌더 — build_features.py(HI-Small)의 청크 스트리밍 이식.

사용법: python build_features_large.py <WS루트> [--dryrun]

피처 의미·순서는 HI-Small 빌더와 동일(52개, features_v1.md). 구현만 교체:
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
from math import log, log1p
from pathlib import Path

import numpy as np
import psutil
import pyarrow as pa
import pyarrow.parquet as pq

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
DIR = WS / "data_work" / ("HI-Large_dryrun" if "--dryrun" in sys.argv else "HI-Large")
IN_PATH = DIR / "trans_sorted.parquet"
OUT_PATH = DIR / "features_v1.parquet"
W24, W72 = 24 * 60, 72 * 60
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

pf = pq.ParquetFile(IN_PATH)
n_total = pf.metadata.num_rows
schema = pa.schema([("orig_row", pa.int64()), ("tmin", pa.int32()),
                    ("label", pa.int8()), ("attempt_id", pa.int32())]
                   + [(c, pa.float32()) for c in COLS])
writer = pq.ParquetWriter(OUT_PATH, schema)
proc = psutil.Process()
row = np.zeros(52)
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
    F = np.zeros((n, 52), np.float32)
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
        rev72 = 0; cyc = 0.0
        tlim = t - W72
        m = rs_len[v]
        st = rs_start[v]
        for j in range(m - 1, -1, -1):  # 최신 → 과거, 만료 시 중단
            p = (st + j) % CAP
            t1 = rs_t[v, p]
            if t1 <= tlim:
                break
            cp = int(rs_cp[v, p])  # numpy int32 * NA 오버플로 방지
            if cp == u:
                rev72 += 1
            elif cp != v and edge_cnt.get(cp * NA + u, 0):
                cyc = 1.0
        row[48] = rev72; row[49] = cyc
        row[50] = up / (wru[0][u] + 1)
        row[51] = up / ((su[u] / sc[u] + 1) if sc[u] else 1)
        F[i] = row
        # ---- 상태 갱신 ----
        if first[u] < 0: first[u] = t
        last[u] = t
        sc[u] += 1; su[u] += up
        if first[v] < 0: first[v] = t
        last[v] = t
        rc[v] += 1; ru[v] += ur
        c = edge_cnt.get(ek, 0)
        if c == 0:
            out_deg[u] += 1; in_deg[v] += 1
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
    arrs += [pa.array(F[:, j]) for j in range(52)]
    writer.write_table(pa.Table.from_arrays(arrs, schema=schema))
    done += n
    el = time.time() - t0
    print(f"{done/1e6:.0f}M/{n_total/1e6:.0f}M  {el:.0f}s  {done/el/1000:.0f}k rows/s  "
          f"RSS {proc.memory_info().rss/2**30:.2f}GB  edge {len(edge_cnt)/1e6:.1f}M  "
          f"win {len(win_cnt)/1e6:.1f}M  ring {(tail-head72)/1e6:.1f}M/{ring_cap/1e6:.0f}M", flush=True)

writer.close()
print(f"저장: {OUT_PATH}  총 {(time.time()-t0)/60:.1f}분", flush=True)
