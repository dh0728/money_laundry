# 모델 실행부 연동 규약 v1

대상: 모델팀의 실행 어댑터 ↔ Python 추론 워커. Spring API나 S3 파일 계약의 버전과 별개다. 현재 실행 모델은 시연 계산기이며 실제 GNN/GPU 예외 매핑은 모델팀의 어댑터 연결 시 검증한다.

## 연결 지점과 성공 반환

`model_adapter.py`의 `run_model(targets, model_kind, *, model_version, feature_version)`이 모델 실행 진입점이다. 워커가 별도 프로세스에서 호출한다. 현재 함수 내부의 시연 계산 호출을 실제 모델의 입력 검증 → 로딩 → 추론 → 후처리로 교체한다. 테스트 프로그램을 참조하거나 실행하지 않는다.

- `model_kind`: `binary` 또는 `type`. 외부 요청 API에서는 BINARY/TYPE이다.
- 현재 `targets`: PyArrow Table(tx_id int64, demo_value int64). 실제 GNN 입력 피처·그래프 형식은 별도 계약이며 이 문서로 확정하지 않는다.
- 현재 버전은 demo-calculator-v1/demo-input-v1. 실제 모델 버전 도입 시 서버의 허용 버전·입력/결과 검증도 함께 변경해야 한다. 이 문서만 적용했다고 실제 모델 연결이 완료되는 것은 아니다.
- 성공: BINARY는 tx_id(int64), p_laundering(float64), TYPE은 tx_id(int64), p_0..p_8(float64)의 PyArrow Table 반환. 현재 시연 계약은 대상 tx_id 집합 정확히 일치, 중복/NULL 없음, 유한한 [0,1] 확률, TYPE 합 허용오차 1e-9를 요구한다.
- 모델은 S3 전송·Spring 호출·자동 재시도를 수행하지 않는다. 파일 저장/검증/전송과 재시도는 워커 책임이다. 일부 결과만 만든 상태를 성공으로 반환하지 않는다.

## 실패 반환

Python 어댑터는 공통 모듈의 예외를 사용한다.

```python
from model_contract import ModelExecutionError

# 모델 프레임워크의 실제 예외를 잡는 지점에서 해당 코드로 변환한다.
raise ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE") from None
```

별도 모델 라이브러리가 JSON 오류를 반환한다면 다음 형식으로 만들고 어댑터에서 `raise ModelExecutionError.from_document(document)`로 변환한다. 모델 라이브러리는 아래 필드명/코드를 그대로 사용할 수 있다.

```json
{
  "error_contract_version": 1,
  "code": "GPU_OUT_OF_MEMORY",
  "stage": "INFERENCE",
  "message": "GPU memory was exhausted."
}
```

네 필드 모두 필수다. 버전은 정수1, message는 최대256자 문자열이다. 미정의 필드/코드/단계 조합은 계약 위반이다. `retryable`, `retry_after`, 재실행 명령은 모델이 지정하지 않는다. 워커는 code/stage만 정책 판단에 사용하고 자유 message는 공통 코드의 안전한 고정 문구로 교체해 저장·반환한다. 원문 거래, 계좌, 토큰, 서명 URL, 파일 경로, traceback을 message에 넣지 않는다.

| code | 허용 stage | 워커 자동 재시도 | 최종 조치 |
|---|---|---|---|
| INPUT_INVALID | VALIDATE_INPUT | 없음 | CORRECT_INPUT |
| MODEL_VERSION_MISMATCH | LOAD_MODEL | 없음 | CHECK_MODEL_DEPLOYMENT |
| MODEL_LOAD_FAILED | LOAD_MODEL | 없음 | CHECK_MODEL_DEPLOYMENT |
| GPU_OUT_OF_MEMORY | LOAD_MODEL, INFERENCE | 없음 | CHECK_INFERENCE_ENVIRONMENT |
| HOST_OUT_OF_MEMORY | LOAD_MODEL, INFERENCE, POSTPROCESS | 없음 | CHECK_INFERENCE_ENVIRONMENT |
| MODEL_TEMPORARILY_UNAVAILABLE | LOAD_MODEL, INFERENCE | 최초 포함 총3회, 실패 후60초·300초 | CHECK_INFERENCE_ENVIRONMENT |
| MODEL_OUTPUT_INVALID | POSTPROCESS | 없음 | CHECK_MODEL_OUTPUT |
| MODEL_EXECUTION_FAILED | LOAD_MODEL, INFERENCE, POSTPROCESS | 없음 | INSPECT_MODEL_FAILURE |

`MODEL_TEMPORARILY_UNAVAILABLE`은 동일 입력을 나중에 실행하면 해결될 수 있는 일시적인 상태를 실제로 확인한 경우만 사용한다. 모든 예외를 이 코드로 변환하지 않는다. 모델 로딩 오류·OOM·원인 불명 종료를 입력 오류로 추정하지 않는다.

예외를 반환하기 전에 모델이 시작한 작업·스레드·자원을 종료/정리해야 한다. 백그라운드 모델 작업을 남긴 채 실패를 반환하면 재시도와 중복 실행될 수 있다. 워커는 모델 자식 프로세스의 종료를 확인한 뒤에만 재시도를 예약한다. 모델팀은 별도 분리 프로세스를 남기지 않는다.

현재 어댑터는 명시적 ModelExecutionError를 보존하고, Python MemoryError를 HOST_OUT_OF_MEMORY로, 그 외 알 수 없는 예외를 MODEL_EXECUTION_FAILED로 변환한다. GPU 프레임워크 고유 OOM 예외는 모델팀이 명시적으로 매핑해야 한다. OS의 강제 종료로 오류 문서를 남기지 못하면 워커는 MODEL_PROCESS_FAILED로 기록한다. 이때 OOM이라고 단정하지 않는다.

## 워커의 재시도·상태 관리

- 실행 식별자는 기존 job/run/model/request/round를 유지한다. 자동 재시도로 새 요청·회차나 다른 입력을 만들지 않는다.
- 재시도 횟수는 모델별로 관리한다. BINARY 성공 후 TYPE 실패이면 TYPE만 재시도한다. 두 모델 실패도 곧바로 입력 문제로 판정하지 않는다.
- GET 상태의 attempts는 자식 프로세스 시작 횟수, model_failures는 모델 실패 수, transfer_failures는 일시적 파일 전송 실패 수다. 재시도 대기는 RETRY_WAIT와 retry_at(UTC Unix seconds), 실패 내용은 failure로 반환한다.
- failure는 domain(MODEL/TRANSFER/WORKER), error_code, action, attempt 및 모델 실패인 경우 model_error를 담는다. 자동 재시도 대기의 action은 NONE이다. 최종 FAILED의 action은 외부에서 확인할 조치를 뜻하며 실제 재전송 명령이 아니다.
- 시도별 오류·카운터·예약 시각은 추론 워커 SQLite에 보존한다. 같은 요청 재접수나 재시작으로 실패 횟수를 초기화하지 않는다. 최종 실패의 명시 재개는 상위 실행 관리에서 다루며 자동 새 회차는 만들지 않는다.
- 모델 재시도 중에는 매 시도마다 콜백을 보내지 않는다. 최종 완료/실패/중단 이벤트를 기존 방식으로 통보한다. FAILED 이벤트는 failure를 추가로 포함한다. Spring 수신·생애주기 연결은 아직 후속 작업이다.
- 취소는 재시도보다 우선한다. 취소 대기/중단 상태에서 늦은 모델 결과를 반영하지 않는다. 서버 장애 뒤 기존 모델 종료가 불명확하면 RECOVERY_REQUIRED로 유지하며 자동 재실행하지 않는다.
- 파일 전송 재시도는 별도로 30초·120초, 실패3회까지 적용한다. 결과 업로드 재시도는 저장된 계산 결과를 재사용한다. HTTP401/403은 만료/권한 원인을 단정하지 않고 TRANSFER_ACCESS_DENIED 및 REFRESH_ACCESS_OR_CHECK_PERMISSION으로 보고한다. 자동 URL 갱신/입력 수정은 이번 구현에 포함되지 않는다.
- 같은 조건의 OOM 반복 실행, 임의 배치 축소·그래프 분할, 자동 입력 재가공은 하지 않는다. 그런 복구 방식은 모델 결과의 의미가 유지되는지 확인한 별도 계약이 필요하다.

규약의 실행 정본은 `model_contract.py`의 검증과 정책이다. 모델팀 전달 시 이 문서와 해당 모듈을 함께 제공하면 Python 예외를 그대로 사용할 수 있고, 문서의 JSON을 반환하는 방식도 사용할 수 있다.
