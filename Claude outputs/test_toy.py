import pandas as pd
from alert_grouping import run, evaluate, Params

rows, n = [], 0
def tx(day, src, dst, usd, score, att=None):
    global n; n += 1
    rows.append(dict(tx_id=n, ts=pd.Timestamp("2026-09-01") + pd.Timedelta(days=day), src=src, dst=dst, usd=usd, score=score, attempt_id=att))

# attempt 1: FAN-OUT A -> B1..B5, 8일간
for i, d in enumerate([0, 2, 3, 3.5, 8]): tx(d, "A", f"B{i}", 9000 + i * 500, 1.0, 1)
# attempt 2: CYCLE C1->C2->C3->C4->C1, 홉 간격 2~4일, 금액 조금씩 감소
for i, (d, amt) in enumerate([(1, 50000), (3, 48500), (7, 47000), (10, 46000)]): tx(d, f"C{i}", f"C{(i+1)%4}", amt, 1.0, 2)
# attempt 3, 4: 허브 H를 같이 지남 (서로 무관) -> 합쳐지면 안 됨
tx(4, "X1", "H", 7000, 1.0, 3); tx(3.8, "X2", "X1", 7100, 1.0, 3)
tx(4.5, "H", "Y1", 6900, 1.0, 4); tx(5, "Y1", "Y2", 6800, 1.0, 4)
# attempt 5, 6: 비허브 계좌 Z 공유, 금액이 전혀 다름 -> 약한 다리 1개
for i in range(3): tx(12 + i, f"P{i}", "Z", 3000, 1.0, 5)
tx(16, "Z", "Q1", 250000, 1.0, 6); tx(17, "Q1", "Q2", 249000, 1.0, 6)
# attempt 7: STACK인데 체인 3개가 서로 안 이어짐 (large_eda 샘플과 같은 구조)
for k in range(3): tx(20 + k, f"S{k}a", f"S{k}b", 5000, 1.0, 7); tx(22 + k, f"S{k}b", f"S{k}c", 5100, 1.0, 7)
# 정상 거래: H를 허브로 만드는 거래 + 세탁 계좌의 평범한 거래
for i in range(60): tx(i % 25, "H", f"N{i}", 100 + i, 0.0)
for i in range(5): tx(i * 2, "A", f"M{i}", 120, 0.0)

df = pd.DataFrame(rows)
truth = df.dropna(subset=["attempt_id"])[["tx_id", "attempt_id"]]
members, hubs = run(df.drop(columns="attempt_id"), Params(hub_degree=50))
print("hubs:", hubs)
out = members.merge(df[["tx_id", "src", "dst", "attempt_id"]], on="tx_id")
print(out.sort_values(["group_id", "tx_id"]).to_string(index=False))
print(evaluate(members, truth))

# 증분 갱신: CYCLE 앞 2건이 이미 OPEN Alert 77에 있다고 가정
cyc = df[df.attempt_id == 2].tx_id.tolist()
m2, _ = run(df.drop(columns="attempt_id"), Params(hub_degree=50), anchors={cyc[0]: 77, cyc[1]: 77})
print(m2[m2.group_id == "ALERT-77"].to_string(index=False))
