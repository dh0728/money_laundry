# %% [markdown]
# # HI-Small 패턴 외 자금세탁 언더샘플링 방법 비교 v7
#
# 이 실험은 다음 네 단계를 한 파일에서 수행합니다.
#
# 1. 방법별 정상거래 축약률과 최종 불균형비 측정
# 2. 각 언더샘플링 방법을 다른 방법과 결합하지 않고 단독 적용
# 3. 원래 정상거래 분포와 언더샘플링된 정상거래 분포 비교
# 4. 동일한 LightGBM으로 분류 성능과 피처 중요도 비교
#
# 중요한 원칙:
#
# - 이력 피처는 언더샘플링 전에 전체 과거 거래로 계산합니다.
# - 현재 거래 및 미래 거래는 이력 피처에 포함하지 않습니다.
# - 패턴 자금세탁은 이력 계산에는 포함하고, 모델 학습 행에서만 제외합니다.
# - 양성은 패턴 파일에 없는 `Is Laundering == 1` 거래입니다.
# - 언더샘플링은 학습 정상거래에만 적용합니다.
# - 검증과 테스트는 원래 클래스 비율을 유지합니다.

# %% [markdown]
# ## 0. 라이브러리 설치
#
# 아래 import에서 오류가 발생하면 이 셀의 주석을 해제하고 한 번 실행한 뒤
# 런타임을 재시작합니다.

# %%
# %pip install -q lightgbm imbalanced-learn kagglehub

# %%
import csv
import gc
import json
import shutil
import time
import warnings
from collections import Counter, defaultdict, deque
from io import StringIO
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
import torch
from IPython.display import display
from scipy.spatial.distance import jensenshannon
from scipy.stats import ks_2samp
from sklearn.cluster import KMeans, MiniBatchKMeans
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
)
from sklearn.preprocessing import StandardScaler

try:
    from lightgbm import LGBMClassifier
except ModuleNotFoundError as error:
    raise ModuleNotFoundError(
        "lightgbm이 없습니다. 위 설치 셀에서 "
        "%pip install -q lightgbm 을 실행하세요."
    ) from error

try:
    from imblearn.under_sampling import (
        ClusterCentroids,
        CondensedNearestNeighbour,
        EditedNearestNeighbours,
        NearMiss,
        NeighbourhoodCleaningRule,
        OneSidedSelection,
        RandomUnderSampler,
        RepeatedEditedNearestNeighbours,
        TomekLinks,
    )
except ModuleNotFoundError as error:
    raise ModuleNotFoundError(
        "imbalanced-learn이 없습니다. 위 설치 셀에서 "
        "%pip install -q imbalanced-learn 을 실행하세요."
    ) from error

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)
pd.set_option("display.max_columns", 100)
sns.set_theme(style="whitegrid")

# 외부 서버의 GPU를 PyTorch로 확인하고, 같은 장치 설정을 LightGBM에 전달합니다.
# 이 값은 LightGBM 학습에만 적용되며 sklearn/imblearn 전처리는 CPU에서 실행됩니다.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

print("pandas:", pd.__version__)
print("numpy:", np.__version__)
print("LightGBM 장치:", DEVICE)
if DEVICE == "cuda":
    print("GPU:", torch.cuda.get_device_name(0))

# %% [markdown]
# ## 1. 실험 설정
#
# `pilot`은 셀 실행 방식이 아니라 학습 정상거래 일부만 사용하는 데이터 규모
# 설정입니다. 요청한 전체 실험은 `RUN_MODE="full"`입니다.
#
# 최근접 이웃 방식은 전체 데이터에서 메모리가 부족할 수 있습니다. 한 방법이
# 끝날 때마다 결과를 CSV로 저장하므로, 필요한 경우 `METHODS_TO_RUN`에 한 방법만
# 남기고 셀을 다시 실행할 수 있습니다.

# %%
MODEL_RATIO = "HI"
SIZE = "Small"

RUN_MODE = "full"  # "pilot" 또는 "full"
PILOT_NEGATIVE_N = 100_000
TARGET_NEGATIVE_RATIO = 10
DISTRIBUTION_SAMPLE_N = 100_000

# 논문 CSSMC의 실험 조건을 따라 군집 수를 30으로 둡니다.
# 논문에 후보 subset 반복 횟수가 명확히 제시되지 않아 10개로 고정합니다.
CSSMC_N_CLUSTERS = 30
CSSMC_N_CANDIDATES = 10
CSSMC_KLD_REGULARIZATION = 1e-6

PRIMARY_END = pd.Timestamp("2022-09-11 00:00:00")
TRAIN_END = pd.Timestamp("2022-09-08 00:00:00")
VALID_END = pd.Timestamp("2022-09-09 00:00:00")
ROLLING_WINDOW_NS = int(pd.Timedelta("24h").value)

# Full에서 메모리 부족 가능성이 큰 방법은 필요하면 하나씩 실행하세요.
METHODS_TO_RUN = [
    "NoSampling",
    "RUS",
    "TomekLinks",
    "ENN",
    "RENN",
    "NCR",
    "CNN",
    "OSS",
    "NearMiss1",
    "NearMiss2",
    "NearMiss3",
    "ClusterCentroids",
    "CSSMC_C0_KLD",
    "CSSMC_C1_KS_PSI",
]

DATASET_HANDLE = (
    "ealtman2019/"
    "ibm-transactions-for-anti-money-laundering-aml"
)
DATA_DIR = Path.cwd() / "datasets"
OUTPUT_DIR = Path.cwd() / "outputs" / "undersampling_comparison_v7"
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

RESULT_CSV = OUTPUT_DIR / "undersampling_method_results.csv"
FEATURE_METRIC_CSV = OUTPUT_DIR / "distribution_feature_metrics.csv"
IMPORTANCE_CSV = OUTPUT_DIR / "lightgbm_feature_importance.csv"
CSSMC_CANDIDATE_CSV = OUTPUT_DIR / "cssmc_candidate_scores.csv"

LIGHTGBM_PARAMS = {
    "objective": "binary",
    "device_type": DEVICE,
    "n_estimators": 500,
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": -1,
    "min_child_samples": 20,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.0,
    "reg_lambda": 1.0,
    "class_weight": None,
    "is_unbalance": False,
    "scale_pos_weight": 1.0,
    "random_state": RANDOM_STATE,
    "n_jobs": -1,
    "verbosity": -1,
}

SAMPLING_NUMERIC_FEATURES = [
    "log_amount_paid_usd",
    "is_cross_bank",
    "is_self_transfer",
    "is_weekend",
    "sender_out_txn_count_24h_log",
    "receiver_in_txn_count_24h_log",
    "pair_txn_count_24h_log",
    "is_new_pair",
    "sender_out_amount_sum_24h_usd_log",
    "receiver_in_amount_sum_24h_usd_log",
    "sender_out_degree_24h_log",
    "sender_in_degree_24h_log",
    "receiver_out_degree_24h_log",
    "receiver_in_degree_24h_log",
    "hours_since_sender_prev_log",
    "amount_vs_sender_history_usd",
    "is_new_sender",
]

print("실행 모드:", RUN_MODE)
print("실행 방법:", METHODS_TO_RUN)
print("결과 폴더:", OUTPUT_DIR)

# %% [markdown]
# ## 2. 데이터 파일 준비

# %%
transaction_path = DATA_DIR / f"{MODEL_RATIO}-{SIZE}_Trans.csv"
pattern_path = DATA_DIR / f"{MODEL_RATIO}-{SIZE}_Patterns.txt"

if not transaction_path.exists() or not pattern_path.exists():
    import kagglehub

    for filename in [transaction_path.name, pattern_path.name]:
        destination = DATA_DIR / filename
        if destination.exists():
            continue
        downloaded_path = Path(
            kagglehub.dataset_download(DATASET_HANDLE, path=filename)
        )
        shutil.copy2(downloaded_path, destination)
        print("다운로드 완료:", destination)

for path in [transaction_path, pattern_path]:
    if not path.exists():
        raise FileNotFoundError(path)
    print(path.name, "확인 완료")

# %% [markdown]
# ## 3. 거래와 패턴 파일 로드

# %%
TRANSACTION_COLUMNS = [
    "Timestamp",
    "From Bank",
    "Account",
    "To Bank",
    "Account.1",
    "Amount Received",
    "Receiving Currency",
    "Amount Paid",
    "Payment Currency",
    "Payment Format",
    "Is Laundering",
]

ID_COLUMNS = ["From Bank", "Account", "To Bank", "Account.1"]
AMOUNT_COLUMNS = ["Amount Received", "Amount Paid"]
TEXT_COLUMNS = ["Receiving Currency", "Payment Currency", "Payment Format"]


def normalize_transaction_types(df):
    result = df
    result["Timestamp"] = pd.to_datetime(result["Timestamp"], errors="raise")
    for column in ID_COLUMNS:
        result[column] = result[column].astype("string")
    for column in AMOUNT_COLUMNS:
        result[column] = pd.to_numeric(result[column], errors="raise")
    for column in TEXT_COLUMNS:
        result[column] = result[column].astype("string")
    result["Is Laundering"] = (
        pd.to_numeric(result["Is Laundering"], errors="raise").astype("int8")
    )
    return result


def parse_pattern_file(path, ratio):
    records = []
    current = None
    attempt_number = 0
    transaction_order = 0

    with open(path, mode="r", encoding="utf-8", errors="replace") as file:
        for line_number, raw_line in enumerate(file, start=1):
            line = raw_line.strip()
            if not line:
                continue

            begin_prefix = "BEGIN LAUNDERING ATTEMPT - "
            end_prefix = "END LAUNDERING ATTEMPT - "

            if line.startswith(begin_prefix):
                if current is not None:
                    raise ValueError(f"{line_number}행: attempt 중첩")
                attempt_number += 1
                pattern_text = line[len(begin_prefix):].strip()
                parts = pattern_text.split(":", maxsplit=1)
                current = {
                    "Dataset": ratio,
                    "Attempt ID": f"{ratio}_{attempt_number:04d}",
                    "Attempt Number": attempt_number,
                    "Pattern Type": parts[0].strip().upper(),
                    "Pattern Meta": parts[1].strip() if len(parts) == 2 else "",
                }
                transaction_order = 0
                continue

            if line.startswith(end_prefix):
                if current is None:
                    raise ValueError(f"{line_number}행: BEGIN 없는 END")
                current = None
                transaction_order = 0
                continue

            if current is None:
                raise ValueError(f"{line_number}행: attempt 밖의 거래")

            values = next(csv.reader(StringIO(line)))
            if len(values) != len(TRANSACTION_COLUMNS):
                raise ValueError(
                    f"{line_number}행의 컬럼 수가 {len(values)}개입니다."
                )

            transaction_order += 1
            records.append({
                **current,
                "Transaction Order": transaction_order,
                **dict(zip(TRANSACTION_COLUMNS, values)),
            })

    if current is not None:
        raise ValueError("마지막 attempt에 END가 없습니다.")
    return pd.DataFrame(records)


transaction_dtypes = {column: "string" for column in ID_COLUMNS}

transactions = pd.read_csv(
    transaction_path,
    dtype=transaction_dtypes,
    low_memory=False,
)
transactions = normalize_transaction_types(transactions)

before_duplicate = len(transactions)
transactions = transactions.drop_duplicates().reset_index(drop=True)
print("완전 중복 제거:", f"{before_duplicate - len(transactions):,}건")

patterns = normalize_transaction_types(
    parse_pattern_file(pattern_path, MODEL_RATIO)
)

pattern_hashes = set(
    pd.util.hash_pandas_object(
        patterns[TRANSACTION_COLUMNS], index=False
    ).astype("uint64")
)
transaction_hashes = pd.util.hash_pandas_object(
    transactions[TRANSACTION_COLUMNS], index=False
).astype("uint64")
transactions["is_pattern_transaction"] = transaction_hashes.isin(pattern_hashes)

class_summary = pd.DataFrame({
    "count": {
        "전체 거래": len(transactions),
        "전체 자금세탁": int(transactions["Is Laundering"].eq(1).sum()),
        "패턴 자금세탁": int(
            (
                transactions["is_pattern_transaction"]
                & transactions["Is Laundering"].eq(1)
            ).sum()
        ),
        "패턴 내 0 라벨": int(
            (
                transactions["is_pattern_transaction"]
                & transactions["Is Laundering"].eq(0)
            ).sum()
        ),
        "패턴 외 자금세탁": int(
            (
                ~transactions["is_pattern_transaction"]
                & transactions["Is Laundering"].eq(1)
            ).sum()
        ),
    }
})
display(class_summary)

del patterns, pattern_hashes, transaction_hashes
gc.collect()

# %% [markdown]
# ## 4. USD 환산 및 기본 피처

# %%
UNITS_PER_USD = {
    "US Dollar": 1.0,
    "Euro": 0.8534,
    "Swiss Franc": 0.9150,
    "UK Pound": 0.7742,
    "Yuan": 6.6976,
    "Yen": 105.4000,
    "Rupee": 73.4440,
    "Ruble": 77.8040,
    "Shekel": 3.3770,
    "Saudi Riyal": 3.7511,
    "Canadian Dollar": 1.3193,
    "Australian Dollar": 1.4128,
    "Mexican Peso": 21.1431,
    "Brazil Real": 5.6465,
    "Bitcoin": 0.0000841611,
}


def add_transaction_features(df):
    result = df
    paid_rate = result["Payment Currency"].map(UNITS_PER_USD)
    received_rate = result["Receiving Currency"].map(UNITS_PER_USD)

    if paid_rate.isna().any() or received_rate.isna().any():
        missing = set(result.loc[paid_rate.isna(), "Payment Currency"])
        missing |= set(result.loc[received_rate.isna(), "Receiving Currency"])
        raise ValueError(f"환율표에 없는 통화: {sorted(missing)}")

    result["amount_paid_usd"] = result["Amount Paid"] / paid_rate
    result["amount_received_usd"] = result["Amount Received"] / received_rate
    result["log_amount_paid_usd"] = np.log1p(
        result["amount_paid_usd"].clip(lower=0)
    ).astype("float32")
    result["is_cross_bank"] = (
        result["From Bank"].ne(result["To Bank"]).astype("int8")
    )
    result["is_self_transfer"] = (
        result["From Bank"].eq(result["To Bank"])
        & result["Account"].eq(result["Account.1"])
    ).astype("int8")
    result["is_weekend"] = (
        result["Timestamp"].dt.dayofweek.ge(5).astype("int8")
    )
    return result


# 11일 이후와 초기 잔액 설정 거래는 이력 계산 전에 제외합니다.
history_df = transactions.loc[
    transactions["Timestamp"].lt(PRIMARY_END)
].copy()

reinvestment_table = pd.crosstab(
    history_df["Payment Format"], history_df["Is Laundering"]
)
print("Reinvestment 라벨 점검")
display(reinvestment_table.reindex(["Reinvestment"]).fillna(0).astype(int))

reinvestment_positive = int(
    (
        history_df["Payment Format"].eq("Reinvestment")
        & history_df["Is Laundering"].eq(1)
    ).sum()
)
if reinvestment_positive:
    raise ValueError(
        f"Reinvestment 양성이 {reinvestment_positive:,}건 있어 자동 제외하지 않습니다."
    )

before_reinvestment = len(history_df)
history_df = history_df.loc[
    history_df["Payment Format"].ne("Reinvestment")
].copy()
print("Reinvestment 제외:", f"{before_reinvestment - len(history_df):,}건")

history_df = add_transaction_features(history_df)

del transactions
gc.collect()

# %% [markdown]
# ## 5. 인과적 24시간 롤링·1-hop 피처
#
# 최초 송금에서는 직전 거래시각과 과거 평균금액이 없으므로 결측이 생깁니다.
# `is_new_sender=1`로 그 이유를 표시하고 두 값은 0으로 채웁니다.
#
# 동일한 Timestamp의 거래들은 서로를 과거로 보지 않습니다. 각 Timestamp 묶음의
# 피처를 먼저 계산한 다음 그 묶음을 이력에 추가합니다.

# %%
def _hash_columns(df, columns):
    return pd.util.hash_pandas_object(
        df[columns], index=False
    ).to_numpy(dtype="uint64", copy=False)


def add_causal_24h_graph_features(df, report_every=250_000):
    result = df.copy()
    result["_original_order"] = np.arange(len(result), dtype=np.int64)
    result = result.sort_values(
        ["Timestamp", "_original_order"], kind="mergesort"
    ).reset_index(drop=True)

    n_rows = len(result)
    # pandas 버전에 따라 datetime 내부 단위가 us일 수 있으므로 ns로 명시합니다.
    timestamps = (
        result["Timestamp"]
        .to_numpy(dtype="datetime64[ns]")
        .astype("int64")
    )
    source_nodes = _hash_columns(result, ["From Bank", "Account"])
    target_nodes = _hash_columns(result, ["To Bank", "Account.1"])
    pair_ids = _hash_columns(
        result, ["From Bank", "Account", "To Bank", "Account.1"]
    )
    paid_usd = result["amount_paid_usd"].to_numpy(dtype="float64")
    received_usd = result["amount_received_usd"].to_numpy(dtype="float64")
    log_paid = result["log_amount_paid_usd"].to_numpy(dtype="float64")

    sender_out_count = np.zeros(n_rows, dtype=np.int32)
    receiver_in_count = np.zeros(n_rows, dtype=np.int32)
    pair_count = np.zeros(n_rows, dtype=np.int32)
    sender_out_sum = np.zeros(n_rows, dtype=np.float64)
    receiver_in_sum = np.zeros(n_rows, dtype=np.float64)
    sender_out_degree = np.zeros(n_rows, dtype=np.int32)
    sender_in_degree = np.zeros(n_rows, dtype=np.int32)
    receiver_out_degree = np.zeros(n_rows, dtype=np.int32)
    receiver_in_degree = np.zeros(n_rows, dtype=np.int32)
    hours_since_sender = np.zeros(n_rows, dtype=np.float64)
    amount_vs_sender_history = np.zeros(n_rows, dtype=np.float64)
    is_new_sender = np.zeros(n_rows, dtype=np.int8)
    is_new_pair = np.zeros(n_rows, dtype=np.int8)

    # 24시간 창에 남아 있는 실제 거래와 상대방별 거래 횟수입니다.
    out_events = defaultdict(deque)
    in_events = defaultdict(deque)
    out_counter = defaultdict(Counter)
    in_counter = defaultdict(Counter)
    out_amount_sum = defaultdict(float)
    in_amount_sum = defaultdict(float)

    # 데이터 시작 이후 현재 시각 직전까지의 송금 이력입니다.
    sender_total_count = defaultdict(int)
    sender_total_sum = defaultdict(float)
    sender_last_timestamp = {}
    seen_pairs = set()

    def evict_out(node, cutoff):
        queue = out_events.get(node)
        if not queue:
            return
        counts = out_counter[node]
        while queue and queue[0][0] < cutoff:
            _, counterparty, amount = queue.popleft()
            out_amount_sum[node] -= amount
            counts[counterparty] -= 1
            if counts[counterparty] == 0:
                del counts[counterparty]

    def evict_in(node, cutoff):
        queue = in_events.get(node)
        if not queue:
            return
        counts = in_counter[node]
        while queue and queue[0][0] < cutoff:
            _, counterparty, amount = queue.popleft()
            in_amount_sum[node] -= amount
            counts[counterparty] -= 1
            if counts[counterparty] == 0:
                del counts[counterparty]

    started = time.perf_counter()
    next_report = report_every
    start = 0

    while start < n_rows:
        timestamp = int(timestamps[start])
        end = start + 1
        while end < n_rows and timestamps[end] == timestamp:
            end += 1

        cutoff = timestamp - ROLLING_WINDOW_NS

        # 같은 Timestamp 묶음을 이력에 추가하기 전에 모두 조회합니다.
        for row in range(start, end):
            source = int(source_nodes[row])
            target = int(target_nodes[row])
            pair_id = int(pair_ids[row])

            evict_out(source, cutoff)
            evict_in(source, cutoff)
            evict_out(target, cutoff)
            evict_in(target, cutoff)

            sender_out_count[row] = len(out_events.get(source, ()))
            receiver_in_count[row] = len(in_events.get(target, ()))
            pair_count[row] = out_counter.get(source, {}).get(target, 0)

            sender_out_sum[row] = max(out_amount_sum.get(source, 0.0), 0.0)
            receiver_in_sum[row] = max(in_amount_sum.get(target, 0.0), 0.0)

            sender_out_degree[row] = len(out_counter.get(source, {}))
            sender_in_degree[row] = len(in_counter.get(source, {}))
            receiver_out_degree[row] = len(out_counter.get(target, {}))
            receiver_in_degree[row] = len(in_counter.get(target, {}))

            previous_count = sender_total_count.get(source, 0)
            if previous_count == 0:
                is_new_sender[row] = 1
                hours_since_sender[row] = 0.0
                amount_vs_sender_history[row] = 0.0
            else:
                previous_timestamp = sender_last_timestamp[source]
                hours_since_sender[row] = max(
                    (timestamp - previous_timestamp) / 3_600_000_000_000,
                    0.0,
                )
                previous_mean = sender_total_sum[source] / previous_count
                amount_vs_sender_history[row] = (
                    log_paid[row] - np.log1p(max(previous_mean, 0.0))
                )

            is_new_pair[row] = int(pair_id not in seen_pairs)

        # 조회가 끝난 뒤 같은 Timestamp의 거래를 이력에 추가합니다.
        for row in range(start, end):
            source = int(source_nodes[row])
            target = int(target_nodes[row])
            pair_id = int(pair_ids[row])

            out_events[source].append((timestamp, target, paid_usd[row]))
            in_events[target].append((timestamp, source, received_usd[row]))
            out_counter[source][target] += 1
            in_counter[target][source] += 1
            out_amount_sum[source] += paid_usd[row]
            in_amount_sum[target] += received_usd[row]

            sender_total_count[source] += 1
            sender_total_sum[source] += paid_usd[row]
            sender_last_timestamp[source] = timestamp
            seen_pairs.add(pair_id)

        start = end
        if start >= next_report:
            elapsed = time.perf_counter() - started
            print(
                f"롤링 피처 {start:,}/{n_rows:,}행 "
                f"({start / n_rows:.1%}, {elapsed / 60:.1f}분)"
            )
            next_report += report_every

    result["sender_out_txn_count_24h_log"] = np.log1p(
        sender_out_count
    ).astype("float32")
    result["receiver_in_txn_count_24h_log"] = np.log1p(
        receiver_in_count
    ).astype("float32")
    result["pair_txn_count_24h_log"] = np.log1p(pair_count).astype("float32")
    result["sender_out_amount_sum_24h_usd_log"] = np.log1p(
        sender_out_sum
    ).astype("float32")
    result["receiver_in_amount_sum_24h_usd_log"] = np.log1p(
        receiver_in_sum
    ).astype("float32")
    result["sender_out_degree_24h_log"] = np.log1p(
        sender_out_degree
    ).astype("float32")
    result["sender_in_degree_24h_log"] = np.log1p(
        sender_in_degree
    ).astype("float32")
    result["receiver_out_degree_24h_log"] = np.log1p(
        receiver_out_degree
    ).astype("float32")
    result["receiver_in_degree_24h_log"] = np.log1p(
        receiver_in_degree
    ).astype("float32")
    result["hours_since_sender_prev_log"] = np.log1p(
        hours_since_sender
    ).astype("float32")
    result["amount_vs_sender_history_usd"] = (
        amount_vs_sender_history.astype("float32")
    )
    result["is_new_sender"] = is_new_sender
    result["is_new_pair"] = is_new_pair

    assert result[SAMPLING_NUMERIC_FEATURES].notna().all().all()

    result = result.sort_values("_original_order", kind="mergesort")
    result = result.drop(columns=["_original_order"]).reset_index(drop=True)
    return result


history_df = add_causal_24h_graph_features(history_df)
print("인과적 피처 생성 완료")
display(history_df[SAMPLING_NUMERIC_FEATURES].head())

# %% [markdown]
# ## 6. target 생성과 시간 분할
#
# 피처 생성이 끝난 뒤 패턴 자금세탁 행을 모델 데이터에서 제외합니다.

# %%
pattern_laundering_mask = (
    history_df["is_pattern_transaction"]
    & history_df["Is Laundering"].eq(1)
)
pattern_label0_mask = (
    history_df["is_pattern_transaction"]
    & history_df["Is Laundering"].eq(0)
)

print("모델에서 제외할 패턴 자금세탁:", f"{pattern_laundering_mask.sum():,}건")
print("패턴 파일과 일치하는 0 라벨:", f"{pattern_label0_mask.sum():,}건")

model_df = history_df.loc[~pattern_laundering_mask].copy()
model_df["target"] = (
    model_df["Is Laundering"].eq(1)
    & ~model_df["is_pattern_transaction"]
).astype("int8")
model_df["date"] = model_df["Timestamp"].dt.normalize()
model_df["row_id"] = np.arange(len(model_df), dtype=np.int64)

model_df["split"] = np.select(
    [
        model_df["Timestamp"].lt(TRAIN_END),
        model_df["Timestamp"].lt(VALID_END),
        model_df["Timestamp"].lt(PRIMARY_END),
    ],
    ["train", "valid", "test"],
    default="excluded",
)

split_summary = pd.crosstab(model_df["split"], model_df["target"])
split_summary.columns = ["normal", "outside_laundering"]
display(split_summary)

keep_columns = [
    "row_id",
    "Timestamp",
    "date",
    "split",
    "target",
    *SAMPLING_NUMERIC_FEATURES,
]
model_df = model_df[keep_columns].copy()

train_full = model_df.loc[model_df["split"].eq("train")].copy()
valid_df = model_df.loc[model_df["split"].eq("valid")].copy()
test_df = model_df.loc[model_df["split"].eq("test")].copy()

del history_df, model_df
gc.collect()


def stratified_pilot_sample(train_df, negative_n, random_state):
    positive = train_df.loc[train_df["target"].eq(1)]
    negative = train_df.loc[train_df["target"].eq(0)]
    negative_n = min(int(negative_n), len(negative))
    if negative_n == len(negative):
        return train_df.copy()

    rng = np.random.default_rng(random_state)
    group_sizes = negative.groupby("date", observed=True).size()
    raw_quota = group_sizes / group_sizes.sum() * negative_n
    quota = np.floor(raw_quota).astype(int)
    remaining = negative_n - int(quota.sum())
    if remaining:
        order = (raw_quota - quota).sort_values(ascending=False).index
        for date_value in order[:remaining]:
            quota.loc[date_value] += 1

    selected_indices = []
    for date_value, group in negative.groupby("date", observed=True):
        n_select = min(int(quota.loc[date_value]), len(group))
        if n_select:
            selected_indices.extend(
                rng.choice(group.index.to_numpy(), n_select, replace=False)
            )

    selected_negative = negative.loc[selected_indices]
    return (
        pd.concat([positive, selected_negative], ignore_index=True)
        .sample(frac=1, random_state=random_state)
        .reset_index(drop=True)
    )


if RUN_MODE == "pilot":
    experiment_train = stratified_pilot_sample(
        train_full,
        negative_n=PILOT_NEGATIVE_N,
        random_state=RANDOM_STATE,
    )
elif RUN_MODE == "full":
    experiment_train = train_full.copy()
else:
    raise ValueError("RUN_MODE는 'pilot' 또는 'full'이어야 합니다.")

print("실험 학습 데이터")
display(experiment_train["target"].value_counts().sort_index().to_frame("count"))

# %% [markdown]
# ## 7. 스케일링
#
# 거리 기반 언더샘플러가 특정 단위의 피처에 지배되지 않도록 학습 데이터에서
# StandardScaler를 적합합니다. 동일한 변환을 검증·테스트에도 적용합니다.

# %%
scaler = StandardScaler()
X_train = scaler.fit_transform(
    experiment_train[SAMPLING_NUMERIC_FEATURES]
).astype("float32")
y_train = experiment_train["target"].to_numpy(dtype="int8")

X_valid = scaler.transform(
    valid_df[SAMPLING_NUMERIC_FEATURES]
).astype("float32")
y_valid = valid_df["target"].to_numpy(dtype="int8")

X_test = scaler.transform(
    test_df[SAMPLING_NUMERIC_FEATURES]
).astype("float32")
y_test = test_df["target"].to_numpy(dtype="int8")

train_dates = experiment_train["date"].to_numpy()

print("X_train:", X_train.shape)
print("X_valid:", X_valid.shape)
print("X_test :", X_test.shape)

# %% [markdown]
# ## 8. 언더샘플러 정의
#
# 청소 방식은 남길 정상거래 수를 지정하지 않고 자연스럽게 정리합니다.
# RUS, NearMiss, ClusterCentroids, C0, C1은 양성 1건당 정상거래 10건을 목표로 합니다.
# C0와 C1은 동일한 K-means 군집과 동일한 후보 subset을 공유하고 선택 기준만
# KLD와 KS·PSI로 다르게 적용합니다.

# %%
def make_sampler(method_name, target_negative_n):
    target_strategy = {0: int(target_negative_n)}

    if method_name == "RUS":
        return RandomUnderSampler(
            sampling_strategy=target_strategy,
            random_state=RANDOM_STATE,
            replacement=False,
        )
    if method_name == "TomekLinks":
        return TomekLinks(sampling_strategy="majority", n_jobs=-1)
    if method_name == "ENN":
        return EditedNearestNeighbours(
            sampling_strategy="majority",
            n_neighbors=3,
            kind_sel="all",
            n_jobs=-1,
        )
    if method_name == "RENN":
        return RepeatedEditedNearestNeighbours(
            sampling_strategy="majority",
            n_neighbors=3,
            kind_sel="all",
            max_iter=100,
            n_jobs=-1,
        )
    if method_name == "NCR":
        return NeighbourhoodCleaningRule(
            sampling_strategy="majority",
            n_neighbors=3,
            kind_sel="all",
            threshold_cleaning=0.5,
            n_jobs=-1,
        )
    if method_name == "CNN":
        return CondensedNearestNeighbour(
            sampling_strategy="majority",
            random_state=RANDOM_STATE,
            n_neighbors=1,
            n_jobs=-1,
        )
    if method_name == "OSS":
        return OneSidedSelection(
            sampling_strategy="majority",
            random_state=RANDOM_STATE,
            n_neighbors=1,
            n_seeds_S=1,
            n_jobs=-1,
        )
    if method_name.startswith("NearMiss"):
        version = int(method_name[-1])
        return NearMiss(
            sampling_strategy=target_strategy,
            version=version,
            n_neighbors=3,
            n_jobs=-1,
        )
    if method_name == "ClusterCentroids":
        return ClusterCentroids(
            sampling_strategy=target_strategy,
            random_state=RANDOM_STATE,
            estimator=MiniBatchKMeans(
                n_init=3,
                batch_size=4096,
                random_state=RANDOM_STATE,
            ),
            voting="soft",
        )
    raise KeyError(f"정의되지 않은 방법: {method_name}")


positive_before = int((y_train == 1).sum())
negative_before = int((y_train == 0).sum())
target_negative_n = min(
    negative_before,
    positive_before * TARGET_NEGATIVE_RATIO,
)

print("학습 양성:", f"{positive_before:,}")
print("학습 정상:", f"{negative_before:,}")
print("목표형 방법의 정상거래 수:", f"{target_negative_n:,}")

# %% [markdown]
# ## 9. 분포 보존 및 모델 평가 함수

# %%
def _fixed_random_subset(array, n, random_state):
    if len(array) <= n:
        return array
    rng = np.random.default_rng(random_state)
    indices = rng.choice(len(array), size=n, replace=False)
    return array[indices]


def population_stability_index(reference, sample, bins=10):
    reference = np.asarray(reference, dtype=float)
    sample = np.asarray(sample, dtype=float)
    reference = reference[np.isfinite(reference)]
    sample = sample[np.isfinite(sample)]
    if len(reference) == 0 or len(sample) == 0:
        return np.nan

    unique_reference = np.unique(reference)
    if len(unique_reference) <= 10:
        if len(unique_reference) == 1:
            return 0.0 if np.all(sample == unique_reference[0]) else np.inf
        midpoints = (unique_reference[:-1] + unique_reference[1:]) / 2
        edges = np.r_[-np.inf, midpoints, np.inf]
    else:
        quantiles = np.quantile(reference, np.linspace(0, 1, bins + 1))
        edges = np.unique(quantiles)
        if len(edges) < 3:
            return 0.0
        edges[0] = -np.inf
        edges[-1] = np.inf

    ref_count, _ = np.histogram(reference, bins=edges)
    sample_count, _ = np.histogram(sample, bins=edges)
    epsilon = 1e-6
    ref_ratio = np.clip(ref_count / max(ref_count.sum(), 1), epsilon, None)
    sample_ratio = np.clip(
        sample_count / max(sample_count.sum(), 1), epsilon, None
    )
    return float(np.sum((sample_ratio - ref_ratio) * np.log(sample_ratio / ref_ratio)))


def date_js_divergence(reference_dates, sample_dates):
    if sample_dates is None:
        return np.nan
    categories = np.union1d(np.unique(reference_dates), np.unique(sample_dates))
    reference_ratio = pd.Series(reference_dates).value_counts(normalize=True)
    sample_ratio = pd.Series(sample_dates).value_counts(normalize=True)
    p = reference_ratio.reindex(categories, fill_value=0).to_numpy(dtype=float)
    q = sample_ratio.reindex(categories, fill_value=0).to_numpy(dtype=float)
    return float(jensenshannon(p, q, base=2) ** 2)


def distribution_metrics(
    method_name,
    original_negative,
    sampled_negative,
    original_dates,
    sampled_dates,
):
    original_eval = _fixed_random_subset(
        original_negative, DISTRIBUTION_SAMPLE_N, RANDOM_STATE
    )
    sampled_eval = _fixed_random_subset(
        sampled_negative, DISTRIBUTION_SAMPLE_N, RANDOM_STATE + 1
    )

    rows = []
    for feature_index, feature_name in enumerate(SAMPLING_NUMERIC_FEATURES):
        reference = original_eval[:, feature_index]
        sample = sampled_eval[:, feature_index]
        ks_value = float(
            ks_2samp(reference, sample, method="asymp").statistic
        )
        pooled_std = np.sqrt(
            (np.var(reference, ddof=1) + np.var(sample, ddof=1)) / 2
        )
        smd = 0.0 if pooled_std == 0 else (
            float(np.mean(sample) - np.mean(reference)) / pooled_std
        )
        rows.append({
            "run_mode": RUN_MODE,
            "method": method_name,
            "feature": feature_name,
            "KS": ks_value,
            "abs_SMD": abs(float(smd)),
            "PSI": population_stability_index(reference, sample),
        })

    detail = pd.DataFrame(rows)
    summary = {
        "KS_mean": detail["KS"].mean(),
        "KS_max": detail["KS"].max(),
        "abs_SMD_mean": detail["abs_SMD"].mean(),
        "abs_SMD_max": detail["abs_SMD"].max(),
        "PSI_mean": detail["PSI"].replace([np.inf, -np.inf], np.nan).mean(),
        "PSI_max": detail["PSI"].replace([np.inf, -np.inf], np.nan).max(),
        "date_JSD": date_js_divergence(original_dates, sampled_dates),
    }
    return summary, detail


def gaussian_mean_covariance(values, regularization=1e-6):
    values = np.asarray(values, dtype="float64")
    dimension = values.shape[1]
    mean = values.mean(axis=0)
    covariance = np.cov(values, rowvar=False)
    covariance = covariance + regularization * np.eye(dimension)
    return mean, covariance


def gaussian_kld(reference_mean, reference_cov, sample, regularization=1e-6):
    """다변량 정규분포를 가정한 D_KL(reference || sample)."""
    sample = np.asarray(sample, dtype="float64")
    dimension = sample.shape[1]

    sample_mean = sample.mean(axis=0)
    sample_cov = np.cov(sample, rowvar=False)

    identity = np.eye(dimension, dtype="float64")
    sample_cov = sample_cov + regularization * identity

    sign_reference, logdet_reference = np.linalg.slogdet(reference_cov)
    sign_sample, logdet_sample = np.linalg.slogdet(sample_cov)
    if sign_reference <= 0 or sign_sample <= 0:
        raise np.linalg.LinAlgError("KLD 공분산 행렬식이 양수가 아닙니다.")

    covariance_term = np.trace(
        np.linalg.solve(sample_cov, reference_cov)
    )
    mean_difference = sample_mean - reference_mean
    mean_term = float(
        mean_difference.T
        @ np.linalg.solve(sample_cov, mean_difference)
    )

    value = 0.5 * (
        logdet_sample
        - logdet_reference
        - dimension
        + covariance_term
        + mean_term
    )
    # 부동소수점 오차로 매우 작은 음수가 발생할 수 있습니다.
    return max(float(value), 0.0)


def proportional_cluster_quotas(cluster_labels, target_n, n_clusters):
    counts = np.bincount(cluster_labels, minlength=n_clusters)
    raw_quota = counts / counts.sum() * target_n
    quota = np.floor(raw_quota).astype(int)
    quota = np.minimum(quota, counts)

    remaining = int(target_n - quota.sum())
    fractional_order = np.argsort(-(raw_quota - quota))
    while remaining > 0:
        changed = False
        for cluster_id in fractional_order:
            if quota[cluster_id] < counts[cluster_id]:
                quota[cluster_id] += 1
                remaining -= 1
                changed = True
                if remaining == 0:
                    break
        if not changed:
            raise RuntimeError("CSSMC 군집별 목표 표본 수를 배정할 수 없습니다.")
    return quota


CSSMC_CACHE = None


def prepare_cssmc_candidates():
    """C0와 C1이 공유할 동일한 군집과 후보 subset을 한 번만 생성합니다."""
    global CSSMC_CACHE
    if CSSMC_CACHE is not None:
        return CSSMC_CACHE

    negative_positions = np.flatnonzero(y_train == 0)
    positive_positions = np.flatnonzero(y_train == 1)
    negative_matrix = X_train[negative_positions]

    if target_negative_n >= len(negative_positions):
        selected = np.arange(len(y_train), dtype=np.int64)
        CSSMC_CACHE = {
            "CSSMC_C0_KLD": selected,
            "CSSMC_C1_KS_PSI": selected,
        }
        return CSSMC_CACHE

    print(
        f"CSSMC 공통 K-means 시작: 정상 {len(negative_positions):,}건, "
        f"군집 {CSSMC_N_CLUSTERS}개"
    )
    clustering_started = time.perf_counter()
    kmeans = KMeans(
        n_clusters=CSSMC_N_CLUSTERS,
        n_init=10,
        random_state=RANDOM_STATE,
        algorithm="lloyd",
    )
    cluster_labels = kmeans.fit_predict(negative_matrix)
    print(
        "CSSMC 군집화 완료:",
        f"{(time.perf_counter() - clustering_started) / 60:.2f}분",
    )

    members = [
        negative_positions[cluster_labels == cluster_id]
        for cluster_id in range(CSSMC_N_CLUSTERS)
    ]
    quotas = proportional_cluster_quotas(
        cluster_labels,
        target_negative_n,
        CSSMC_N_CLUSTERS,
    )

    # C1의 후보 비교는 계산량을 제한하기 위해 동일한 원본 정상거래 표본을 씁니다.
    c1_reference = _fixed_random_subset(
        negative_matrix,
        DISTRIBUTION_SAMPLE_N,
        RANDOM_STATE + 10_000,
    )
    c0_reference_mean, c0_reference_cov = gaussian_mean_covariance(
        negative_matrix,
        regularization=CSSMC_KLD_REGULARIZATION,
    )

    candidate_positions = []
    score_rows = []

    for candidate_number in range(CSSMC_N_CANDIDATES):
        seed = RANDOM_STATE + candidate_number
        rng = np.random.default_rng(seed)
        selected_negative_parts = []

        for cluster_id, cluster_members in enumerate(members):
            n_select = int(quotas[cluster_id])
            if n_select:
                selected_negative_parts.append(
                    rng.choice(cluster_members, size=n_select, replace=False)
                )

        selected_negative = np.concatenate(selected_negative_parts)
        rng.shuffle(selected_negative)
        candidate_matrix = X_train[selected_negative]

        kld_value = gaussian_kld(
            c0_reference_mean,
            c0_reference_cov,
            candidate_matrix,
            regularization=CSSMC_KLD_REGULARIZATION,
        )

        ks_values = []
        psi_values = []
        for feature_index in range(len(SAMPLING_NUMERIC_FEATURES)):
            reference_feature = c1_reference[:, feature_index]
            candidate_feature = candidate_matrix[:, feature_index]
            ks_values.append(
                ks_2samp(
                    reference_feature,
                    candidate_feature,
                    method="asymp",
                ).statistic
            )
            psi_values.append(
                population_stability_index(
                    reference_feature,
                    candidate_feature,
                )
            )

        combined_positions = np.concatenate(
            [positive_positions, selected_negative]
        ).astype(np.int64)
        rng.shuffle(combined_positions)
        candidate_positions.append(combined_positions)

        score_rows.append({
            "run_mode": RUN_MODE,
            "candidate": candidate_number,
            "seed": seed,
            "negative_n": len(selected_negative),
            "KLD": kld_value,
            "KS_mean": float(np.mean(ks_values)),
            "KS_max": float(np.max(ks_values)),
            "PSI_mean": float(np.mean(psi_values)),
            "PSI_max": float(np.max(psi_values)),
            "date_JSD": date_js_divergence(
                original_negative_dates,
                train_dates[selected_negative],
            ),
        })
        print(
            f"CSSMC 후보 {candidate_number + 1}/{CSSMC_N_CANDIDATES}: "
            f"KLD={kld_value:.6f}, "
            f"KS={np.mean(ks_values):.6f}, "
            f"PSI={np.mean(psi_values):.6f}"
        )

    scores = pd.DataFrame(score_rows)

    # C1은 KS와 PSI의 단위 차이로 한 지표가 지배하지 않도록 순위합을 사용합니다.
    scores["KS_rank"] = scores["KS_mean"].rank(method="min")
    scores["PSI_rank"] = scores["PSI_mean"].rank(method="min")
    scores["KS_PSI_rank_sum"] = scores["KS_rank"] + scores["PSI_rank"]

    c0_index = int(scores["KLD"].idxmin())
    c1_index = int(
        scores.sort_values(
            ["KS_PSI_rank_sum", "KS_mean", "PSI_mean"],
            kind="mergesort",
        ).index[0]
    )
    scores["selected_C0_KLD"] = False
    scores["selected_C1_KS_PSI"] = False
    scores.loc[c0_index, "selected_C0_KLD"] = True
    scores.loc[c1_index, "selected_C1_KS_PSI"] = True
    scores.to_csv(CSSMC_CANDIDATE_CSV, index=False)

    print("C0 선택 후보:", c0_index)
    print("C1 선택 후보:", c1_index)
    display(scores)

    CSSMC_CACHE = {
        "CSSMC_C0_KLD": candidate_positions[c0_index],
        "CSSMC_C1_KS_PSI": candidate_positions[c1_index],
    }
    return CSSMC_CACHE


def best_f1_threshold(y_true, scores):
    precision, recall, thresholds = precision_recall_curve(y_true, scores)
    if len(thresholds) == 0:
        return 0.5
    denominator = precision[:-1] + recall[:-1]
    f1_values = np.divide(
        2 * precision[:-1] * recall[:-1],
        denominator,
        out=np.zeros_like(denominator),
        where=denominator > 0,
    )
    return float(thresholds[int(np.nanargmax(f1_values))])


def top_k_metrics(y_true, scores, k):
    k = min(int(k), len(scores))
    top_indices = np.argpartition(scores, -k)[-k:]
    true_positive = int(np.asarray(y_true)[top_indices].sum())
    total_positive = int(np.asarray(y_true).sum())
    return {
        f"precision@{k}": true_positive / k,
        f"recall@{k}": true_positive / max(total_positive, 1),
    }


def evaluate_lightgbm(method_name, X_resampled, y_resampled):
    model = LGBMClassifier(**LIGHTGBM_PARAMS)
    started = time.perf_counter()
    model.fit(X_resampled, y_resampled)
    fit_seconds = time.perf_counter() - started

    valid_scores = model.predict_proba(X_valid)[:, 1]
    threshold = best_f1_threshold(y_valid, valid_scores)
    test_scores = model.predict_proba(X_test)[:, 1]
    test_pred = (test_scores >= threshold).astype("int8")

    tn, fp, fn, tp = confusion_matrix(
        y_test, test_pred, labels=[0, 1]
    ).ravel()
    metrics = {
        "model_fit_seconds": fit_seconds,
        "threshold": threshold,
        "PR_AUC": average_precision_score(y_test, test_scores),
        "precision": precision_score(y_test, test_pred, zero_division=0),
        "recall": recall_score(y_test, test_pred, zero_division=0),
        "F1": f1_score(y_test, test_pred, zero_division=0),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }
    for k in [100, 500, 1000]:
        metrics.update(top_k_metrics(y_test, test_scores, k))

    gain = model.booster_.feature_importance(importance_type="gain")
    split = model.booster_.feature_importance(importance_type="split")
    importance = pd.DataFrame({
        "run_mode": RUN_MODE,
        "method": method_name,
        "feature": SAMPLING_NUMERIC_FEATURES,
        "gain": gain,
        "split": split,
    })
    gain_sum = importance["gain"].sum()
    importance["gain_normalized"] = (
        importance["gain"] / gain_sum if gain_sum else 0.0
    )
    importance["gain_rank"] = importance["gain"].rank(
        ascending=False, method="min"
    )
    return metrics, importance


def upsert_csv(new_rows, path, keys):
    new_rows = new_rows.copy()
    if path.exists():
        previous = pd.read_csv(path)
        combined = pd.concat([previous, new_rows], ignore_index=True)
        combined = combined.drop_duplicates(subset=keys, keep="last")
    else:
        combined = new_rows
    combined.to_csv(path, index=False)
    return combined

# %% [markdown]
# ## 10. 방법별 단독 적용 및 즉시 저장

# 한 방법의 실행이 끝날 때마다 결과를 CSV로 저장합니다. Python 예외는 기록하고
# 다음 방법으로 넘어가지만, 운영체제가 프로세스를 종료하는 메모리 부족은 잡을 수
# 없습니다. Full 실행에서 부담이 큰 방법은 `METHODS_TO_RUN`에 하나만 남겨 실행하세요.

# %%
original_negative = X_train[y_train == 0]
original_negative_dates = train_dates[y_train == 0]

all_method_rows = []
all_feature_rows = []
all_importance_rows = []

for method_name in METHODS_TO_RUN:
    print("\n" + "=" * 80)
    print("실행 방법:", method_name)
    print("=" * 80)
    started = time.perf_counter()

    try:
        if method_name == "NoSampling":
            X_resampled = X_train
            y_resampled = y_train
            selected_positions = np.arange(len(y_train))
        elif method_name in {"CSSMC_C0_KLD", "CSSMC_C1_KS_PSI"}:
            cssmc_selections = prepare_cssmc_candidates()
            selected_positions = cssmc_selections[method_name]
            X_resampled = X_train[selected_positions]
            y_resampled = y_train[selected_positions]
        else:
            sampler = make_sampler(method_name, target_negative_n)
            X_resampled, y_resampled = sampler.fit_resample(X_train, y_train)
            selected_positions = getattr(sampler, "sample_indices_", None)

        sampling_seconds = time.perf_counter() - started
        y_resampled = np.asarray(y_resampled, dtype="int8")
        positive_after = int((y_resampled == 1).sum())
        negative_after = int((y_resampled == 0).sum())

        # 양성 거래 보존은 평가 지표가 아니라 필수 무결성 조건입니다.
        if positive_after != positive_before:
            raise AssertionError(
                f"양성 수가 변경됨: {positive_before} -> {positive_after}"
            )

        sampled_negative = np.asarray(X_resampled)[y_resampled == 0]
        sampled_negative_dates = None
        if selected_positions is not None:
            selected_positions = np.asarray(selected_positions, dtype=np.int64)
            selected_y = y_train[selected_positions]
            selected_positive_positions = set(
                selected_positions[selected_y == 1].tolist()
            )
            original_positive_positions = set(
                np.flatnonzero(y_train == 1).tolist()
            )
            if selected_positive_positions != original_positive_positions:
                raise AssertionError("양성 거래 ID 집합이 변경되었습니다.")
            sampled_negative_dates = train_dates[
                selected_positions[selected_y == 0]
            ]

        distribution_summary, distribution_detail = distribution_metrics(
            method_name=method_name,
            original_negative=original_negative,
            sampled_negative=sampled_negative,
            original_dates=original_negative_dates,
            sampled_dates=sampled_negative_dates,
        )
        model_metrics, importance = evaluate_lightgbm(
            method_name,
            np.asarray(X_resampled, dtype="float32"),
            y_resampled,
        )

        method_row = {
            "run_mode": RUN_MODE,
            "method": method_name,
            "status": "success",
            "positive_before": positive_before,
            "positive_after": positive_after,
            "negative_before": negative_before,
            "negative_after": negative_after,
            "negative_reduction_rate_pct": (
                1 - negative_after / max(negative_before, 1)
            ) * 100,
            "negative_per_positive_after": (
                negative_after / max(positive_after, 1)
            ),
            "sampling_seconds": sampling_seconds,
            **distribution_summary,
            **model_metrics,
            "error": "",
        }

        all_method_rows.append(method_row)
        all_feature_rows.append(distribution_detail)
        all_importance_rows.append(importance)

        method_table = upsert_csv(
            pd.DataFrame(all_method_rows),
            RESULT_CSV,
            keys=["run_mode", "method"],
        )
        feature_table = upsert_csv(
            pd.concat(all_feature_rows, ignore_index=True),
            FEATURE_METRIC_CSV,
            keys=["run_mode", "method", "feature"],
        )
        importance_table = upsert_csv(
            pd.concat(all_importance_rows, ignore_index=True),
            IMPORTANCE_CSV,
            keys=["run_mode", "method", "feature"],
        )

        print("정상거래:", f"{negative_before:,} -> {negative_after:,}")
        print("축약률:", f"{method_row['negative_reduction_rate_pct']:.2f}%")
        print("샘플링 시간:", f"{sampling_seconds / 60:.2f}분")
        print("PR-AUC:", f"{method_row['PR_AUC']:.6f}")
        print("결과 저장:", RESULT_CSV)

    except Exception as error:
        failure_row = {
            "run_mode": RUN_MODE,
            "method": method_name,
            "status": "failed",
            "positive_before": positive_before,
            "negative_before": negative_before,
            "sampling_seconds": time.perf_counter() - started,
            "error": repr(error),
        }
        all_method_rows.append(failure_row)
        upsert_csv(
            pd.DataFrame(all_method_rows),
            RESULT_CSV,
            keys=["run_mode", "method"],
        )
        print("실패:", repr(error))
        print("다음 방법으로 진행합니다.")

    finally:
        if method_name != "NoSampling":
            for variable_name in ["sampler", "X_resampled", "y_resampled"]:
                globals().pop(variable_name, None)
        gc.collect()

# %% [markdown]
# ## 11. 결과 비교표

# %%
if RESULT_CSV.exists():
    result_table = pd.read_csv(RESULT_CSV)
    current_result = result_table.loc[
        result_table["run_mode"].eq(RUN_MODE)
    ].copy()

    result_columns = [
        "method",
        "status",
        "negative_before",
        "negative_after",
        "negative_reduction_rate_pct",
        "negative_per_positive_after",
        "sampling_seconds",
        "KS_mean",
        "KS_max",
        "PSI_mean",
        "PSI_max",
        "date_JSD",
        "PR_AUC",
        "precision",
        "recall",
        "F1",
        "precision@100",
        "recall@100",
        "precision@500",
        "recall@500",
        "precision@1000",
        "recall@1000",
        "error",
    ]
    result_columns = [
        column for column in result_columns if column in current_result.columns
    ]
    sort_columns = [
        column for column in ["status", "PR_AUC"]
        if column in current_result.columns
    ]
    ascending = [False] * len(sort_columns)
    display(
        current_result[result_columns]
        .sort_values(sort_columns, ascending=ascending)
        .reset_index(drop=True)
    )

# %% [markdown]
# ## 12. 축약률·분포 보존·PR-AUC 시각화

# %%
if RESULT_CSV.exists():
    plot_df = pd.read_csv(RESULT_CSV)
    plot_df = plot_df.loc[
        plot_df["run_mode"].eq(RUN_MODE)
        & plot_df["status"].eq("success")
    ].copy()

    if not plot_df.empty:
        fig, axes = plt.subplots(1, 3, figsize=(19, 5))

        sns.barplot(
            data=plot_df,
            x="method",
            y="negative_reduction_rate_pct",
            ax=axes[0],
            color="steelblue",
        )
        axes[0].set_title("정상거래 축약률")
        axes[0].set_ylabel("축약률 (%)")
        axes[0].tick_params(axis="x", rotation=60)

        sns.barplot(
            data=plot_df,
            x="method",
            y="KS_mean",
            ax=axes[1],
            color="darkorange",
        )
        axes[1].set_title("정상거래 분포 차이: 평균 KS")
        axes[1].set_ylabel("KS (작을수록 원본과 유사)")
        axes[1].tick_params(axis="x", rotation=60)

        sns.barplot(
            data=plot_df,
            x="method",
            y="PR_AUC",
            ax=axes[2],
            color="seagreen",
        )
        axes[2].set_title("LightGBM 테스트 PR-AUC")
        axes[2].set_ylabel("PR-AUC")
        axes[2].tick_params(axis="x", rotation=60)

        plt.tight_layout()
        plt.show()

# %% [markdown]
# ## 13. 피처 중요도 안정성
#
# 여러 방법에서 반복해서 상위에 나타나는 피처와 샘플링 방법에 따라 순위가 크게
# 바뀌는 피처를 확인합니다.

# %%
if IMPORTANCE_CSV.exists():
    importance_all = pd.read_csv(IMPORTANCE_CSV)
    importance_current = importance_all.loc[
        importance_all["run_mode"].eq(RUN_MODE)
    ].copy()

    if not importance_current.empty:
        importance_stability = importance_current.groupby("feature").agg(
            method_count=("method", "nunique"),
            gain_mean=("gain_normalized", "mean"),
            gain_std=("gain_normalized", "std"),
            rank_mean=("gain_rank", "mean"),
            rank_std=("gain_rank", "std"),
            top5_count=("gain_rank", lambda values: int((values <= 5).sum())),
        ).sort_values(["top5_count", "gain_mean"], ascending=[False, False])

        print("언더샘플링 방법별 LightGBM 피처 중요도 안정성")
        display(importance_stability)

        top_features = importance_stability.head(15).index
        importance_pivot = importance_current.loc[
            importance_current["feature"].isin(top_features)
        ].pivot(index="feature", columns="method", values="gain_normalized")

        plt.figure(figsize=(14, 8))
        sns.heatmap(importance_pivot, cmap="YlGnBu", annot=True, fmt=".3f")
        plt.title("언더샘플링 방법별 LightGBM Gain 중요도")
        plt.xlabel("언더샘플링 방법")
        plt.ylabel("피처")
        plt.tight_layout()
        plt.show()

# %% [markdown]
# ## 결과 해석 기준
#
# - `negative_reduction_rate_pct`가 높을수록 정상거래 축약 효과가 큽니다.
# - `KS`, `PSI`, `date_JSD`는 작을수록 원래 정상거래 분포와 유사합니다.
# - 청소 방식은 목표 비율까지 줄이는 방법이 아니므로 축약률이 낮아도 알고리즘
#   오류가 아닙니다.
# - 방법 단독 적용 실험이므로 청소 후 RUS를 추가하지 않았습니다.
# - PR-AUC와 Precision@K는 언더샘플링하지 않은 9~10일 테스트에서 해석합니다.
# - Full에서 메모리 부족으로 실패한 방법은 대용량 확장성이 부족한 것으로 별도
#   기록하고, 필요하면 Pilot 결과만 참고합니다.
