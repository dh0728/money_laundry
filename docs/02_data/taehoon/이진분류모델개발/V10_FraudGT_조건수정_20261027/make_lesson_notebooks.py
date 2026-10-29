"""Reorganize both notebooks like the user's short-cell CNN assignment."""
from configure import configure
ROOT, _ = configure('lesson_notebook_generation')
import ast
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
import nbformat as nbf
from corrected_runtime import source_manifest

REFERENCE = Path('/workspace/실습/opencv_활용_cnn모델링 과제 최최종.ipynb')
TARGETS = [
    ('disjoint', Path('/workspace/handoff/V10_FraudGT_전체실행_20261027/V10_FraudGT_전체실행/V10_FraudGT_실습형.ipynb')),
    ('shared', Path('/workspace/handoff/V10_FraudGT_공유그래프_20261027/V10_FraudGT_공유그래프_실습형.ipynb')),
]
STAMP = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def saved_options(path):
    values = {}
    for cell in nbf.read(path, as_version=4).cells:
        if cell.cell_type != 'code':
            continue
        try:
            tree = ast.parse(cell.source)
        except SyntaxError:
            continue
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                try:
                    values[node.targets[0].id] = ast.literal_eval(node.value)
                except (ValueError, TypeError):
                    pass
    return values


def build(mode, destination):
    options = saved_options(destination)
    cells = []
    def md(source):
        cells.append(nbf.v4.new_markdown_cell(source.strip()))
    def code(source, tag=None):
        cell = nbf.v4.new_code_cell(source.strip())
        if tag:
            cell.metadata['tags'] = [tag]
        cells.append(cell)

    name = '개별 그래프' if mode == 'disjoint' else '공유그래프'
    md(f'''# V10 이진분류 모델링 — {name}

`실습/opencv_활용_cnn모델링 과제 최최종.ipynb`처럼 데이터 준비부터 학습·결과 확인까지 짧은 셀로 진행합니다.

1. 데이터와 입력 크기 확인
2. 그래프 DataLoader와 모델 구조 확인
3. 콜백을 연결하고 학습
4. epoch 결과 표와 loss·ACC·탐지율 그래프 확인
5. best 모델의 검증 거래 예측 확인

**실습형은 거래별 개별 그래프 비교용, 공유형은 2,048건 배치 전체 공유용입니다.** 목표는 Precision≥70%, Recall≥65%입니다.''')
    md('''## 1. 라이브러리와 실행 설정

기존 V10 캐시와 검증된 학습 코드를 연결합니다. 화면용 반복 코드는 공통 도우미에 두었습니다. 아래 셀은 경로 연결만 수행합니다.''')
    code('''from pathlib import Path
import sys

PACKAGE_NAME = "V10_FraudGT_조건수정_20261027"
candidates = []
for parent in [Path.cwd(), *Path.cwd().parents]:
    candidates.extend([parent / PACKAGE_NAME, parent / "handoff" / PACKAGE_NAME])
PACKAGE_ROOT = next((p for p in candidates if (p / "lesson_runtime.py").is_file()), None)
if PACKAGE_ROOT is None:
    raise FileNotFoundError("handoff/V10_FraudGT_조건수정_20261027 폴더를 확인하세요.")
PACKAGE_ROOT = PACKAGE_ROOT.resolve()
for module_name in ("configure", "fraudgt_lab"):
    loaded = sys.modules.get(module_name)
    if loaded is not None and not Path(loaded.__file__).resolve().is_relative_to(PACKAGE_ROOT):
        raise RuntimeError("다른 버전이 메모리에 있습니다. 커널을 재시작하세요.")
sys.path.insert(0, str(PACKAGE_ROOT))
from configure import configure''')
    code(f'''# 학습 실행 여부와 저장 위치
RUN_NAME = "{mode}_corrected_001"
RUN_TRAINING = {options.get('RUN_TRAINING', False)!r}
FOLLOW_ACTIVE_TRAINING = {options.get('FOLLOW_ACTIVE_TRAINING', False)!r}
GRAPH_MODE = "{mode}"
RESOURCE_PROFILE = {options.get('RESOURCE_PROFILE', 'memory_safe')!r}
REFRESH_SECONDS = {options.get('REFRESH_SECONDS', 2)!r}
SHOW_DETAILS = False

EXPERIMENT_ROOT, RUN_ROOT = configure(RUN_NAME)
print("실행 폴더:", RUN_ROOT)''', 'lesson-settings')
    md('### 현재 학습 그래프 먼저 보기\n\n저장된 학습 기록을 바로 확인합니다. 학습 중 별도 조회가 필요하면 조건수정 폴더의 V10_FraudGT_공유그래프_진행조회.ipynb를 실행하세요.')
    code('''import importlib
import notebook_display
importlib.reload(notebook_display)
from notebook_display import show_saved_training

progress_viewer = show_saved_training(RUN_ROOT)''', 'live-chart-preview')
    md('기본 Python 3 커널에서도 실제 이웃 추출을 먼저 확인합니다. 라이브러리 설치 전의 오류가 남아 있으면 해당 커널을 재시작하고 첫 셀부터 실행하세요.')
    code('''from notebook_environment import check_sampling_backend

backend_info = check_sampling_backend(GRAPH_MODE)
for name, value in backend_info.items():
    print(f"{name}: {value}")''', 'sampling-backend-check')
    code('''import json
import random
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import torch
from dataclasses import asdict, replace
from IPython.display import display

from fraudgt_lab.config import TrainConfig, VARIANTS, FORMAT_NAMES
from fraudgt_lab.population import ASSETS, Labels, prepare_population
from fraudgt_lab.official_loader import PeriodGraph
from fraudgt_lab.data import FeatureAdapter
from fraudgt_lab.models import FraudGT, FraudGTBlock, make_model
from fraudgt_lab.optimization import class_weighted_loss, make_optimizer
from fraudgt_lab.training import run_variant, sample_next, finish_evaluation
from corrected_runtime import prepare, require_verification, run_lock
from notebook_display import training_is_active, follow_training, read_result_json
from lesson_runtime import LearningCallbacks, history_frame, predict_examples, show_implementation''')
    md('공식 비교에 사용하던 값을 유지합니다. 조건을 바꾸는 실험은 새 `RUN_NAME`으로 구분합니다.')
    code('''SEED = 42
BATCH_SIZE = 2048
EPOCHS = 500
BATCHES_PER_EPOCH = 256
LEARNING_RATE = 0.001
POSITIVE_WEIGHT = 6.0
MODEL_NAMES = list(VARIANTS)
MODEL_NAME = MODEL_NAMES[0]  # 구조·기록·예측을 확인할 모델

workers, threads = (18, 24) if RESOURCE_PROFILE == "official" else (0, 2)
CONFIG = TrainConfig(
    graph_mode=GRAPH_MODE, seed=SEED, epochs=EPOCHS,
    seed_batch=BATCH_SIZE, iterations_per_epoch=BATCHES_PER_EPOCH,
    base_lr=LEARNING_RATE, positive_weight=POSITIVE_WEIGHT,
    loader_workers=workers, torch_threads=threads,
)''')
    code('''random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.set_num_threads(CONFIG.torch_threads)
require_verification()

print("PyTorch:", torch.__version__)
print("CUDA:", torch.cuda.is_available())
print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "없음")
print("그래프:", GRAPH_MODE, "| batch:", BATCH_SIZE, "| epochs:", EPOCHS)
print("epoch 요청 거래:", BATCH_SIZE * BATCHES_PER_EPOCH)''')
    md('''## 2. 데이터 준비

이미 전처리한 V10 캐시를 사용합니다. 거래는 시간순 약60/20/20으로 분할되어 있습니다. 큰 배열은 mmap으로 열어 필요한 행만 읽습니다.''')
    code('''DATA_DIR = ASSETS
OUTPUT_DIR = RUN_ROOT
MODEL_DIR = OUTPUT_DIR / "models"

split_record = prepare_population()
split_df = pd.DataFrame(split_record["windows"]).T
split_df[["start", "end", "rows"]]''')
    code('''train_ids = np.load(DATA_DIR / "train_ids.npy", mmap_mode="r")
val_ids = np.load(DATA_DIR / "val_ids.npy", mmap_mode="r")
test_ids = np.load(DATA_DIR / "test_ids.npy", mmap_mode="r")

len(train_ids), len(val_ids), len(test_ids)''')
    md('계좌 피처19종, 거래 수치14종과 결제방식1종을 사용합니다. 결제방식은8열 one-hot이므로 거래 입력은22열입니다.')
    code('''feature_spec = json.loads((EXPERIMENT_ROOT / "baseline_manifest.json").read_text())
node_names = feature_spec["node_names"]
edge_names = feature_spec["edge_names"] + ["format_" + name for name in FORMAT_NAMES]

feature_df = pd.DataFrame({"node_feature": pd.Series(node_names),
                           "edge_feature": pd.Series(edge_names)})
feature_df''')
    md('먼저8건의 거래 피처와 정답 형태를 확인합니다. 정답은 학습 loss와 지표 계산에만 사용합니다.')
    code('''sample_ids = np.asarray(train_ids[:8], dtype=np.int64)
feature_reader = FeatureAdapter(use_ports=MODEL_NAME != "fraudgt_format")
label_reader = Labels()

X_sample = feature_reader.edge_features(sample_ids)
y_sample = label_reader(sample_ids)
X_sample.shape, y_sample.shape''')
    code('''sample_df = pd.DataFrame(X_sample, columns=edge_names)
sample_df.insert(0, "transaction_id", sample_ids)
sample_df["is_laundering"] = y_sample > 0
sample_df''')
    md('''## 3. 그래프 DataLoader

무작위·비복원 이웃 추출 `[50, 50]`을 사용합니다. 기본형·PE는 정방향, Multi는 정·역방향 관계를 사용합니다. 아래 로더는 입력 크기 확인용8건이며, 실제 학습은 위의2,048건 배치 설정으로 실행합니다.''')
    code('''preview_config = replace(CONFIG, loader_workers=0)
preview_graph = PeriodGraph("train", MODEL_NAME, preview_config)
sample_loader = preview_graph.loader(sample_ids, batch_size=len(sample_ids))
sampled = sample_next(iter(sample_loader), preview_config, "shape_preview", 0, 0)
rows, sample_batch, sample_stats = feature_reader.materialize(
    preview_graph, sampled, sample_ids
)''')
    code('''shape_df = pd.DataFrame({
    "tensor": ["node_features", "edge_index", "edge_features", "target_index"],
    "shape": [tuple(sample_batch.node_features.shape), tuple(sample_batch.edge_index.shape),
              tuple(sample_batch.edge_features.shape), tuple(sample_batch.target_index.shape)],
})
shape_df''')
    code('''pd.Series(sample_stats, name="샘플 그래프 정보")''')
    md('모양 확인용 그래프는 여기서 해제합니다. 전체 데이터는 학습 함수가 필요한 배치마다 읽습니다.')
    code('''del sampled, sample_loader, sample_batch, preview_graph, feature_reader''')
    md('''## 4. 모델링

동일한 학습 코드의 모델을 만들어 구조를 확인합니다. 학습 함수도 같은 `make_model()`을 사용하며, 학습 시작·재개 시 모델과 optimizer를 생성하거나 복원합니다. 아래 `model_preview`는 구조 확인용입니다.''')
    code('''model_preview = make_model(MODEL_NAME, CONFIG)
model_preview''')
    code('''summary_df = pd.DataFrame([
    {"layer": name, "type": module.__class__.__name__,
     "parameters": sum(p.numel() for p in module.parameters())}
    for name, module in model_preview.named_children()
])
summary_df''')
    code('''print("전체 파라미터:", f"{sum(p.numel() for p in model_preview.parameters()):,}")
print("학습 대상 모델:", MODEL_NAMES)
del model_preview''')
    md('모델 내부를 읽고 싶으면 `SHOW_DETAILS=True`로 설정합니다. 실제 사용되는 class 소스를 보여줍니다.')
    code('''if SHOW_DETAILS:
    show_implementation(FraudGTBlock)
    show_implementation(FraudGT)''')
    md('''## 5. 손실함수와 콜백

BCE의 정상 가중치는1, 양성 가중치는6입니다. optimizer는 AdamW, 누적8배치와 warmup5+cosine을 유지합니다. best 모델은 val F1 기준으로 저장하고, 정해진500 epoch를 실행합니다.''')
    code('''training_settings = {
    "loss": "weighted BCE", "class_weights": [1, CONFIG.positive_weight],
    "optimizer": "AdamW", "learning_rate": CONFIG.base_lr,
    "weight_decay": CONFIG.weight_decay, "accumulation": CONFIG.batch_accumulation,
    "checkpoint_monitor": "val_F1", "validation_epochs": "1, 4, 8, ..., 500",
}
pd.Series(training_settings, name="학습 설정")''')
    code('''if SHOW_DETAILS:
    show_implementation(class_weighted_loss)
    show_implementation(make_optimizer)''')
    md('콜백은 진행 게이지·표·그래프를 갱신합니다. best/last 체크포인트 저장과 중단 후 재개는 검증된 학습 함수가 담당합니다.')
    code('''callbacks = LearningCallbacks(RUN_ROOT, CONFIG, refresh_seconds=REFRESH_SECONDS)

def fit_model(model_name):
    run_variant(
        CONFIG, model_name,
        on_epoch=callbacks.on_epoch,
        on_progress=callbacks.on_progress,
    )
    return history_frame(RUN_ROOT, model_name)''')
    md('''## 6. 모델 학습

`RUN_TRAINING=True`이면 세 모델을 순서대로 학습합니다. 학습 중에는 Train/Validation 진행률과 그래프가 갱신됩니다. 검증은1·4·8·… epoch에 수행하고 나머지 epoch의 val 값은 빈칸으로 남깁니다. 같은 실행이 이미 학습 중이면 현재 기록을 보여줍니다.''')
    code('''history_by_model = {}
training_finished = False

if RUN_TRAINING and training_is_active(RUN_ROOT):
    print("같은 RUN_NAME이 학습 중입니다. 현재 진행 기록을 표시합니다.")
    callbacks.start()
elif RUN_TRAINING:
    if not torch.cuda.is_available():
        raise RuntimeError("전체 학습에는 CUDA GPU가 필요합니다.")
    with run_lock():
        require_verification()
        prepare(CONFIG)
        callbacks.start()
        try:
            for model_name in MODEL_NAMES:
                history_by_model[model_name] = fit_model(model_name)
            training_finished = True
        except KeyboardInterrupt:
            print("중단했습니다. 같은 RUN_NAME으로 마지막 저장 지점에서 재개할 수 있습니다.")
        finally:
            callbacks.finish()
else:
    print("저장된 기록 확인 모드입니다. 직접 학습할 때 RUN_TRAINING=True로 바꾸세요.")''', 'lesson-training')
    md('별도 프로세스에서 진행 중인 학습을 계속 보고 싶을 때 사용하는 조회 셀입니다.')
    code('''if FOLLOW_ACTIVE_TRAINING and training_is_active(RUN_ROOT):
    viewer = follow_training(RUN_ROOT, CONFIG, MODEL_NAMES, refresh_seconds=REFRESH_SECONDS)''')
    md('''## 7. 학습 결과 표

예제의 `history.history`처럼 저장된 epoch 기록을 DataFrame으로 확인합니다. 모델 이름을 바꾸면 해당 모델의 기록을 볼 수 있습니다. **P/R/F1/AP는 실제 판정된 거래 기준**이며, `coverage`와 누락 양성 수도 함께 봐야 합니다.''')
    code('''MODEL_NAME = MODEL_NAMES[0]  # pe_fraudgt_format 또는 multi_fraudgt_format으로 변경 가능
h_df = history_frame(RUN_ROOT, MODEL_NAME)
h_df''')
    code('''val_df = h_df.loc[h_df["validation_performed"].eq(True)].copy()
print("완료 epoch:", len(h_df), "| 실제 검증 epoch:", len(val_df))
if h_df.empty:
    print("아직 이 RUN_NAME의 완료된 epoch 기록이 없습니다.")''')
    md('''## 8. 학습 내용 시각화

예제처럼 loss와 ACC를 별도 셀에서 그립니다. Precision·Recall·F1과 무패턴 Recall도 이어서 확인합니다. 그래프는 화면에 표시하고 이미지 파일로 저장하지 않습니다.''')
    code('''# Loss
if not h_df.empty:
    plt.figure(figsize=(10, 4))
    plt.plot(h_df["epoch"], h_df["train_loss"], label="train_loss")
    plt.plot(val_df["epoch"], val_df["val_loss"], "o-", label="val_loss")
    plt.xlabel("Epoch")
    plt.ylabel("Loss")
    plt.legend()
    plt.grid(True)
    plt.show()''')
    code('''# Accuracy
if not h_df.empty:
    plt.figure(figsize=(10, 4))
    plt.plot(h_df["epoch"], h_df["train_accuracy_at_05"], label="train_ACC")
    plt.plot(val_df["epoch"], val_df["val_accuracy_at_05"], "o-", label="val_ACC")
    plt.xlabel("Epoch")
    plt.ylabel("Accuracy")
    plt.ylim(0, 1.01)
    plt.legend()
    plt.grid(True)
    plt.show()''')
    code('''# Validation precision / recall / F1
if not val_df.empty:
    plt.figure(figsize=(10, 4))
    for column in ["val_precision_at_05", "val_recall_at_05", "val_F1"]:
        plt.plot(val_df["epoch"], val_df[column], "o-", label=column)
    plt.axhline(0.70, color="gray", linestyle="--", label="P goal 0.70")
    plt.axhline(0.65, color="orange", linestyle=":", label="R goal 0.65")
    plt.xlabel("Epoch")
    plt.ylim(0, 1.01)
    plt.legend()
    plt.grid(True)
    plt.show()''')
    code('''# Unmatched recall and scored coverage
if not val_df.empty:
    plt.figure(figsize=(10, 4))
    for column in ["val_unmatched_recall_at_05", "val_coverage", "val_requested_recall_lower_bound"]:
        plt.plot(val_df["epoch"], val_df[column], "o-", label=column)
    plt.xlabel("Epoch")
    plt.ylim(0, 1.01)
    plt.legend()
    plt.grid(True)
    plt.show()''')
    md('''## 9. best 모델의 예측 확인

검증 거래 중32건의 예측을 확인합니다. 작은 예시이므로 전체 성능 지표로 사용하지 않습니다. 공식 head가 판정하지 않은 거래는 확률과 예측을 빈칸으로 남기며 원래 거래 행을 유지합니다.''')
    code('''best_path = MODEL_DIR / MODEL_NAME / "best.pt"
print("best 모델:", best_path)
print("저장 여부:", best_path.is_file())''')
    code('''rng = np.random.default_rng(SEED)
positions = rng.choice(len(val_ids), size=min(32, len(val_ids)), replace=False)
prediction_ids = np.asarray(val_ids[positions], dtype=np.int64)

pred_df = pd.DataFrame()
if best_path.is_file():
    pred_df = predict_examples(RUN_ROOT, MODEL_NAME, CONFIG, prediction_ids)
else:
    print("best 체크포인트가 저장된 뒤 예측 셀을 실행하세요.")
pred_df''', 'lesson-prediction')
    code('''if not pred_df.empty:
    plot_df = pred_df.loc[pred_df["scored"]].copy()
    print("요청:", len(pred_df), "| 판정:", len(plot_df), "| 미판정:", (~pred_df["scored"]).sum())
    if not plot_df.empty:
        colors = np.where(plot_df["correct"].astype(bool), "steelblue", "tomato")
        plt.figure(figsize=(12, 4))
        plt.bar(np.arange(len(plot_df)), plot_df["positive_probability"], color=colors)
        plt.axhline(0.5, color="gray", linestyle="--")
        plt.xlabel("Scored validation example")
        plt.ylabel("Positive probability")
        plt.ylim(0, 1)
        plt.show()''')
    md('''## 10. 최종 평가 기록

세 모델이 모두 학습되면 best 체크포인트를 고정하고 기존 test 평가 절차를 수행합니다. 예측 예시32건은 이 평가와 별개입니다. 목표 달성은 판정 누락과 전체 모집단 평가까지 확인해야 확정할 수 있습니다.''')
    code('''if training_finished:
    with run_lock():
        final_result = finish_evaluation(CONFIG)
    display(final_result)
else:
    final_result = read_result_json(RUN_ROOT / "complete.json", {})
    if final_result:
        display(final_result)
    else:
        print("최종 평가 결과가 아직 없습니다.")''')
    md('''## 참고 — 유지한 비교 조건

- 실습형: 거래별 독립 그래프를64건씩 처리해 원래2,048건 배치 평균 손실로 합산합니다. 공유형: 2,048건 전체 공유 그래프입니다.
- 검증은 전체 val 거래에서 최대256×2,048건을 균일 선택합니다. 양성 전수 표본이나 IPW를 사용하지 않습니다.
- 그래프·계좌 집계는 split 종료까지의 정보입니다. 일말 cutoff는 시연 조건이며 train 그래프에는 val/test 간선을 넣지 않습니다. 정적KYC의 제공 시점은 별도 검증되지 않았습니다.
- 메모리 설정은 기본 worker0/thread2, GPU allocator35%입니다. 공식 worker18/thread24는 `RESOURCE_PROFILE="official"`로 선택합니다.
- 원 코드의 gradient 누적 경계 오류는 수정한 상태를 유지합니다. V10 입력·전처리·단일seed 조건이므로 논문 전체 재현이라는 뜻은 아닙니다.

실행 중인 학습과 체크포인트는 그대로 보존합니다. 노트북을 다시 열면 새 셀 구성을 볼 수 있습니다. 다른 코드 버전이 로드된 커널에서는 학습을 종료한 뒤 재시작해서 실행하세요.

상세 기록: [조건 수정과 검증](../../../V10_FraudGT_조건수정_20261027/노트북_조건수정_검증기록.html).''')
    # Use a link relative to each destination rather than a guessed directory depth.
    import os
    report = os.path.relpath(ROOT/'노트북_조건수정_검증기록.html', destination.parent)
    cells[-1].source = cells[-1].source.replace('../../../V10_FraudGT_조건수정_20261027/노트북_조건수정_검증기록.html', report)
    notebook = nbf.v4.new_notebook(cells=cells, metadata={
        'kernelspec': {'display_name': 'Python 3 (ipykernel)', 'language': 'python', 'name': 'python3'},
        'language_info': {'name': 'python', 'version': '3.11'},
        'fraudgt_corrected': {'graph_mode': mode, 'run_name': mode+'_corrected_001'},
        'lesson_layout': {'reference': str(REFERENCE), 'version': '20261027-short-cells'},
    })
    for i, cell in enumerate(cells):
        if cell.cell_type == 'code':
            compile(cell.source, destination.name+':'+str(i), 'exec')
    nbf.validate(notebook)
    backup = destination.parent/'notebook_backups'/STAMP/destination.name
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(destination, backup)
    nbf.write(notebook, destination)
    canonical = ROOT/destination.name
    # Make the report link correct in the canonical copy too.
    canonical_notebook = nbf.reads(nbf.writes(notebook), as_version=4)
    canonical_notebook.cells[-1].source = canonical_notebook.cells[-1].source.replace(report, '노트북_조건수정_검증기록.html')
    nbf.write(canonical_notebook, canonical)
    lengths = [len(c.source.splitlines()) for c in cells if c.cell_type == 'code']
    return {'mode': mode, 'path': str(destination), 'canonical': str(canonical), 'backup': str(backup),
            'cells': len(cells), 'code_cells': len(lengths), 'longest_code_cell': max(lengths),
            'saved_run_training': options.get('RUN_TRAINING', False),
            'previous_run_name': options.get('RUN_NAME')}

baseline = json.loads((ROOT/'verification.json').read_text())
assert source_manifest() == baseline['source_sha256']
records = [build(mode, path) for mode, path in TARGETS]
value = {'utc': STAMP, 'reference': str(REFERENCE), 'source_sha256_before': source_manifest(), 'notebooks': records}
(ROOT/'lesson_layout_manifest.json').write_text(json.dumps(value, ensure_ascii=False, indent=2))
(ROOT/'notebooks.json').write_text(json.dumps({'utc': STAMP, 'notebooks': records}, ensure_ascii=False, indent=2))
print(json.dumps(records, ensure_ascii=False))
