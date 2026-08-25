"""단건 파생 피처 후보 검토용 실측. 읽기 전용.

각 후보 축에 대해 값별 건수와 세탁 비율(꼬리 제외 데이터 기준)을 출력한다.
사용법: python3 feature_review.py <WS루트>
"""
import sys
from pathlib import Path
import numpy as np
import pandas as pd

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
trans = pd.read_csv(WS / "data" / "HI-Small_Trans.csv",
                    names=["ts", "from_bank", "from_acct", "to_bank", "to_acct",
                           "amt_recv", "cur_recv", "amt_paid", "cur_paid", "fmt", "flag"],
                    header=0, dtype={"from_bank": str, "to_bank": str,
                                     "from_acct": str, "to_acct": str})
labels = pd.read_csv(WS / "data_work" / "HI-Small_labels_10class.csv")
df = pd.concat([trans, labels["label"]], axis=1)
df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
df = df[df.ts < pd.Timestamp("2022-09-11")]
df["laund"] = (df.label > 0).astype(int)
base = df.laund.mean()
print(f"rows={len(df):,}  세탁 기본비율={base*100:.4f}%\n")

def rate_table(s, name, top=None):
    g = df.groupby(s).agg(n=("laund", "size"), laund=("laund", "sum"))
    g["rate%"] = g.laund / g.n * 100
    g["lift"] = g["rate%"] / (base * 100)
    g = g.sort_values("n", ascending=False)
    if top:
        g = g.head(top)
    print(f"--- {name} ---")
    print(g.to_string(float_format=lambda x: f"{x:.3f}"))
    print()

rate_table(df.fmt, "Payment Format")
rate_table(df.cur_paid, "Payment Currency")
rate_table((df.cur_paid != df.cur_recv).map({True: "다름", False: "같음"}), "통화 불일치(송금≠수취)")
rate_table((df.amt_paid != df.amt_recv).map({True: "다름", False: "같음"}), "금액 불일치(송금≠수취)")
rate_table((df.from_bank == df.to_bank).map({True: "동일", False: "다름"}), "동일 은행")
rate_table(((df.from_bank == df.to_bank) & (df.from_acct == df.to_acct))
           .map({True: "자기", False: "타인"}), "자기거래")

# 시각
rate_table(df.ts.dt.hour, "hour (0-23)")
rate_table(df.ts.dt.dayofweek, "dayofweek (0=월)")

# 금액 (USD 환산)
fx = {}
for line in open(WS / "data_work" / "fx_rates_usd.txt"):
    parts = line.rsplit(None, 1)
    fx[parts[0].strip()] = float(parts[1])
df["amt_usd"] = df.amt_paid / df.cur_paid.map(fx)
q = [0.01, 0.25, 0.5, 0.75, 0.99]
print("--- 금액(USD 환산, Amount Paid) 분위수 ---")
print(pd.DataFrame({
    "정상": df.loc[df.laund == 0, "amt_usd"].quantile(q),
    "세탁": df.loc[df.laund == 1, "amt_usd"].quantile(q),
}).to_string(float_format=lambda x: f"{x:,.2f}"))
print()

# 금액 구간별 세탁 비율
bins = [0, 100, 1000, 5000, 20000, 100000, np.inf]
rate_table(pd.cut(df.amt_usd, bins), "USD 금액 구간")

# 라운드 금액 (100 단위 정수)
rate_table(((df.amt_usd % 100 == 0) & (df.amt_usd > 0)).map({True: "라운드", False: "일반"}),
           "라운드 금액(USD 100단위)")
