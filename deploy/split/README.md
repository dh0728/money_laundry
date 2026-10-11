# EC2 두 대 + RDS 배포

프론트 EC2는 웹과 외부 Nginx, 백엔드 EC2는 API·Python 워커와 내부 Nginx를 실행한다. DB는 RDS를 사용한다. 개발의 데모 추론 컨테이너는 백엔드에 유지한다.

기존 `deploy/compose*.yaml`, `deploy/scripts/`, `deploy/nginx/`는 EC2 한 대 구성용이다. 파일 위쪽의 `LEGACY` 주석으로 구분한다. **전환 전에는 기존 CI 배포가 계속 이 파일을 사용한다.**

## 1. 파일 역할

| 파일 | 역할 |
| --- | --- |
| `front/compose*.yaml`, `backend/compose*.yaml` | 각 서버에서 실행할 컨테이너 정의. 상위 공통 Compose는 없음 |
| `front/nginx/`, `backend/nginx/` | 외부 요청 분기와 내부 API 연결 |
| 각 서버의 `deploy-dev.sh`, `deploy-prod.sh`, `rollback-prod.sh` | 역할·환경을 지정하여 공통 Python 배포 코드를 호출 |
| `deploy.py` | 설정 조회, 실행, 상태 검사, Nginx 전환, 배포 ID별 복구 |
| `check_rds.py` | API 이미지 안에서 앱·분석 계정의 RDS 인증과 TLS 검증 |
| `build_bundle.py` | 명시된 배포 파일만 묶고 SHA-256 계산 |
| `receive.py` | EC2에서 Bundle 다운로드·검증·압축 해제 |
| `run_ssm.py` | GitHub에서 백엔드 → 프론트 배포와 양쪽 복구 조정 |
| 각 서버의 `split.example.json` | 서버별 비밀값 없는 설정 예시 |
| [deploy-split.yml](../../.github/workflows/deploy-split.yml) | 두 환경이 함께 사용하는 새 GitHub 배포 workflow |

## 2. EC2에서 준비할 것

Ubuntu의 `python3`(3.12 이상), AWS CLI v2, Docker와 Compose v2 이상, Nginx, curl을 준비한다. Nginx는 systemd 서비스로 실행되어 있어야 한다. 배포 명령은 SSM을 통해 root로 실행한다.

| 위치 | 준비 |
| --- | --- |
| 두 EC2 | `/opt/aml/releases`, `/opt/aml/state`, `/opt/aml/shared` 디렉터리, SSM·ECR·배포 S3 접근 권한 |
| 프론트 | Cloudflare 인증서 `/etc/nginx/ssl/cloudflare/aiaml.co.kr.pem`와 `.key`, 백엔드 사설 IP:80 연결 |
| 백엔드 | 읽기 가능한 `/opt/aml/certs/rds-ca.pem`, RDS:5432 연결, Parameter Store·데이터 S3 접근 권한 |
| RDS | 환경별 DB·앱 계정·분석 계정, 복원한 스키마·데이터와 분석 권한 |

각 EC2에서 해당 역할의 `split.example.json`을 참고하여 `/opt/aml/shared/split.json`을 만든다. `account_id`는 새 AWS 계정의 12자리 ID, 프론트의 `backend_private_ip`는 백엔드 사설 IPv4로 바꾼다. 파일 소유자는 root, 권한은 `600`으로 둔다. 자리표시자를 그대로 두면 배포가 실패한다.

백엔드의 `prod_worker_mode: unconfigured`는 **운영 분석 기능이 아직 준비되지 않았다는 뜻**이다. 현재 워커가 지원하는 `demo` 모드로 분석을 사용하려면 실제 운영 추론 API와 계약을 확인한 뒤 `prod_worker_mode`를 `demo`로, `prod_inference_url`을 해당 HTTPS 주소로 설정하고 `/aml/prod/inference/token`을 준비한다. 현재 예시만으로 운영 분석 기능까지 완료된 것은 아니다.

배포는 `/etc/nginx/conf.d/aml-dev.conf`, `aml-prod.conf`와 운영 upstream 파일을 관리한다. 백엔드에서는 `aml-default.conf`도 설치하고 Ubuntu 기본 사이트를 비활성화한다. 새 서버에 기존 단일 EC2용 `dev.conf`·`prod.conf`를 함께 복사하지 않는다. 같은 upstream·도메인 정의가 겹칠 수 있다.

## 3. Parameter Store

아래 접미사 앞에 `/aml/dev/` 또는 `/aml/prod/`를 붙인다. 실제 값은 코드·Bundle·배포 기록에 저장하지 않는다. JSON으로 조회해 비밀번호의 공백·특수문자도 그대로 전달한다. 프론트 배포는 이 값을 조회하지 않는다. IAM 접근 범위는 별도의 역할 정책으로 관리한다.

| 대상 | 필요한 접미사 |
| --- | --- |
| 개발·운영 공통 | `db/url`, `db/username`, `db/password`, `s3/bucket`, `s3/prefix` |
| 개발·운영 암호화 | `ingest/encryption-key`, `ingest/search-key`, `ingest/key-version` |
| 개발·운영 분석 계정 | `analysis-db/username`, `analysis-db/password` |
| 개발 추가 | `inference/token` |
| 운영 추가 | `presentation/enabled` (`true` 또는 `false`) |
| 운영 분석을 `demo`로 설정한 경우 | `inference/token` |

새 배포는 JWT·SQS 파라미터를 조회하지 않는다. Cloudflare Access 외부 검사용 토큰도 이 배포 과정에서는 조회하지 않는다. 기존 파라미터 자체를 삭제하는 작업은 하지 않는다.

DB URL은 다음 형식이다. 운영은 실제 운영 DB 이름으로 바꾼다.

```text
jdbc:postgresql://<RDS_ENDPOINT>:5432/aml_dev_v3?sslmode=verify-full&sslrootcert=/app/certs/rds-ca.pem
```

호스트의 `/opt/aml/certs/rds-ca.pem`을 컨테이너의 `/app/certs/rds-ca.pem`에 읽기 전용으로 연결한다. 앱 기동 전 두 DB 계정으로 TLS 접속을 검사한다. 스키마·분석 권한과 실제 분석 작업까지 검사하는 코드는 아니므로 데이터 이전 후 기능 검증이 필요하다.

## 4. GitHub 전환은 마지막에

[ci.yml](../../.github/workflows/ci.yml)은 **Repository variable** `AML_DEPLOY_LAYOUT`이 `split`일 때만 새 workflow를 호출한다. 아직 이 값을 만들거나 바꾸지 않았다. 미설정 상태에서는 기존 한 대 배포가 유지된다.

새 서버와 데이터 준비 후 GitHub의 `dev`·`prod` Environment variables를 다음 값으로 맞춘다. 준비되지 않은 기존 자동 배포가 실행되지 않도록 전환 동안 push를 멈추고, 환경 값과 마지막 Repository variable을 함께 전환한다.

| 변수 | 값 |
| --- | --- |
| `AWS_REGION` | `ap-northeast-2` |
| `AWS_ACCOUNT_ID` | 새 AWS 계정 ID |
| `AWS_ROLE_ARN` | `arn:aws:iam::<계정 ID>:role/aml-github-dev-deploy-role` 또는 prod 역할 |
| `DEPLOY_ARTIFACT_BUCKET` | `aml-deploy-artifacts-<계정 ID>` |
| `FRONT_EC2_INSTANCE_ID` | 새 프론트 EC2 ID |
| `BACKEND_EC2_INSTANCE_ID` | 새 백엔드 EC2 ID |

새 workflow는 dev 환경을 `dev` 브랜치, prod 환경을 `master` 브랜치에서 실행하며 전체 40자리 커밋 SHA를 사용한다. ECR 태그는 `dev-<SHA>` 또는 `prod-<SHA>`다. 동일 태그가 이미 있으면 이미지를 재사용한다. 실제 GitHub 변수·OIDC·DNS 전환은 별도 실습이다.

## 5. 배포와 복구

1. GitHub에서 API·웹 이미지를 준비하고 환경별 Bundle을 S3에 업로드한다.
2. 백엔드가 Bundle 체크섬·서버 역할·계정을 확인하고 RDS 접속 검사 후 API를 배포한다.
3. 프론트가 웹을 배포하고 Nginx를 통해 API까지 확인한다.
4. 두 서버를 다시 확인한 뒤 이전 운영 컨테이너를 중지한다. 개발은 같은 프로젝트를 교체하므로 짧은 중단이 있을 수 있다.
5. SSM에서 실패가 확정되면 시도한 서버를 역순으로 복구한다. SSM 결과를 조회할 수 없으면 명령 ID를 남기고 중단한다. 해당 원격 명령 종료를 확인한 뒤 복구한다.

상태 검사는 HTTP 200과 웹의 `ok` 또는 API의 JSON `status: UP`을 모두 확인한다. 리다이렉트·로그인 HTML은 성공으로 처리하지 않는다. 프론트 복구 중에는 자기 웹을 검사하고, 뒤이어 백엔드 복구에서 API를 검사하므로 백엔드 장애가 프론트 복구를 막지 않는다.

각 호스트의 상태는 `/opt/aml/state/split/<환경>.json`, 복구 기록은 `history/<환경>-<배포 ID>.json`에 남긴다. 비밀번호는 기록하지 않는다. 진행 중 기록이 있으면 새 배포 ID의 실행을 차단한다. 강제 종료·복구 실패 뒤에는 이 기록을 임의로 삭제하지 말고 기존 배포 ID로 복구한다.

운영 수동 복구는 실패한 릴리스의 디렉터리에서 **프론트 → 백엔드** 순으로 실행한다. 각 서버에서 역할에 맞는 경로를 선택한다.

```bash
sudo bash /opt/aml/releases/prod/<배포_SHA>/deploy/split/front/rollback-prod.sh <배포_ID> <계정_ID>
sudo bash /opt/aml/releases/prod/<배포_SHA>/deploy/split/backend/rollback-prod.sh <배포_ID> <계정_ID>
```

두 명령을 같은 EC2에서 실행하는 것이 아니다. 이미 복구한 ID는 다시 실행해도 변경하지 않으며, 이후 다른 배포가 시작됐다면 오래된 ID로 덮어쓰지 않는다. 이전 이미지·릴리스는 자동 삭제하지 않는다. 복구할 때 현재 Parameter Store 값을 읽으므로 이전 버전도 해당 자격 증명과 호환되어야 한다. **컨테이너 복구는 DB 스키마·데이터를 되돌리지 않는다.**

`deploy-dev.sh`·`deploy-prod.sh`만 수동 실행하면 해당 호스트가 준비된 상태까지 진행한다. 양쪽 실행 후 공통 `deploy.py`의 `verify`와 `finalize`까지 실행해야 완료되므로 평상시에는 이를 조정하는 GitHub workflow를 사용한다.

## 6. 로컬 검증

프로젝트 루트에서 실행한다. Docker Compose CLI와 Bash는 필요하지만 Docker 데몬이나 AWS 계정은 사용하지 않는다.

```bash
python -m unittest discover -s deploy/split/tests -v
python deploy/split/validate.py
```

실패 복구·오래된 배포 차단·역할 분리·Bundle 검증을 모의 실행하고 Compose 6개 및 Python·Bash 문법을 검사한다. 실제 EC2에서는 추가로 `nginx -t`, 컨테이너 실행, RDS·S3 접근, HTTPS 세션 로그인, 업로드·분석, 양쪽 복구를 검증한다. 세션이 메모리에 있다면 API 전환 후 재로그인이 필요할 수 있다.

2026년 10월 9일 재검토: 모의 테스트 32개와 Compose 6개 설정 검사를 통과했다. HTTP 상태·본문 판정, 백엔드 장애 중 프론트 복구, 비밀값 공백 보존, UTF-8 설정 파일 읽기를 보완했다. RDS·SSM 테스트는 외부 서비스를 대체한 모의 검사이며 실제 접속 결과가 아니다.

## 핵심 정리

- 새 서버는 `deploy/split/`만 사용한다. 공통 배포 로직은 Python, 실행 대상은 서버별 Compose로 나눈다.
- 보관한 기존 파일에는 EC2 한 대 구성용이라는 주석을 남겼다.
- 로컬 코드 적용과 실제 서비스 전환은 별도다. DB·데이터·운영 추론 설정과 새 서버 검증 후 GitHub·DNS를 전환한다.
