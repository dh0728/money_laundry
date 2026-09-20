"""묶음 알고리즘 프로토타입: 거래별 점수 -> Alert(거래 묶음).
입력 tx: DataFrame[tx_id, ts(datetime64), src, dst, usd, score]  (+ 평가용 attempt_id)
"""
import math
from collections import defaultdict
from dataclasses import dataclass
import pandas as pd


@dataclass
class Params:
    t_seed: float = 0.9        # 시드 임계
    t_low: float = 0.5         # 지원 풀 임계 (운영에선 score_pct 기준 권장)
    w_days: float = 14.0       # 인접 거래 간 최대 gap
    strong: float = 0.55       # 강한 링크 1개면 합류
    mid: float = 0.30          # 중간 링크 2개 이상이면 합류
    hub_degree: int = 50       # 전체 원장 기준 상대 계좌 수가 이 이상이면 허브
    max_pool_per_acct: int = 200  # 한 계좌의 풀 거래가 이 이상이면 허브 취급
    max_tx: int = 200
    max_span_days: float = 90.0


def find_hubs(ledger: pd.DataFrame, p: Params) -> set:
    """전체 원장(정상 포함)에서 상대 계좌 수로 허브 판정."""
    out_deg = ledger.groupby("src")["dst"].nunique()
    in_deg = ledger.groupby("dst")["src"].nunique()
    deg = out_deg.add(in_deg, fill_value=0)
    return set(deg[deg >= p.hub_degree].index)


def build_links(pool: pd.DataFrame, hubs: set, p: Params) -> dict:
    """거래<->거래 링크. 반환: {tx_id: [(other_tx_id, weight, link_type, via_account)]}"""
    by_acct = defaultdict(list)                      # 계좌 -> [(ts, tx_id, 'OUT'|'IN')]
    for r in pool.itertuples():
        if r.src == r.dst:
            continue
        by_acct[r.src].append((r.ts, r.tx_id, "OUT"))
        by_acct[r.dst].append((r.ts, r.tx_id, "IN"))
    info = pool.set_index("tx_id")[["usd", "score"]].to_dict("index")
    links = defaultdict(list)
    w_sec = p.w_days * 86400
    for acct, evs in by_acct.items():
        if acct in hubs or len(evs) > p.max_pool_per_acct:
            continue                                  # 허브 가드
        evs.sort()
        for i, (ta, a, da) in enumerate(evs):
            for tb, b, db in evs[i + 1:]:
                gap = (tb - ta).total_seconds()
                if gap > w_sec:
                    break
                if da == "IN" and db == "OUT":        # 받은 뒤 보냄
                    ltype = "CHAIN"
                    amt = math.exp(-abs(math.log((info[a]["usd"] + 1) / (info[b]["usd"] + 1))))
                elif da == db:                        # 같은 방향 형제
                    ltype, amt = ("SIB_IN" if da == "IN" else "SIB_OUT"), 0.8
                else:                                 # 보낸 뒤 받음: 자금 흐름 아님
                    continue
                w = (1 - gap / w_sec * 0.5) * amt * math.sqrt(info[a]["score"] * info[b]["score"])
                links[a].append((b, w, ltype, acct))
                links[b].append((a, w, ltype, acct))
    return links


def grow_groups(pool: pd.DataFrame, links: dict, p: Params, anchors: dict | None = None):
    """영역 확장. anchors = {tx_id: 기존 OPEN alert_id}. 반환: members DataFrame."""
    ts = pool.set_index("tx_id")["ts"].to_dict()
    score = pool.set_index("tx_id")["score"].to_dict()
    assigned, rows = {}, []

    def grow(gid, start):
        members = list(start)
        cand = defaultdict(list)                      # 후보 tx -> [(w, from_tx, ltype, acct)]
        def push(m):
            for o, w, lt, ac in links.get(m, []):
                if o not in assigned:
                    cand[o].append((w, m, lt, ac))
        for m in members:
            push(m)
        while cand and len(members) < p.max_tx:
            best, best_key = None, None
            for c, ls in cand.items():
                ws = sorted((l[0] for l in ls), reverse=True)
                ok = ws[0] >= p.strong or sum(1 for w in ws if w >= p.mid) >= 2
                if ok and (best_key is None or ws[0] > best_key):
                    best, best_key = c, ws[0]
            if best is None:
                break
            t_all = [ts[m] for m in members] + [ts[best]]
            if (max(t_all) - min(t_all)).total_seconds() > p.max_span_days * 86400:
                cand.pop(best)
                continue
            w, frm, lt, ac = max(cand.pop(best))
            assigned[best] = gid
            members.append(best)
            rows.append(dict(group_id=gid, tx_id=best, role="SUPPORTING" if score[best] < p.t_seed else "MEMBER",
                             link_type=lt, link_from_tx_id=frm, link_weight=round(w, 3), via_account=ac))
            push(best)

    # 1) 기존 OPEN Alert부터 확장 (증분 갱신)
    if anchors:
        by_alert = defaultdict(list)
        for t, aid in anchors.items():
            by_alert[aid].append(t)
            assigned[t] = f"ALERT-{aid}"
        for aid, ms in by_alert.items():
            grow(f"ALERT-{aid}", ms)
    # 2) 남은 시드를 점수 높은 순으로
    seeds = pool[pool.score >= p.t_seed].sort_values(["score", "ts"], ascending=[False, True])
    n = 0
    for s in seeds.tx_id:
        if s in assigned:
            continue
        n += 1
        gid = f"NEW-{n}"
        assigned[s] = gid
        rows.append(dict(group_id=gid, tx_id=s, role="SEED", link_type="SEED",
                         link_from_tx_id=None, link_weight=None, via_account=None))
        grow(gid, [s])
    return pd.DataFrame(rows)


def run(ledger: pd.DataFrame, p: Params = Params(), anchors=None):
    hubs = find_hubs(ledger, p)
    pool = ledger[ledger.score >= p.t_low]
    links = build_links(pool, hubs, p)
    return grow_groups(pool, links, p, anchors), hubs


def evaluate(members: pd.DataFrame, truth: pd.DataFrame):
    """truth: DataFrame[tx_id, attempt_id] (세탁 거래만)."""
    m = members.merge(truth, on="tx_id", how="left")
    t = truth.merge(members[["tx_id", "group_id"]], on="tx_id", how="left")
    coverage = t.group_id.notna().mean()                          # 정답 거래 중 Alert에 들어간 비율
    purity = m.attempt_id.notna().mean()                          # Alert 거래 중 진짜 세탁 비율
    frag = t.dropna(subset=["group_id"]).groupby("attempt_id").group_id.nunique()
    merge = m.dropna(subset=["attempt_id"]).groupby("group_id").attempt_id.nunique()
    return dict(coverage=round(coverage, 3), purity=round(purity, 3),
                groups_per_attempt=round(frag.mean(), 2), split_rate=round((frag > 1).mean(), 3),
                merge_rate=round((merge > 1).mean(), 3), n_groups=members.group_id.nunique())
