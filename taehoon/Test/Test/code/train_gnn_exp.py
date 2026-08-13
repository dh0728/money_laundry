# -*- coding: utf-8 -*-
"""1단계 GNN 피처 변형 실험 스크립트.

train_gnn.py 기반, 피처 구성을 환경변수로 바꿔 실험하기 위한 버전.
모델/학습 설정(2-layer GraphSAGE hidden64, fanout [10,5], 1:10 서브샘플링,
BCE pos_weight, epoch별 전체 valid AP 모델 선택, 임계값 valid F1 최대, test 1회)은
모든 실험에서 동일하게 고정하고 피처만 변경한다.

환경변수:
  EXP_NAME          실험 이름 (산출 디렉터리 results/experiments/{EXP_NAME}/)
  DATASETS          콤마 구분 (기본 "hi,li")
  EPOCHS            기본 20
  DROP_NODE=1       노드 피처 전체를 0으로 (구조+엣지 피처만 사용)
  DROP_EDGE=1       엣지 피처 전체를 0으로 (구조+노드 피처만 사용)
  EDGE_NUM_EXCLUDE  제외할 엣지 수치 피처 콤마 목록
  EDGE_CAT_EXCLUDE  제외할 엣지 범주 피처 콤마 목록
  NODE_FEATS        사용할 노드 피처만 콤마 목록 (미지정 시 9개 전부)
  MODEL             sage(기본) | gine (엣지 피처를 메시지 패싱에 반영) | pna (PNAConv, 논문 최고 GNN)
  HIDDEN_DIM        기본 64
  FANOUT            기본 "10,5"
  SEED              기본 42
  TIME_FREQ=1       계좌쌍/계좌 시간·빈도 피처 추가 (과거만, 누수 없음):
                    pair_prior_count, pair_dt, pair_cnt_1h/24h,
                    src_dt, src_cnt_1h/24h, dst_dt, dst_cnt_1h/24h (10개)
  CURR_Z=1          통화별 robust z-score 금액 피처 추가 (train 통화별
                    log1p 금액 중앙값/IQR, ±8 클립 — 통화 스케일 차이 정규화)

산출: results/experiments/{EXP_NAME}/metrics_{ds}.json, config.json
"""
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch_geometric.nn import GINEConv, PNAConv, SAGEConv

BASE = Path(__file__).resolve().parents[2]
DATA = BASE / "data" / "processed"

# ----------------------------- 실험 설정 -----------------------------
EXP_NAME = os.environ.get("EXP_NAME", "debug")
DATASETS = os.environ.get("DATASETS", "hi,li").split(",")
DS_SUFFIX = os.environ.get("DS_SUFFIX", "small")  # small | medium
EPOCHS = int(os.environ.get("EPOCHS", "20"))
DROP_NODE = bool(os.environ.get("DROP_NODE"))
DROP_EDGE = bool(os.environ.get("DROP_EDGE"))
EDGE_NUM_EXCLUDE = set(filter(None, os.environ.get("EDGE_NUM_EXCLUDE", "").split(",")))
EDGE_CAT_EXCLUDE = set(filter(None, os.environ.get("EDGE_CAT_EXCLUDE", "").split(",")))
NODE_FEATS_SEL = list(filter(None, os.environ.get("NODE_FEATS", "").split(",")))

OUT = BASE / "results" / "experiments" / EXP_NAME
OUT.mkdir(parents=True, exist_ok=True)

HIDDEN = int(os.environ.get("HIDDEN_DIM", "64"))
FANOUTS = tuple(int(x) for x in os.environ.get("FANOUT", "10,5").split(","))
MODEL = os.environ.get("MODEL", "sage")  # sage | gine
BATCH = 2048
EVAL_BATCH = 4096
LR = 1e-3
SUB_RATIO = 10  # 세탁:정상 = 1:10
SEED = int(os.environ.get("SEED", "42"))
TIME_FREQ = bool(os.environ.get("TIME_FREQ"))
CURR_Z = bool(os.environ.get("CURR_Z"))
CURR_USD = bool(os.environ.get("CURR_USD"))
PATTERN = bool(os.environ.get("PATTERN"))
CYCLE = bool(os.environ.get("CYCLE"))
PASSTHRU = bool(os.environ.get("PASSTHRU"))
CHAIN = bool(os.environ.get("CHAIN"))
MUTUAL = bool(os.environ.get("MUTUAL"))
DISTINCT = bool(os.environ.get("DISTINCT"))
PAIRAGG = bool(os.environ.get("PAIRAGG"))
HOP2 = bool(os.environ.get("HOP2"))
HOP2TOV = bool(os.environ.get("HOP2TOV"))
PAIRREL = bool(os.environ.get("PAIRREL"))
SMOKE = bool(os.environ.get("SMOKE"))
DEVICE = torch.device(
    os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
)

EDGE_NUM_ALL = [
    "log1p_amount_paid",
    "is_exchange",
    "is_self_transfer",
    "hour_sin",
    "hour_cos",
    "dayofweek",
]
EDGE_CAT_ALL = ["payment_format", "receiving_currency", "payment_currency"]
NODE_NUM_ALL = [
    "log1p_in_degree",
    "log1p_out_degree",
    "log1p_total_sent",
    "log1p_total_received",
    "log1p_tx_count",
    "log1p_self_transfer_count",
    "n_currencies",
    "n_payment_formats",
    "net_flow_log1p",
]

EDGE_NUM = [c for c in EDGE_NUM_ALL if c not in EDGE_NUM_EXCLUDE]
EDGE_CAT = [c for c in EDGE_CAT_ALL if c not in EDGE_CAT_EXCLUDE]
NODE_NUM = NODE_FEATS_SEL if NODE_FEATS_SEL else NODE_NUM_ALL


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------- 샘플러 (train_gnn.py와 동일) -----------------------------
def build_csr(src, dst, eid, num_nodes):
    """엣지 u->v 를 중심노드 v 기준 CSR로 변환. eid는 각 방향 엣지의 원본 거래 행 번호."""
    src = np.asarray(src, dtype=np.int64)
    dst = np.asarray(dst, dtype=np.int64)
    eid = np.asarray(eid, dtype=np.int64)
    order = np.argsort(dst, kind="stable")
    su, sv, se = src[order], dst[order], eid[order]
    indptr = np.zeros(num_nodes + 1, dtype=np.int64)
    np.add.at(indptr, sv + 1, 1)
    indptr = np.cumsum(indptr)
    return torch.from_numpy(indptr), torch.from_numpy(su), torch.from_numpy(se)


class NeighborSampler:
    """2-hop fanout 이웃 샘플러. 배치 내 시드 엣지 쌍(정/역방향)을 샘플링에서 제외."""

    def __init__(self, indptr, indices, eid, num_nodes, fanouts, seed=0):
        self.indptr = indptr.to(DEVICE)
        self.indices = indices.to(DEVICE)
        self.eid = eid.to(DEVICE)  # CSR 위치 -> 원본 거래 행 (엣지 피처 조회용)
        self.deg = (self.indptr[1:] - self.indptr[:-1])
        self.E = int(indices.numel())
        self.N = num_nodes
        self.fanouts = fanouts
        self.gen = torch.Generator(device=DEVICE).manual_seed(seed)
        self.map = torch.full((num_nodes,), -1, dtype=torch.long, device=DEVICE)

    def _hop(self, centers, fanout):
        M = centers.numel()
        deg = self.deg[centers]
        start = self.indptr[centers]
        r = torch.randint(0, 2**62, (M, fanout), generator=self.gen, device=DEVICE)
        pos = start.unsqueeze(1) + (r % deg.clamp(min=1).unsqueeze(1))
        pos = pos.clamp(max=self.E - 1)
        nbr = self.indices[pos]
        valid = (deg > 0).unsqueeze(1).expand(-1, fanout)
        u = nbr[valid]
        v = centers.unsqueeze(1).expand(-1, fanout)[valid]
        p = pos[valid]
        return u, v, p

    def sample_batch(self, s_src, s_dst):
        N = self.N
        s_src = s_src.to(DEVICE)
        s_dst = s_dst.to(DEVICE)
        L0 = torch.unique(torch.cat([s_src, s_dst]))
        u1, v1, p1 = self._hop(L0, self.fanouts[0])
        L1 = torch.unique(u1) if u1.numel() else torch.empty(0, dtype=torch.long, device=DEVICE)
        if L1.numel():
            u2, v2, p2 = self._hop(L1, self.fanouts[1])
        else:
            u2 = v2 = p2 = torch.empty(0, dtype=torch.long, device=DEVICE)
        key = torch.cat([s_src * N + s_dst, s_dst * N + s_src])
        if u1.numel():
            m1 = ~torch.isin(u1 * N + v1, key)
            u1, v1, p1 = u1[m1], v1[m1], p1[m1]
        if u2.numel():
            m2 = ~torch.isin(u2 * N + v2, key)
            u2, v2, p2 = u2[m2], v2[m2], p2[m2]
        n_id = torch.unique(torch.cat([L0, u1, L1, u2]))
        self.map.fill_(-1)
        self.map[n_id] = torch.arange(n_id.numel(), dtype=torch.long, device=DEVICE)
        ei = torch.stack([torch.cat([u1, u2]), torch.cat([v1, v2])])
        ei_local = self.map[ei]
        ea = self.eid[torch.cat([p1, p2])]  # 샘플링 엣지별 원본 거래 행
        return n_id, ei_local, self.map[s_src], self.map[s_dst], ea


# ----------------------------- 모델 -----------------------------
class EdgeGNN(nn.Module):
    """GraphSAGE 인코더. 엣지 피처는 메시지 패싱에 쓰지 않고 분류 헤드에서만 사용."""

    def __init__(self, n_node_feats, n_edge_feats, hidden=HIDDEN, dropout=0.2):
        super().__init__()
        self.conv1 = SAGEConv(n_node_feats, hidden)
        self.conv2 = SAGEConv(hidden, hidden)
        self.head = nn.Sequential(
            nn.Linear(2 * hidden + n_edge_feats, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 1),
        )

    def forward(self, x, edge_index, edge_attr, seed_src, seed_dst, edge_feat):
        h = F.relu(self.conv1(x, edge_index))
        h = self.conv2(h, edge_index)
        z = torch.cat([h[seed_src], h[seed_dst], edge_feat], dim=1)
        return self.head(z).squeeze(-1)


class EdgeGINE(nn.Module):
    """GINE 인코더. 메시지 패싱 시 이웃 노드 임베딩에 엣지 피처를 더해 반영."""

    def __init__(self, n_node_feats, n_edge_feats, hidden=HIDDEN, dropout=0.2):
        super().__init__()
        mlp1 = nn.Sequential(
            nn.Linear(n_node_feats, hidden), nn.ReLU(), nn.Linear(hidden, hidden)
        )
        mlp2 = nn.Sequential(
            nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, hidden)
        )
        self.conv1 = GINEConv(mlp1, edge_dim=n_edge_feats)
        self.conv2 = GINEConv(mlp2, edge_dim=n_edge_feats)
        self.head = nn.Sequential(
            nn.Linear(2 * hidden + n_edge_feats, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 1),
        )

    def forward(self, x, edge_index, edge_attr, seed_src, seed_dst, edge_feat):
        h = F.relu(self.conv1(x, edge_index, edge_attr))
        h = self.conv2(h, edge_index, edge_attr)
        z = torch.cat([h[seed_src], h[seed_dst], edge_feat], dim=1)
        return self.head(z).squeeze(-1)


class EdgePNA(nn.Module):
    """PNA 인코더 (PDF 보고서: 논문 최고 GNN). 엣지 피처는 분류 헤드에서만 사용."""

    AGG = ["mean", "min", "max", "std"]
    SCL = ["identity", "amplification", "attenuation"]

    def __init__(self, n_node_feats, n_edge_feats, deg_hist, hidden=HIDDEN, dropout=0.2):
        super().__init__()
        kw = dict(aggregators=self.AGG, scalers=self.SCL, deg=deg_hist, towers=1, pre_layers=1, post_layers=1)
        self.conv1 = PNAConv(n_node_feats, hidden, **kw)
        self.conv2 = PNAConv(hidden, hidden, **kw)
        self.head = nn.Sequential(
            nn.Linear(2 * hidden + n_edge_feats, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 1),
        )

    def forward(self, x, edge_index, edge_attr, seed_src, seed_dst, edge_feat):
        h = F.relu(self.conv1(x, edge_index))
        h = self.conv2(h, edge_index)
        z = torch.cat([h[seed_src], h[seed_dst], edge_feat], dim=1)
        return self.head(z).squeeze(-1)


# -------------------- 시간/빈도 피처 (songAi·PDF 보고서 이식) --------------------
def _group_feats(key, ts):
    """(key, ts) 정렬 후 과거만 사용하는 그룹 내 피처.

    반환: prior_cnt(그룹 내 과거 건수), dt(직전 이벤트와의 간격, 없으면 -1),
    cnt_1h, cnt_24h. 모두 자기 자신 제외 → 어떤 split에서도 누수 없음.
    """
    order = np.lexsort((ts, key))
    k, t = key[order], ts[order].astype(np.int64)
    # int64 오버플로 방지: ts를 0 기준으로 shift (key*C 곱셈 여유 확보)
    if len(t):
        t = t - t.min()
    idx = np.arange(len(t))
    newg = np.r_[True, k[1:] != k[:-1]]
    gstart = np.maximum.accumulate(np.where(newg, idx, 0))
    prior_cnt = idx - gstart
    prev_t = np.r_[t[0], t[:-1]]
    dt = np.where(newg, np.int64(-1), t - prev_t)
    feats = [prior_cnt.astype(np.float64), dt.astype(np.float64)]
    # t는 그룹 내에서만 정렬 → key*C를 더해 전역 정렬 배열로 만든 뒤 searchsorted
    # (C > max_ts + window 이면 k*C + t - w 가 이전 그룹 영역에 들어가지 않음)
    c = np.int64(t.max()) + 1441 if len(t) else np.int64(1)
    kc = k.astype(np.int64) * c
    t2 = kc + t
    for w in (60, 1440):
        j = np.searchsorted(t2, kc + (t - np.int64(w)), side="left")
        feats.append((idx - j).astype(np.float64))
    out = [np.empty(len(t), np.float64) for _ in feats]
    for o, r in zip(out, feats):
        o[order] = r
    return out


def compute_timefreq_feats(ts_min, src, dst, n_nodes):
    """계좌쌍/계좌 시간·빈도 피처 10개 (float32 [E,10])."""
    pair_pc, pair_dt, pair_c1, pair_c24 = _group_feats(src * n_nodes + dst, ts_min)
    _, src_dt, src_c1, src_c24 = _group_feats(src, ts_min)
    _, dst_dt, dst_c1, dst_c24 = _group_feats(dst, ts_min)
    cols = [
        np.log1p(pair_pc),              # pair_prior_count (log)
        np.log1p(pair_dt + 2),          # pair_dt (분, 없음 -1 → +2 후 log)
        np.log1p(pair_c1), np.log1p(pair_c24),
        np.log1p(src_dt + 2),
        np.log1p(src_c1), np.log1p(src_c24),
        np.log1p(dst_dt + 2),
        np.log1p(dst_c1), np.log1p(dst_c24),
    ]
    return np.stack(cols, axis=1).astype(np.float32)


def compute_currency_z(df, tr_mask):
    """통화별 robust z-score: train의 통화별 log1p 금액 중앙값/IQR, ±8 클립."""
    tr = df.loc[tr_mask, ["payment_currency", "log1p_amount_paid"]]
    g = tr.groupby("payment_currency")["log1p_amount_paid"]
    stats = g.agg(["median", lambda s: s.quantile(0.75) - s.quantile(0.25)])
    stats.columns = ["med", "iqr"]
    stats["iqr"] = stats["iqr"].clip(lower=1e-3)
    gmed, giqr = stats["med"].median(), stats["iqr"].median()
    cur = df["payment_currency"]
    med = cur.map(stats["med"]).fillna(gmed).to_numpy(np.float32)
    iqr = cur.map(stats["iqr"]).fillna(giqr).to_numpy(np.float32)
    z = (df["log1p_amount_paid"].to_numpy(np.float32) - med) / iqr
    return np.clip(z, -8, 8).astype(np.float32).reshape(-1, 1)


def compute_currency_usd(df, tr_mask):
    """USD 환산 금액 (PDF §2-1): train의 환전 거래에서 통화쌍 중앙값 비율을 구하고
    BFS로 전 통화의 USD 환산율 도출 → log1p(amount_paid × 환산율)."""
    from collections import deque
    tr = df.loc[tr_mask]
    fx = tr[tr["payment_currency"] != tr["receiving_currency"]].copy()
    fx["_paid"] = np.expm1(fx["log1p_amount_paid"])
    ratio = fx.groupby(["payment_currency", "receiving_currency"]).apply(
        lambda g: (g["amount_received"] / g["_paid"]).median()
    )
    adj = {}
    for (a, b), r in ratio.items():
        adj.setdefault(a, []).append((b, float(r)))
    usd = {"US Dollar": 1.0}
    q = deque(["US Dollar"])
    while q:
        a = q.popleft()
        for b, r in adj.get(a, []):
            if b not in usd:
                usd[b] = usd[a] * r
                q.append(b)
    cur = df["payment_currency"]
    rate = cur.map(usd).fillna(1.0).to_numpy(np.float64)
    amt = np.expm1(df["log1p_amount_paid"].to_numpy(np.float64))
    return np.log1p(amt * rate).astype(np.float32).reshape(-1, 1)


# -------------------- 패턴 피처 (논문 GFP 근사 구현) --------------------
def _window_sum(key, ts, val, w):
    """그룹(key) 내 과거 w분 윈도우의 val 합 (자기 자신 제외, 누수 없음)."""
    order = np.lexsort((ts, key))
    k, t, v = key[order], ts[order].astype(np.int64), val[order].astype(np.float64)
    if len(t):
        t = t - t.min()
    prefix = np.concatenate([[0.0], np.cumsum(v)])
    idx = np.arange(1, len(t) + 1)  # prefix 인덱스 (자기 포함 위치)
    c = np.int64(t.max()) + 1441 if len(t) else np.int64(1)
    kc = k.astype(np.int64) * c
    t2 = kc + t
    j = np.searchsorted(t2, kc + (t - np.int64(w)), side="left")
    win = prefix[idx - 1] - prefix[j]  # 자기 제외: idx-1까지의 누적
    out = np.empty(len(t), np.float64)
    out[order] = win
    return out


def compute_pattern_feats(ts_min, src, dst, n_nodes):
    """GFP 근사 패턴 피처 8개 (float32 [E,8]). 전부 과거만 사용.

    - rpair_pc/rpair_dt: 역방향(v→u) 거래 이력 (1-hop 왕복/사이클 신호)
    - newcp_src_1h/24h: 송신자의 신규 거래상대 수 (scatter 신호)
    - newcp_dst_1h/24h: 수신자의 신규 송신자 수 (gather 신호)
    - cycle2_pc/cycle2_dt: 2-hop 왕복 경로(u→w→v와 v→w→u 이력 공존) 근사로
      (u,v) 쌍과 (v,u) 쌍 모두 이력이 있는 '왕복 쌍' 내 빈도/간격
    """
    # 역방향 쌍 이력
    rpair_pc, rpair_dt, _, _ = _group_feats(dst * n_nodes + src, ts_min)
    # 신규 상대 플래그: (u,v) 쌍 첫 거래 여부
    pair_pc, pair_dt, _, _ = _group_feats(src * n_nodes + dst, ts_min)
    new_pair = (pair_pc == 0).astype(np.float64)
    # 송신자 기준 신규 수신자 수 (scatter), 수신자 기준 신규 송신자 수 (gather)
    nsrc_1h = _window_sum(src, ts_min, new_pair, 60)
    nsrc_24h = _window_sum(src, ts_min, new_pair, 1440)
    ndst_1h = _window_sum(dst, ts_min, new_pair, 60)
    ndst_24h = _window_sum(dst, ts_min, new_pair, 1440)
    # 왕복 쌍(사이클 근사): 양방향 모두 이력 있는 경우의 과거 왕복 횟수
    cycle_pc = np.minimum(pair_pc, rpair_pc)
    # 마지막 왕복 완성 시점과의 간격: 두 방향 중 최근 활동 기준 (없으면 -1)
    inf = np.int64(2**62)
    cycle_dt = np.minimum(
        np.where(pair_dt < 0, inf, pair_dt), np.where(rpair_dt < 0, inf, rpair_dt)
    )
    cycle_dt = np.where(cycle_dt == inf, np.int64(-1), cycle_dt)
    cols = [
        np.log1p(rpair_pc),
        np.log1p(rpair_dt + 2),
        np.log1p(nsrc_1h), np.log1p(nsrc_24h),
        np.log1p(ndst_1h), np.log1p(ndst_24h),
        np.log1p(cycle_pc),
        np.log1p(cycle_dt + 2),
    ]
    return np.stack(cols, axis=1).astype(np.float32)



# ----------------------------- 데이터 준비 -----------------------------
def build_edge_features(df, train_cols=None, num_stats=None):
    if EDGE_NUM:
        X_num = df[EDGE_NUM].astype(np.float32).to_numpy()
        if num_stats is None:
            mu = X_num.mean(axis=0)
            sd = X_num.std(axis=0)
            sd[sd < 1e-6] = 1.0
            num_stats = (mu, sd)
        mu, sd = num_stats
        X_num = (X_num - mu) / sd
        parts = [X_num]
    else:
        parts = []
    if EDGE_CAT:
        X_cat = pd.get_dummies(df[EDGE_CAT].astype(str), dtype=np.float32)
        if train_cols is None:
            train_cols = X_cat.columns
        else:
            X_cat = X_cat.reindex(columns=train_cols, fill_value=np.float32(0.0))
        parts.append(X_cat.to_numpy(np.float32))
    else:
        train_cols = pd.Index([])
    X = np.concatenate(parts, axis=1) if parts else np.zeros((len(df), 0), np.float32)
    return X, train_cols, num_stats if EDGE_NUM else None


def load_node_features(ds):
    nf = pd.read_parquet(DATA / f"node_features_{ds}_{DS_SUFFIX}.parquet")
    nf["net_flow_log1p"] = np.sign(nf["net_flow"]) * np.log1p(np.abs(nf["net_flow"]))
    cols = NODE_NUM
    out = {}
    stats = None
    for s in ("train", "valid", "test"):
        part = nf.loc[nf["split"] == s].sort_values("node_id")
        X = part[cols].astype(np.float32).to_numpy()
        if s == "train":
            mu = X.mean(axis=0)
            sd = X.std(axis=0)
            sd[sd < 1e-6] = 1.0
            stats = (mu, sd)
        mu, sd = stats
        out[s] = torch.from_numpy((X - mu) / sd).float().to(DEVICE)
    n_nodes = int(nf["node_id"].max()) + 1
    del nf
    return out, n_nodes


def prepare_dataset(ds):
    log(f"===== {ds.upper()}-{DS_SUFFIX.capitalize()} 로드 ({EXP_NAME}) =====")
    cols = list(
        dict.fromkeys(
            ["from_id", "to_id", "is_self_transfer", "is_laundering", "split"]
            + EDGE_NUM
            + EDGE_CAT
            + (["timestamp"] if (TIME_FREQ or PATTERN) else [])
            + (["payment_currency", "log1p_amount_paid"] if CURR_Z else [])
            + (["payment_currency", "receiving_currency", "amount_received",
                "log1p_amount_paid"] if CURR_USD else [])
        )
    )
    df = pd.read_parquet(DATA / f"edges_{ds}_{DS_SUFFIX}.parquet", columns=cols)
    if SMOKE:
        df = pd.concat(
            [
                df[df["split"] == "train"].sample(n=400_000, random_state=SEED),
                df[df["split"] == "valid"].sample(n=150_000, random_state=SEED),
                df[df["split"] == "test"].sample(n=60_000, random_state=SEED),
            ]
        ).reset_index(drop=True)
        log(f"SMOKE 모드: {len(df):,}행으로 축소")

    X_nf, n_nodes = load_node_features(ds)
    if DROP_NODE:
        for s in X_nf:
            X_nf[s] = torch.zeros_like(X_nf[s])
        log("노드 피처 DROP (0 텐서)")

    feat_npy = os.environ.get("FEAT_NPY")
    if feat_npy:
        mm = np.load(feat_npy, mmap_mode="r")
        n_edge_feats = mm.shape[1]
        feat = torch.from_numpy(np.asarray(mm)).to(DEVICE)
        log(f"사전계산 피처 행렬 사용: {feat.shape}")
    else:
        tr_mask = (df["split"] == "train").to_numpy()
        X_all, cat_cols, num_stats = build_edge_features(df.loc[tr_mask])
        n_edge_feats = X_all.shape[1]
        feat = np.empty((len(df), n_edge_feats), dtype=np.float32)
        feat[tr_mask] = X_all
        for s in ("valid", "test"):
            m = (df["split"] == s).to_numpy()
            feat[m], _, _ = build_edge_features(
                df.loc[m], train_cols=cat_cols, num_stats=num_stats
            )
        # --- 추가 피처: 시간/빈도(누수 없음) + 통화 robust z ---
        extra_parts = []
        if TIME_FREQ:
            ts_min = (df["timestamp"].astype("int64") // 60_000_000_000).to_numpy(np.int64)
            t0 = time.time()
            tf = compute_timefreq_feats(
                ts_min, df["from_id"].to_numpy(np.int64), df["to_id"].to_numpy(np.int64), n_nodes
            )
            mu, sd = tf[tr_mask].mean(axis=0), tf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((tf - mu) / sd).astype(np.float32))
            log(f"시간/빈도 피처 10개 추가 ({time.time()-t0:.1f}s)")
        if CURR_Z:
            extra_parts.append(compute_currency_z(df, tr_mask))
            log("통화 robust z 피처 1개 추가")
        if CURR_USD:
            extra_parts.append(compute_currency_usd(df, tr_mask))
            log("USD 환산 금액 피처 1개 추가")
        if PATTERN:
            t0 = time.time()
            ts_min_p = (df["timestamp"].astype("int64") // 60_000_000_000).to_numpy(np.int64)
            pf = compute_pattern_feats(
                ts_min_p, df["from_id"].to_numpy(np.int64), df["to_id"].to_numpy(np.int64), n_nodes
            )
            mu, sd = pf[tr_mask].mean(axis=0), pf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((pf - mu) / sd).astype(np.float32))
            log(f"패턴 피처 8개 추가 ({time.time()-t0:.1f}s)")
        if CYCLE:
            cyc = pd.read_parquet(DATA / f"cycle3_{ds}_{DS_SUFFIX}.parquet")
            cf = np.log1p(cyc.to_numpy(np.float64)).astype(np.float32)  # c3_24h, c3_1w
            if SMOKE and len(cf) != len(df):
                raise RuntimeError("SMOKE 모드에서는 CYCLE 캐시를 사용할 수 없음")
            mu, sd = cf[tr_mask].mean(axis=0), cf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((cf - mu) / sd).astype(np.float32))
            log(f"사이클 피처 {cf.shape[1]}개 추가 (캐시 로드)")
        if PASSTHRU:
            pt = pd.read_parquet(DATA / f"passthru_{ds}_{DS_SUFFIX}.parquet")
            ptf = pt.to_numpy(np.float32)
            if len(ptf) != len(df):
                raise RuntimeError("passthru 캐시와 엣지 수 불일치")
            mu, sd = ptf[tr_mask].mean(axis=0), ptf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((ptf - mu) / sd).astype(np.float32))
            log(f"자금통과 피처 {ptf.shape[1]}개 추가 (캐시 로드)")
        if CHAIN:
            ch = pd.read_parquet(DATA / f"chain_{ds}_{DS_SUFFIX}.parquet")
            chf = ch.to_numpy(np.float32)
            if len(chf) != len(df):
                raise RuntimeError("chain 캐시와 엣지 수 불일치")
            mu, sd = chf[tr_mask].mean(axis=0), chf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((chf - mu) / sd).astype(np.float32))
            log(f"체인/버스트 피처 {chf.shape[1]}개 추가 (캐시 로드)")
        if MUTUAL:
            mtf = pd.read_parquet(DATA / f"mutual_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(mtf) != len(df):
                raise RuntimeError("mutual 캐시와 엣지 수 불일치")
            mu, sd = mtf[tr_mask].mean(axis=0), mtf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((mtf - mu) / sd).astype(np.float32))
            log(f"상호거래 피처 {mtf.shape[1]}개 추가 (캐시 로드)")
        if DISTINCT:
            dcf = pd.read_parquet(DATA / f"distinct_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(dcf) != len(df):
                raise RuntimeError("distinct 캐시와 엣지 수 불일치")
            mu, sd = dcf[tr_mask].mean(axis=0), dcf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((dcf - mu) / sd).astype(np.float32))
            log(f"고유상대방 피처 {dcf.shape[1]}개 추가 (캐시 로드)")
        if PAIRAGG:
            paf = pd.read_parquet(DATA / f"pairagg_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(paf) != len(df):
                raise RuntimeError("pairagg 캐시와 엣지 수 불일치")
            mu, sd = paf[tr_mask].mean(axis=0), paf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((paf - mu) / sd).astype(np.float32))
            log(f"쌍 집계 피처 {paf.shape[1]}개 추가 (캐시 로드)")
        if HOP2:
            h2f = pd.read_parquet(DATA / f"hop2_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(h2f) != len(df):
                raise RuntimeError("hop2 캐시와 엣지 수 불일치")
            mu, sd = h2f[tr_mask].mean(axis=0), h2f[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((h2f - mu) / sd).astype(np.float32))
            log(f"2-hop 고정집계 피처 {h2f.shape[1]}개 추가 (캐시 로드)")
        if HOP2TOV:
            h2tf = pd.read_parquet(DATA / f"hop2tov_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(h2tf) != len(df):
                raise RuntimeError("hop2tov 캐시와 엣지 수 불일치")
            mu, sd = h2tf[tr_mask].mean(axis=0), h2tf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((h2tf - mu) / sd).astype(np.float32))
            log(f"2-hop TOV(train+valid) 고정집계 피처 {h2tf.shape[1]}개 추가 (캐시 로드)")
        if PAIRREL:
            prf = pd.read_parquet(DATA / f"pairrel_{ds}_{DS_SUFFIX}.parquet").to_numpy(np.float32)
            if len(prf) != len(df):
                raise RuntimeError("pairrel 캐시와 엣지 수 불일치")
            mu, sd = prf[tr_mask].mean(axis=0), prf[tr_mask].std(axis=0)
            sd[sd < 1e-6] = 1.0
            extra_parts.append(((prf - mu) / sd).astype(np.float32))
            log(f"쌍 상대 피처 {prf.shape[1]}개 추가 (캐시 로드)")
        if extra_parts:
            feat = np.concatenate([feat] + extra_parts, axis=1)
            n_edge_feats = feat.shape[1]
        feat = torch.from_numpy(feat).to(DEVICE)
    if DROP_EDGE:
        feat = torch.zeros_like(feat)
        log("엣지 피처 DROP (0 텐서)")
    log(f"엣지 피처: {n_edge_feats}개 | 노드 피처: {X_nf['train'].shape[1]}개")

    src = df["from_id"].to_numpy(np.int64)
    dst = df["to_id"].to_numpy(np.int64)
    y = df["is_laundering"].to_numpy(np.int8)
    is_self = df["is_self_transfer"].astype(np.int8).to_numpy()
    split = df["split"].to_numpy()
    del df
    if not os.environ.get("FEAT_NPY"):
        del X_all

    def ctx_mask(splits):
        return np.isin(split, splits) & (is_self == 0)

    graphs = {}
    for name, splits in (("train", ["train"]), ("test", ["train", "valid"])):
        m = ctx_mask(splits)
        s_, d_ = src[m], dst[m]
        row = np.flatnonzero(m)  # 원본 거래 행 번호
        bi_src = np.concatenate([s_, d_])
        bi_dst = np.concatenate([d_, s_])
        bi_eid = np.concatenate([row, row])  # 역방향 엣지도 같은 거래의 피처 사용
        graphs[name] = build_csr(bi_src, bi_dst, bi_eid, n_nodes)
        log(f"{name} 컨텍스트 그래프: 방향 엣지 {len(bi_src):,}")
    graphs["valid"] = graphs["train"]

    seeds = {}
    for s in ("train", "valid", "test"):
        idx = np.flatnonzero(split == s)
        seeds[s] = {
            "idx": idx,
            "src": torch.from_numpy(src[idx]),
            "dst": torch.from_numpy(dst[idx]),
            "y": y[idx],
        }
        log(f"타겟 {s}: {len(idx):,}건 (세탁 {y[idx].sum():,})")
    del src, dst, y, is_self, split
    return seeds, feat, X_nf, graphs, n_nodes, n_edge_feats


def subsample_train(seeds, ratio=SUB_RATIO, seed=SEED):
    y = seeds["train"]["y"]
    rng = np.random.default_rng(seed)
    pos = np.flatnonzero(y == 1)
    neg = np.flatnonzero(y == 0)
    take = rng.choice(neg, size=min(len(pos) * ratio, len(neg)), replace=False)
    sel = np.concatenate([pos, take])
    rng.shuffle(sel)
    return sel


# ----------------------------- 학습/평가 -----------------------------
@torch.no_grad()
def infer_probs(model, sampler, X_node, seeds_part, feat, batch_size=EVAL_BATCH):
    model.eval()
    idx = seeds_part["idx"]
    n = len(idx)
    probs = np.empty(n, dtype=np.float64)
    for st in range(0, n, batch_size):
        b = slice(st, min(st + batch_size, n))
        n_id, ei, sl, dl, ea = sampler.sample_batch(
            seeds_part["src"][b], seeds_part["dst"][b]
        )
        logits = model(X_node[n_id], ei, feat[ea], sl, dl,
                       feat[torch.from_numpy(idx[b]).to(DEVICE)])
        probs[b] = torch.sigmoid(logits).cpu().numpy()
    return probs


def eval_at(y_true, prob, thr):
    pred = (prob >= thr).astype(int)
    return {
        "AP": float(average_precision_score(y_true, prob)),
        "ROC_AUC": float(roc_auc_score(y_true, prob)),
        "F1": float(f1_score(y_true, pred, zero_division=0)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true, pred, labels=[0, 1]).tolist(),
    }


def run_dataset(ds):
    t_start = time.time()
    seeds, feat, X_nf, graphs, n_nodes, n_edge_feats = prepare_dataset(ds)

    sel = subsample_train(seeds)
    n_pos = int((seeds["train"]["y"] == 1).sum())
    pos_weight = torch.tensor((len(sel) - n_pos) / max(n_pos, 1), dtype=torch.float32)
    log(f"학습 타겟: {len(sel):,}건, pos_weight={pos_weight.item():.1f}")

    yv = seeds["valid"]["y"]

    sampler_train = NeighborSampler(*graphs["train"], n_nodes, FANOUTS, seed=SEED)
    sampler_valid = NeighborSampler(*graphs["valid"], n_nodes, FANOUTS, seed=SEED + 1)
    sampler_test = NeighborSampler(*graphs["test"], n_nodes, FANOUTS, seed=SEED + 2)

    if MODEL == "gine":
        model = EdgeGINE(X_nf["train"].shape[1], n_edge_feats).to(DEVICE)
    elif MODEL == "pna":
        deg_hist = torch.bincount(sampler_train.deg.to(torch.long).cpu())
        model = EdgePNA(X_nf["train"].shape[1], n_edge_feats, deg_hist).to(DEVICE)
    else:
        model = EdgeGNN(X_nf["train"].shape[1], n_edge_feats).to(DEVICE)
    log(f"모델: {MODEL}, hidden={HIDDEN}, fanout={FANOUTS}")
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    crit = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(DEVICE))

    t_src, t_dst = seeds["train"]["src"], seeds["train"]["dst"]
    t_y = torch.from_numpy(seeds["train"]["y"].astype(np.float32)).to(DEVICE)
    t_idx = torch.from_numpy(seeds["train"]["idx"]).to(DEVICE)

    history = []
    best_ap, best_state, best_epoch = -1.0, None, -1
    for ep in range(1, EPOCHS + 1):
        t0 = time.time()
        model.train()
        perm = torch.randperm(len(sel), generator=torch.Generator().manual_seed(SEED + ep))
        tot_loss, nb = 0.0, 0
        for st in range(0, len(sel), BATCH):
            bidx = sel[perm[st : st + BATCH].numpy()]
            bt = torch.from_numpy(np.ascontiguousarray(bidx)).to(DEVICE)
            n_id, ei, sl, dl, ea = sampler_train.sample_batch(t_src[bidx], t_dst[bidx])
            logits = model(X_nf["train"][n_id], ei, feat[ea], sl, dl, feat[t_idx[bt]])
            loss = crit(logits, t_y[bt])
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot_loss += loss.item()
            nb += 1
        train_loss = tot_loss / max(nb, 1)
        pv = infer_probs(model, sampler_valid, X_nf["valid"], seeds["valid"], feat)
        ap = average_precision_score(yv, pv)
        history.append(
            {"epoch": ep, "train_loss": train_loss, "valid_AP": float(ap),
             "seconds": round(time.time() - t0, 1)}
        )
        log(f"epoch {ep}: loss={train_loss:.4f} | valid AP={ap:.4f} | {time.time()-t0:.0f}s")
        if ap > best_ap:
            best_ap = ap
            best_epoch = ep
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    log(f"best epoch={best_epoch} (valid AP={best_ap:.4f})")
    model.load_state_dict(best_state)
    torch.save(
        {"state_dict": best_state, "config": {
            "hidden": HIDDEN, "fanouts": FANOUTS, "n_node_feats": X_nf["train"].shape[1],
            "n_edge_feats": n_edge_feats, "best_epoch": best_epoch}},
        OUT / f"gnn_{ds}_best.pt",
    )

    pv_full = infer_probs(model, sampler_valid, X_nf["valid"], seeds["valid"], feat)
    prec, rec, thr = precision_recall_curve(yv, pv_full)
    f1 = 2 * prec * rec / np.clip(prec + rec, 1e-12, None)
    i = int(np.argmax(f1[:-1]))
    threshold = float(thr[i])

    yt = seeds["test"]["y"]
    pt_full = infer_probs(model, sampler_test, X_nf["test"], seeds["test"], feat)

    res = {
        "exp_name": EXP_NAME,
        "dataset": ds,
        "threshold": threshold,
        "best_epoch": best_epoch,
        "n_train_targets": int(len(sel)),
        "history": history,
        "valid": eval_at(yv, pv_full, threshold),
        "test": eval_at(yt, pt_full, threshold),
        "total_seconds": round(time.time() - t_start, 1),
    }
    log(
        f"{ds.upper()} 최종: valid AP={res['valid']['AP']:.4f} F1={res['valid']['F1']:.4f} | "
        f"test AP={res['test']['AP']:.4f} F1={res['test']['F1']:.4f} | "
        f"총 {res['total_seconds']:.0f}s"
    )
    with open(OUT / f"metrics_{ds}.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    del seeds, feat, X_nf, graphs
    return res


def main():
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    log(f"DEVICE={DEVICE}")
    config = {
        "exp_name": EXP_NAME,
        "datasets": DATASETS,
        "ds_suffix": DS_SUFFIX,
        "epochs": EPOCHS,
        "drop_node": DROP_NODE,
        "drop_edge": DROP_EDGE,
        "edge_num": EDGE_NUM,
        "edge_cat": EDGE_CAT,
        "node_feats": NODE_NUM,
        "time_freq": TIME_FREQ,
        "curr_z": CURR_Z,
        "curr_usd": CURR_USD,
        "pattern": PATTERN,
        "cycle": CYCLE,
        "passthru": PASSTHRU,
        "model": MODEL,
        "hidden": HIDDEN, "fanouts": list(FANOUTS), "batch": BATCH,
        "lr": LR, "sub_ratio": SUB_RATIO, "seed": SEED, "smoke": SMOKE,
    }
    with open(OUT / "config.json", "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    for ds in DATASETS:
        run_dataset(ds)
    log(f"완료: {EXP_NAME}")


if __name__ == "__main__":
    main()
