"""HI-Small EDA: 시간 분포, 클래스 분포, 시간 분할 후보. 읽기 전용.

사용법: python eda.py <WS루트>
"""
import sys
from pathlib import Path
import pandas as pd

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
NAME = {0: "NORMAL", 1: "FAN-OUT", 2: "FAN-IN", 3: "GATHER-SCATTER",
        4: "SCATTER-GATHER", 5: "CYCLE", 6: "RANDOM", 7: "BIPARTITE",
        8: "STACK", 9: "NONPATTERN"}

trans = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                    usecols=[0, 1, 2, 3, 4, 9],
                    names=["ts", "from_bank", "from_acct", "to_bank", "to_acct", "fmt"],
                    header=0, dtype=str)
labels = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")
assert len(trans) == len(labels)
df = pd.concat([trans, labels], axis=1)
df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
df["date"] = df["ts"].dt.date

print("=== 1. 전체 기간 / 일별 거래량 ===")
print(f"기간: {df.ts.min()} ~ {df.ts.max()}")
daily = df.groupby("date").agg(total=("label", "size"),
                               laundering=("label", lambda s: (s > 0).sum()))
daily["cum_pct"] = daily.total.cumsum() / len(df) * 100
print(daily.to_string())

print("\n=== 2. 자기거래 (보내는 계좌 = 받는 계좌) ===")
self_tx = (df.from_bank == df.to_bank) & (df.from_acct == df.to_acct)
print(f"자기거래: {self_tx.sum():,}건 ({self_tx.mean()*100:.2f}%)")
print("자기거래의 라벨 분포:", df.loc[self_tx, "label"].map(NAME).value_counts().to_dict())
print("자기거래의 payment format:", df.loc[self_tx, "fmt"].value_counts().to_dict())

print("\n=== 3. attempt 단위 시간 범위 ===")
att = df[df.attempt_id >= 0].groupby("attempt_id").agg(
    cls=("label", "first"), start=("ts", "min"), end=("ts", "max"), n=("ts", "size"))
att["days"] = (att.end - att.start).dt.total_seconds() / 86400
print("attempt duration(일) 분위수:")
print(att.days.describe(percentiles=[.5, .9, .99]).to_string())
print("\n클래스별 attempt 시작시각 범위:")
g = att.groupby("cls").agg(n_att=("n", "size"), first_start=("start", "min"),
                           last_start=("start", "max"), max_days=("days", "max"))
g.index = g.index.map(NAME)
print(g.to_string())

print("\n=== 4. 시간 분할 후보 ===")
for tr_pct, va_pct in [(70, 15), (60, 20), (80, 10)]:
    t1 = df.ts.quantile(tr_pct / 100)
    t2 = df.ts.quantile((tr_pct + va_pct) / 100)
    part = pd.cut(df.ts, [pd.Timestamp.min, t1, t2, pd.Timestamp.max],
                  labels=["train", "val", "test"])
    tab = pd.crosstab(df.label.map(NAME), part)
    straddle = ((att.start <= t1) & (att.end > t1)).sum() + ((att.start <= t2) & (att.end > t2)).sum()
    print(f"\n--- {tr_pct}/{va_pct}/{100-tr_pct-va_pct} (행 기준) → 경계: {t1} / {t2} | 경계 걸친 attempt: {straddle}/370 ---")
    print(tab.reindex([NAME[i] for i in range(10)]).to_string())
