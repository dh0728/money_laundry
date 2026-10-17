# 추론 서버

모델을 실행하는 서버다. 백엔드(backend/api-server)가 S3에 올린 입력을 받아 모델을 돌리고 결과를 S3에 올린다. DB에는 접속하지 않는다. 모델(가중치·실행 코드)은 이 폴더에만 있고 백엔드 이미지에는 들어가지 않는다.

| 위치 | 역할 |
|---|---|
| `inference_server.py` | 진입점. 요청 접수·상태 조회·취소 HTTP API |
| `inference_worker/` | 요청 상태 저장(SQLite)·재시도, 모델 실행 자식 프로세스, 모델 어댑터 |
| `models/` | 모델 폴더(`spec.py`·`model.py`)와 버전 → 모델 등록표 `registry.py` |
| `common/` | 백엔드와 같은 전송·오류·점수 검사 계약 사본. 백엔드 `worker/common/`의 같은 이름 파일과 내용이 같아야 한다(백엔드 테스트 `test_inference_view_contract.py`가 확인) |
| `MODEL_CONTRACT.md` | 모델 실행부와 서버 사이의 성공·실패 반환 규약 |

## 실행 (공유 추론 서버)

KubeSphere 서버에서 이 폴더를 그대로 두고 Python 3.13 환경으로 실행한다. 이미지 빌드나 레지스트리는 쓰지 않는다.

```bash
python -m pip install -r requirements.txt
python -B inference_server.py
```

| 환경변수 | 값 |
|---|---|
| `INFERENCE_TOKEN` | 최소 32자 공유 토큰. 개발 백엔드의 Parameter Store `/aml/dev/inference/token`과 같은 값 |
| `INFERENCE_OBJECT_BASE_URL` | 실제 S3 Presigned URL과 scheme·host·prefix가 같은 기본 URL, 끝 `/` 필수. 예 `https://<bucket>.s3.<region>.amazonaws.com/<prefix>/` |
| `INFERENCE_STATE_DIR` | 재시작 후에도 유지되는 폴더(SQLite 상태·입출력 캐시·서명 URL 저장). 공개 경로로 노출하지 않음 |
| `INFERENCE_BIND` / `INFERENCE_PORT` | 기본 `127.0.0.1` / `8090`. 앞단 HTTPS 프록시 연결 방식에 맞게 지정 |

- 한 번에 하나만 실행한다. 같은 상태 폴더를 두 서버가 함께 열지 않는다.
- `GET /health`가 `{"status":"UP"}`이면 정상이다. 외부에는 기존 HTTPS 프록시로만 노출한다.
- 토큰을 명령 인수·커밋·채팅에 복사하지 않는다. DB 접속 정보나 AWS 장기 접근키는 필요 없다.
- 서버를 내렸다 올릴 때는 실행 중인 모델을 멈춘 뒤 같은 상태 폴더로 올린다. 비정상 종료 뒤 `RECOVERY_REQUIRED`는 성공·중단 확인을 대신하지 않는다.
- 개발 백엔드는 이 서버만 쓴다(`deploy/split/README.md`의 `dev_inference_target`). 서버가 꺼져 있으면 개발 분석은 추론 단계에서 기다린다.

## 로컬 데모

`backend/api-server/demo/compose.demo.yaml`의 `inference` 서비스가 이 폴더의 `Dockerfile`로 컨테이너를 만든다.

## 테스트

이 폴더에서 `python -B -m unittest discover -s . -p "test_*.py"`로 실행한다.
