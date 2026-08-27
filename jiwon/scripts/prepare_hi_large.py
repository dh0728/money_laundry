"""HI-Large 전처리: 라벨 매칭 + 파싱 + 시간 정렬 parquet.

사용법: python prepare_hi_large.py <WS루트> [--nrows N]

Phase 0 실측 전제 (outputs/hi_large_phase0_eda.md):
- Trans.csv 는 시간순이 아니다(역행 48%, 최대 70.5일) → 정렬 필수
- Patterns.txt 라인은 전수 고유·전수 매칭 → 단순 dict 매칭으로 충분

Pass A: 원시 라인 스트리밍 라벨 매칭 (행 번호 → label, attempt_id)
Pass B: pandas 청크 파싱 → 계좌/통화/포맷 vocab, USD 환산, 일자 버킷 parts
Pass C: 일자 오름차순 parts 병합, (tmin, orig_row) 안정 정렬 → trans_sorted.parquet
검증: 행 수·클래스 분포·flag 대조·전역 단조성. 리포트: prepare_report.txt

출력 (data_work/HI-Large/, --nrows 시 HI-Large_dryrun/):
  trans_sorted.parquet  tmin(int32, epoch분)·u_id·v_id(int32)·usd_paid·usd_recv(f64)
                        cur_paid_id·cur_recv_id·fmt_id·amount_mismatch·same_bank
                        ·flag·label(int8)·attempt_id(int32)
                        orig_row(int64, 원본 csv 0-기준 행 번호)
  acct_vocab.txt / cur_vocab.txt / fmt_vocab.txt  (줄 번호 = id)
  prepare_report.txt
라벨: 0=NORMAL, 1=FAN-OUT, 2=FAN-IN, 3=GATHER-SCATTER, 4=SCATTER-GATHER,
      5=CYCLE, 6=RANDOM, 7=BIPARTITE, 8=STACK, 9=NONPATTERN-LAUNDERING
"""
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
NROWS = None
if "--nrows" in sys.argv:
    NROWS = int(sys.argv[sys.argv.index("--nrows") + 1])

TRANS = WS / "data" / "HI-Large_Trans.csv"
PATTERNS = WS / "data" / "HI-Large_Patterns.txt"
OUT = WS / "data_work" / ("HI-Large_dryrun" if NROWS else "HI-Large")
PARTS = OUT / "parts"
OUT.mkdir(parents=True, exist_ok=True)
CHUNK = 4_000_000
LABELS = {"FAN-OUT": 1, "FAN-IN": 2, "GATHER-SCATTER": 3, "SCATTER-GATHER": 4,
          "CYCLE": 5, "RANDOM": 6, "BIPARTITE": 7, "STACK": 8}
report = []
def rep(msg):
    print(msg, flush=True)
    report.append(msg)

t_start = time.time()

# ---- Patterns.txt 파싱 ----
pat = {}  # 원시 라인 -> (label, attempt_id)
attempt_id = -1
cur_label = None
with open(PATTERNS) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if line.startswith("BEGIN LAUNDERING ATTEMPT"):
            attempt_id += 1
            typ = line.split(" - ", 1)[1].split(":")[0].strip()
            cur_label = LABELS[typ]
        elif line.startswith("END LAUNDERING ATTEMPT"):
            cur_label = None
        else:
            assert cur_label is not None
            assert line not in pat, f"패턴 내 중복 라인(Phase 0 전제 위반): {line[:60]}"
            pat[line] = (cur_label, attempt_id)
rep(f"patterns: {attempt_id + 1} attempts, {len(pat)} unique lines")

# ---- Pass A: 라벨 매칭 ----
cap = NROWS if NROWS else 181_000_000
lab_arr = np.zeros(cap, dtype=np.int8)
att_arr = np.full(cap, -1, dtype=np.int32)
n_rows = 0
matched = 0
flag1_total = 0
t0 = time.time()
with open(TRANS) as f:
    f.readline()
    for raw in f:
        line = raw.rstrip("\n")
        hit = pat.get(line)
        if hit is not None:
            lab, aid = hit
            lab_arr[n_rows] = lab
            att_arr[n_rows] = aid
            matched += 1
        elif line.rsplit(",", 1)[1] == "1":
            lab_arr[n_rows] = 9
        if line.rsplit(",", 1)[1] == "1":
            flag1_total += 1
        n_rows += 1
        if n_rows % 20_000_000 == 0:
            print(f"  pass A {n_rows/1e6:.0f}M rows {time.time()-t0:.0f}s", flush=True)
        if NROWS and n_rows >= NROWS:
            break
lab_arr = lab_arr[:n_rows]
att_arr = att_arr[:n_rows]
if not NROWS:
    assert matched == len(pat), f"전수 매칭 실패: {matched} != {len(pat)}"
assert int((lab_arr > 0).sum()) == flag1_total, "label>0 수 != flag1 수"
rep(f"pass A: {n_rows:,} rows, matched {matched:,}, flag1 {flag1_total:,} [{time.time()-t0:.0f}s]")

# ---- Pass B: 파싱 + 일자 버킷 ----
fx = {}
for line in open(WS / "data_work" / "fx_rates_usd.txt"):
    k, v = line.rsplit(None, 1)
    fx[k.strip()] = float(v)

acct_vocab = {}
cur_vocab = {}
fmt_vocab = {}
def ids_of(series, vocab, dtype):
    m = series.map(vocab)
    if m.isna().any():
        for k in series[m.isna()].unique():
            vocab[k] = len(vocab)
        m = series.map(vocab)
    return m.to_numpy(dtype=dtype)

if PARTS.exists():
    shutil.rmtree(PARTS)
PARTS.mkdir()
part_files = {}  # day(int) -> [paths]
t0 = time.time()
reader = pd.read_csv(
    TRANS, header=0, chunksize=CHUNK, nrows=NROWS,
    names=["ts", "from_bank", "from_acct", "to_bank", "to_acct",
           "amt_recv", "cur_recv", "amt_paid", "cur_paid", "fmt", "flag"],
    dtype={"from_bank": str, "from_acct": str, "to_bank": str, "to_acct": str,
           "amt_recv": np.float64, "amt_paid": np.float64, "flag": np.int8})
row0 = 0
for ci, df in enumerate(reader):
    nn = len(df)
    tmin = (pd.to_datetime(df.ts, format="%Y/%m/%d %H:%M").astype("datetime64[s]")
            .astype("int64") // 60).to_numpy(dtype=np.int32)
    # 2022-08-01=epoch일 19205, 2023-02-01=19389 — 단위 실수 방지 가드
    assert 19205 <= tmin.min() // 1440 <= tmin.max() // 1440 <= 19389, \
        f"tmin 단위 이상: {tmin.min()}~{tmin.max()}"
    u_id = ids_of(df.from_bank + "|" + df.from_acct, acct_vocab, np.int32)
    v_id = ids_of(df.to_bank + "|" + df.to_acct, acct_vocab, np.int32)
    rate_p = df.cur_paid.map(fx).to_numpy()
    rate_r = df.cur_recv.map(fx).to_numpy()
    assert not (np.isnan(rate_p).any() or np.isnan(rate_r).any()), \
        f"fx 미등록 통화: {sorted(set(df.cur_paid[np.isnan(rate_p)]) | set(df.cur_recv[np.isnan(rate_r)]))}"
    out = pd.DataFrame({
        "tmin": tmin, "u_id": u_id, "v_id": v_id,
        "usd_paid": df.amt_paid.to_numpy() / rate_p,
        "usd_recv": df.amt_recv.to_numpy() / rate_r,
        "cur_paid_id": ids_of(df.cur_paid, cur_vocab, np.int8),
        "cur_recv_id": ids_of(df.cur_recv, cur_vocab, np.int8),
        "fmt_id": ids_of(df.fmt, fmt_vocab, np.int8),
        # 단건 피처 파생용 (features_v1 §단건): 원시 금액·은행 비교는 USD 환산으로 복원 불가
        "amount_mismatch": (df.amt_paid.to_numpy() != df.amt_recv.to_numpy()).astype(np.int8),
        "same_bank": (df.from_bank == df.to_bank).to_numpy(dtype=np.int8),
        "flag": df.flag.to_numpy(),
        "label": lab_arr[row0:row0 + nn],
        "attempt_id": att_arr[row0:row0 + nn],
        "orig_row": np.arange(row0, row0 + nn, dtype=np.int64),
    })
    for day, g in out.groupby(tmin // 1440, sort=False):
        p = PARTS / f"day{day}_c{ci}.parquet"
        g.to_parquet(p, index=False)
        part_files.setdefault(int(day), []).append(p)
    row0 += nn
    print(f"  pass B {row0/1e6:.0f}M rows {time.time()-t0:.0f}s", flush=True)
assert row0 == n_rows
rep(f"pass B: accounts {len(acct_vocab):,}, currencies {len(cur_vocab)}, formats {len(fmt_vocab)}, "
    f"days {len(part_files)} [{time.time()-t0:.0f}s]")

for name, voc in (("acct_vocab", acct_vocab), ("cur_vocab", cur_vocab), ("fmt_vocab", fmt_vocab)):
    with open(OUT / f"{name}.txt", "w") as f:
        for k in voc:  # 삽입 순서 = id 순서
            f.write(k + "\n")

# ---- Pass C: 일자 병합 + 안정 정렬 ----
t0 = time.time()
writer = None
last_tmin = -1
total_out = 0
class_dist = np.zeros(10, dtype=np.int64)
for day in sorted(part_files):
    d = pd.concat([pd.read_parquet(p) for p in part_files[day]], ignore_index=True)
    d = d.sort_values(["tmin", "orig_row"], kind="stable", ignore_index=True)
    assert d.tmin.iloc[0] >= last_tmin, f"일자 경계 역행: day {day}"
    last_tmin = int(d.tmin.iloc[-1])
    class_dist += np.bincount(d.label.to_numpy(), minlength=10)
    tbl = pa.Table.from_pandas(d, preserve_index=False)
    if writer is None:
        writer = pq.ParquetWriter(OUT / "trans_sorted.parquet", tbl.schema)
    writer.write_table(tbl)
    total_out += len(d)
writer.close()
shutil.rmtree(PARTS)
assert total_out == n_rows
rep(f"pass C: {total_out:,} rows sorted, 일자 경계 단조성 OK [{time.time()-t0:.0f}s]")

# ---- 전역 단조성 검증 (정렬 산출물 재스캔) ----
t0 = time.time()
pf = pq.ParquetFile(OUT / "trans_sorted.parquet")
prev = -1
for batch in pf.iter_batches(columns=["tmin"], batch_size=2_000_000):
    a = batch.column(0).to_numpy()
    assert a[0] >= prev and (np.diff(a) >= 0).all(), "전역 단조성 위반"
    prev = int(a[-1])
rep(f"검증: 전역 tmin 단조성 OK [{time.time()-t0:.0f}s]")

name = {0: "NORMAL", 9: "NONPAT", **{v: k for k, v in LABELS.items()}}
rep("클래스 분포: " + ", ".join(f"{name[i]}={class_dist[i]:,}" for i in range(10)))
rep(f"총 소요 {(time.time()-t_start)/60:.1f}분, 산출물: {OUT}")
(OUT / "prepare_report.txt").write_text("\n".join(report), encoding="utf-8")
