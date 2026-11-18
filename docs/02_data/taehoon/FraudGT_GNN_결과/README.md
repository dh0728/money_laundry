# FraudGT 팀 공유

기존 FraudGT 3종의 학습 구현, 단계별 노트북, 완료된 결과표, 논문 비교 문서를 정리한 Git 업로드용 폴더다.

- [실험 결과·논문 비교](FraudGT_구현_결과_논문비교.md)
- [전체 Test 결과 CSV](results/full_test_summary.csv), [선택 Val CSV](results/selected_validation.csv)
- [in-degree별 AP/F1](results/degree_all_targets.csv), [임계값·Top-K](results/threshold_topk.csv), [1284 epoch 기록](results/training_history.csv)
- [입력 캐시 계약](docs/입력캐시_계약.md), [출처·해시](docs/provenance.json), [검증 결과](docs/validation.json)

노트북만 복사하지 말고 **이 폴더 전체**를 Git에 올린다. 노트북은 같은 폴더의 실제 Python 구현을 호출한다. 데이터·가중치·개별 거래 예측·실행 출력은 포함하지 않았고 `.gitignore`로 제외한다. 노트북 출력도 비워 놓았다.

## 환경

Linux, Python 3.12, gcc가 필요하다. 검증 환경은 PyTorch 2.10.0+cu126, PyG 2.8.0.post1, pyg-lib 0.8.0+pt210cu126, NumPy 2.4.1이다. CPU 스모크 테스트에도 PyG의 native `pyg-lib`가 필요하다.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cu126
python -m pip install pyg_lib==0.8.0+pt210cu126 -f https://data.pyg.org/whl/torch-2.10.0+cu126.html
python -m pip install -r requirements.txt
python -m ipykernel install --user --name fraudgt-share --display-name 'FraudGT share'
python run.py environment
python run.py smoke
```

다른 PyTorch/CUDA 조합에서는 해당 조합의 wheel을 사용한다. [PyG 공식 설치 문서](https://pytorch-geometric.readthedocs.io/en/latest/install/installation.html), [검증 조합 wheel 목록](https://data.pyg.org/whl/torch-2.10.0+cu126.html). 설치 후에는 노트북 커널을 재시작해야 한다. 현재 서버의 설치 경로나 라이브러리 바이너리는 Git에 포함하지 않았다.

## 노트북 실행 순서

| 파일 | 용도 |
|---|---|
| `00_환경확인_입력캐시연결.ipynb` | native sampler 확인, 준비된 V10 캐시 연결 |
| `01_기간그래프_실험설정.ipynb` | 입력 검증, split/CSC 캐시 생성, 설정·모델 확인 |
| `02_FraudGT_모델별학습.ipynb` | Basic/PE/Multi 선택 학습, 같은 실행명으로 재개 |
| `03_모델별_전체Val_Test_결과.ipynb` | 각 모델의 전체 Val/Test 평가, 과거 집계표 열람 |
| `04_합성데이터_스모크검증.ipynb` | 외부 데이터 없이 전 경로 소규모 확인 |

대용량 작업은 각 노트북의 `RUN_*` 변수를 True로 바꾸면 실행된다. `WORK_DIR`/`RUN_NAME`은 단계 간 동일하게 지정한다. subprocess로 실행하여 노트북 커널에 이전 경로 설정이 남지 않게 했다. 학습 및 평가 진행률은 stdout/stderr로 즉시 전달된다.

## CLI 실행

아래 명령은 공유 폴더에서 실행한다. `/path/to/...`는 보유한 캐시 경로로 바꾼다.

```bash
python run.py --work-dir work connect --project /path/to/V10_project --labels-root /path/to/FraudGT_original/assets
python run.py --work-dir work prepare --build-graphs
python run.py --work-dir work train --variant fraudgt_format
python run.py --work-dir work train --variant pe_fraudgt_format
python run.py --work-dir work train --variant multi_fraudgt_format --stop-after 284
python run.py --work-dir work evaluate --variant multi_fraudgt_format --scope val
python run.py --work-dir work evaluate --variant multi_fraudgt_format --scope test
```

기본 설정은 500epoch, 2048 seed batch, accumulation 8, CPU worker 0/thread 2, CUDA 메모리 상한 35%다. 메모리 여건에 따라 `--memory-fraction`을 지정할 수 있다. 이 상한은 GPU 예약이 아니므로 다른 작업이 이미 VRAM을 사용 중이면 학습이 실패할 수 있다. shared graph의 batch 크기를 바꾸면 공통 문맥 그래프와 샘플링이 달라지므로 별도 실험명으로 기록한다. SALT의 GPU 전용 샘플러나 8192 logical batch 설정을 이 실험에 적용한 것은 아니다.

중단 후 같은 명령은 optimizer 경계의 `last.pt`에서 재개한다. `--stop-after`는 학습률 스케줄을 바꾸지 않고 지정 epoch까지 실행한다. `best.pt`는 Val로 선택한 모델이다. 모델별 전체 평가는 다른 모델의 학습 완료를 기다리지 않는다. 외부에 보관한 같은 구조의 가중치를 평가하려면 `--checkpoint /path/to/best.pt`를 지정한다. pickle을 포함하므로 신뢰할 수 있는 체크포인트만 사용한다.

설정/소스가 바뀌면 새 `--run-name`을, 입력 데이터가 바뀌면 새 `--work-dir`를 사용한다. `work/runs/<run-name>`에는 학습 이력·진행률·모델, `evaluations`에는 고정 평가 계약과 shard가 생성된다. 전체 평가의 추론은 shard 단위지만 정확한 AP 계산은 전체 점수 정렬용 CPU RAM이 필요하다. `results/`는 과거 완료된 실험 집계이므로 새 실행 결과가 자동으로 덮어쓰지 않는다.

## 결과를 읽을 때

현재 전체 Test F1은 Basic 66.29%, PE 실험 69.75%, Multi 70.14%다. 학습은 official readout, 이 결과의 최종 추론은 all_targets다. 현재 PE는 ports-only로, 논문의 Ports+Ego ID PE와 다르다. [비교 문서](FraudGT_구현_결과_논문비교.md)에 두 차이를 설명했다. 임계값/Top-K CSV는 기존 Test 점수의 진단용 집계이며 운영 임계값 선택용 Val 실험으로 대체하지 않는다.

## 출처

Lin et al., *FraudGT*, ICAIF 2024, [논문 DOI](https://doi.org/10.1145/3677052.3698648), [공식 코드](https://github.com/junhongmit/FraudGT/tree/f88db9dc003a6f521a90631c4741541686043119). 모델 수식과 공개 설정을 참고한 기존 V10 구현을 공유하며, 출처·변경 범위는 비교 문서와 provenance에 기록했다.
