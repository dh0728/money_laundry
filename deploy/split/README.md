# EC2 두 대 + RDS 배포

프론트 EC2는 웹과 외부 Nginx, 백엔드 EC2는 API·Python 워커와 내부 Nginx를 실행한다. DB는 RDS를 사용한다. 모델은 공유 추론 서버(`backend/inference-server`)에서만 돌며, 워커의 추론 대상은 개발 설정에서 선택한다.

기존 `deploy/compose*.yaml`, `deploy/scripts/`, `deploy/nginx/`는 EC2 한 대 구성용 보관 코드다. 파일 위쪽의 `LEGACY` 주석으로 구분한다. 이 버전의 CI는 해당 배포를 호출하지 않으며, 기존 두 배포 workflow의 실행 조건도 `false`로 막았다. 아직 이 변경을 받지 않은 원격 브랜치에서는 GitHub의 workflow 비활성화를 유지한다.

## 1. 파일 역할

| 파일 | 역할 |
| --- | --- |
| `front/compose*.yaml`, `backend/compose*.yaml` | 각 서버에서 실행할 컨테이너 정의. 상위 공통 Compose는 없음 |
| `front/nginx/`, `backend/nginx/` | 외부 요청 분기와 내부 API 연결 |
| 각 서버의 `deploy-dev.sh`, `deploy-prod.sh`, `rollback-prod.sh` | 역할·환경을 지정하여 공통 Python 배포 코드를 호출 |
| `deploy.py` | 설정 조회, 실행, 상태 검사, Nginx 전환, 배포 ID별 복구 |
| `check_rds.py` | API 이미지 안에서 앱·분석 계정의 RDS 인증과 TLS 검증 |
| `build_bundle.py` | 명시된 배포 파일만 묶고 SHA-256 계산 |
| `image_manifest.py` | 선택한 API·웹 이미지의 계정·환경·저장소·Digest 검사 |
| `prod-images.json` | 마이그레이션 당시 운영 앱의 Digest 보관 기록. 현재 자동배포에서는 읽지 않음 |
| `ci_artifacts.py` | 운영 커밋 태그의 ECR Digest 조회, S3 Bundle 조건부 업로드·재다운로드 대조 |
| Bundle의 `images.json` (선택) | 해당 릴리스에서 실행할 API·웹 Digest 기록. 운영 자동배포 때마다 생성 |
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

## 개발 외부 추론 대상 선택

**설정 위치: AWS 백엔드의 /opt/aml/shared/split.json.** `dev_inference_target`의 기본값은 `kubesphere`이며 `naver`도 선택할 수 있다. 모델은 공유 추론 서버(`backend/inference-server`)에서만 돌기 때문에 개발 서버에 로컬 추론 컨테이너는 없다(2026-10-17). `local`은 그 이전 배포 기록의 복구에만 남아 있고 새 배포에서는 선택할 수 없다. 이 대상 선택은 개발 전용이다. 운영 추론 URL·토큰·CA 설정과 DB 전환은 별도로 준비한다. 네이버 값은 클라이언트 설정 분리용이며 GPU 서버 배포 방식까지 정의하지 않는다.

| 대상 | API 주소 | Bearer 토큰 | 공개 CA |
| --- | --- | --- | --- |
| local(이전 배포 복구 전용) | http://127.0.0.1:8090 | /aml/dev/inference/token | 없음 |
| kubesphere | /aml/dev/inference/kubesphere/url | /aml/dev/inference/token | /opt/aml/certs/inference/kubesphere/ca.crt |
| naver | /aml/dev/inference/naver/url | /aml/dev/inference/naver/token | /opt/aml/certs/inference/naver/ca.crt |

주소는 Parameter Store String, 외부 토큰은 최소 32자의 공백 없는 ASCII **SecureString**으로 준비한다. 토큰은 해당 서버의 `INFERENCE_TOKEN`과 같아야 한다. `/aml/dev/inference/url`은 사용하지 않는다. KubeSphere는 사용자 선택에 따라 기존 개발 토큰을 재사용한다. 새 KubeSphere 토큰 파라미터는 만들지 않는다. 네이버 토큰만 별도 경로를 사용한다.

`deploy.py`가 선택한 URL·토큰을 조회하고 `backend/inference.external.yaml`을 병합한다(이전 local 기록 복구 때만 병합하지 않는다). 공개 CA 파일만 API 컨테이너의 `/app/certs/inference-ca.crt`에 읽기 전용으로 연결하며 파일이 없으면 배포를 중단한다. CA 개인키·GPU 서버 개인키는 복사하지 않는다. CA 파일은 컨테이너 사용자(uid 10001)가 읽을 수 있어야 한다.

Compose가 `INFERENCE_API_URL`·`INFERENCE_API_TOKEN`·`INFERENCE_CA_FILE`을 API에 전달한다. 외부 대상은 HTTPS와 `INFERENCE_ALLOW_LOOPBACK=false`를 사용한다. Python 워커의 제출·조회와 Spring의 취소·취소 상태 조회가 동일한 CA를 사용하며 S3/JVM 전역 신뢰 설정은 바꾸지 않는다. Python은 환경 프록시를 사용하지 않고 HTTP 리다이렉트도 따라가지 않는다. S3 서명 URL은 외부에서도 리전별 virtual-host 주소를 사용한다.

**이 변경은 새 API 이미지와 새 split Bundle을 함께 배포해야 동작한다.** Parameter Store 값만 바꾸거나 기존 앱 이미지를 고정한 채 배포하면 완료되지 않는다. GitHub 자동배포를 포함한 실제 반영은 별도 작업이다.

### 전환·복구 시 확인

1. 개발 분석 요청 유입·자동 예약을 멈추고 진행 중 run·취소 큐를 정리한다. 대상/주소 변경 시 배포의 RDS 사전 검사가 대기·실행·재시도 작업, READY/ACTIVE/CANCEL_REQUESTED run, 미확인 취소를 발견하면 중단한다. 이 조회가 이후 새 요청까지 잠그는 것은 아니므로 전환 중 요청 유입을 계속 막는다.
2. 대상·URL·CA 경로/해시는 배포 상태에 저장한다. 토큰은 기록하지 않는다. 복구할 때는 이 기록의 대상으로 돌아가고, 이전 기록에 대상이 없으면 local로 처리한다.
3. 새 배포의 Compose에는 로컬 inference 서비스가 없다. 이전 local 기록으로 복구하면 그 릴리스에 들어 있던 Compose와 이미지가 로컬 inference를 다시 띄운다(기존 상태 볼륨 `aml-dev-inference-state`는 지우지 않는다). KubeSphere는 기존 개발 토큰을 쓰고, 네이버 토큰은 별도다. 기존 run의 목적지 고정 검증도 유지한다.
4. CA 파일이 배포 당시 해시와 달라지면 복구를 중단한다. CA 교체는 별도 배포로 검토한다. 토큰은 대상별 Parameter Store의 현재 값을 읽으므로 GPU와 동시 교체해야 한다.
5. 전환 후 실제 토큰으로 요청·조회·취소, S3 GET/PUT, 결과 검증·DB 반영을 확인한다. 기본 배포 health 검사는 Spring API 상태이며 GPU의 실제 모델 성공을 뜻하지 않는다.

## 4. GitHub 전환은 마지막에

[ci.yml](../../.github/workflows/ci.yml)은 아래 **Repository variables**가 모두 맞을 때만 해당 환경을 자동배포한다. 미설정·`false` 상태에서는 배포하지 않고 CI 검사만 실행한다.

| Repository variable | 배포 허용 값 | 준비 중 값 |
| --- | --- | --- |
| `AML_DEPLOY_LAYOUT` | `split` | `split` |
| `AML_DEV_DEPLOY_ENABLED` | 개발을 배포할 때 `true` | `false` |
| `AML_PROD_DEPLOY_ENABLED` | 운영을 배포할 때 `true` | `false` |

새 서버 준비 후 GitHub의 `dev`·`prod` Environment variables를 다음 값으로 맞춘다. **이전 원격 CI는 위 스위치를 읽지 않으므로 브랜치별 코드 반영 전까지 workflow 자체를 비활성화한다.**

| 변수 | 값 |
| --- | --- |
| `AWS_REGION` | `ap-northeast-2` |
| `AWS_ACCOUNT_ID` | 새 AWS 계정 ID |
| `AWS_ROLE_ARN` | `arn:aws:iam::<계정 ID>:role/aml-github-dev-deploy-role` 또는 prod 역할 |
| `DEPLOY_ARTIFACT_BUCKET` | `aml-deploy-artifacts-<계정 ID>` |
| `FRONT_EC2_INSTANCE_ID` | 새 프론트 EC2 ID |
| `BACKEND_EC2_INSTANCE_ID` | 새 백엔드 EC2 ID |

workflow는 dev 환경을 `dev` 브랜치, prod 환경을 `master` 브랜치에서 실행하며 해당 브랜치에 포함된 전체 40자리 커밋 SHA를 사용한다. `dev → master` PR이 병합되면 `master` push의 CI가 실행되고, 검사 통과와 운영 스위치 확인 후 해당 master 커밋의 API·웹 이미지를 빌드하여 운영에 배포한다. GitHub `prod` Environment에 필수 승인자가 설정되어 있으면 기존과 같이 승인을 기다린다.

| 실행 방식 | 동작 |
| --- | --- |
| 수동 `operation=preflight` (기본값) | 코드 검사·OIDC 인증·AWS 계정·S3 버킷 위치·ECR 조회. 이미지 빌드·업로드·SSM 실행 없음 |
| 수동 `operation=deploy` | 위 스위치 확인 후 실제 배포 |
| `dev`·`master` push | CI 검사 통과 + 해당 환경 스위치가 `true`이면 실제 배포 |

수동 실행 화면은 workflow가 기본 브랜치에 반영된 뒤 사용한다. 사전 확인은 S3 업로드·객체 읽기나 SSM 실행 권한까지 검증하는 과정은 아니다. 이 권한은 정책 대조 후 실제 시험 배포로 확인한다.

개발은 `dev-<배포 SHA>`, 운영은 `prod-<배포 SHA>` 태그로 API·웹 이미지를 빌드하고 ECR에 업로드한다. 재시도 때 같은 태그가 있으면 해당 이미지를 재사용하고, 없는 이미지만 빌드한다. ECR 저장소는 태그 변경 불가(Immutable)를 유지한다. 웹은 두 환경 모두 `VITE_API_BASE_URL=/api`, `VITE_API_MODE=live`로 빌드한다.

운영은 빌드가 끝난 뒤 `resolve-prod`가 이번 커밋 태그의 API·웹 Digest를 ECR에서 조회한다. 계정·저장소·태그·Digest를 확인해 실행 중인 GitHub runner의 임시 `prod-images.json`을 만들고 Bundle의 `images.json`에 넣는다. 배포 SHA와 앱 SHA는 해당 master 커밋으로 같아진다. **저장소에 보관한 예전 `prod-images.json`은 자동배포에 사용하지 않는다.** 한 이미지라도 조회·검증에 실패하면 SSM 배포 전에 중단한다.

운영 역할 `aml-github-prod-deploy-role`에도 이미지 업로드 권한이 필요하다. `ecr:GetAuthorizationToken`은 `Resource: "*"`, `ecr:DescribeImages`, `ecr:BatchCheckLayerAvailability`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`는 새 계정의 `aml-api`·`aml-web` 저장소에 허용한다. 로컬 코드 변경은 실제 IAM 정책을 변경하지 않으며, `preflight`만으로 이미지 업로드 권한까지 확인되지는 않는다.

첫 운영 배포 전에는 운영 DB의 구조·Flyway 이력이 배포할 앱과 호환되는지 확인한다. 개발에서 SQL을 V1 하나로 합쳤다고 기존 운영 DB가 자동으로 같은 구조가 되는 것은 아니다. 이 자동배포는 DB 초기화나 Flyway 이력 수정·repair를 실행하지 않는다. 개발과 같은 GPU 서버를 쓰더라도 운영 URL·토큰·CA 마운트, 운영 S3 경로 허용과 작업 상태 분리는 별도로 맞춰야 한다. 준비 중에는 `AML_PROD_DEPLOY_ENABLED=false`를 유지한다.

실제 배포 결과는 각 Environment의 `secrets.DISCORD_WEBHOOK_URL`로 알린다. 사전 확인에는 알림을 보내지 않으며, Secret이 없거나 알림 전송이 실패해도 배포 결과를 바꾸지 않는다. 비밀번호·Webhook URL은 로그에 출력하지 않는다.

## 5. 배포와 복구

### 기존 이미지를 유지하며 배포 코드만 바꾸는 경우

검증한 이미지 이전 기록을 `build_bundle.py`의 `--image-record`로 전달하면 Bundle에 `deploy/split/images.json`이 추가된다. 기록의 `environment`, `account_id`, `region`, `app_sha`와 두 `images` 항목을 검사하며, 각 이미지에는 `repository`, `image`(환경·앱 SHA 태그), `digest`, `pinned_image`가 있어야 한다. Bundle에는 계정·환경·앱 SHA와 API·웹의 Digest 주소만 저장한다.

```bash
python deploy/split/build_bundle.py prod /tmp/deploy-bundle.tar.gz \
  --image-record /path/to/prod-images-ecr.json
```

수동으로 특정 이미지를 선택할 때는 `--image-manifest <검증한 파일>`도 사용할 수 있다. `--image-record`와 동시에 사용할 수는 없다. 저장소의 `prod-images.json`은 28~30번 실습에서 검증한 기존 운영 앱과 새 계정 Digest를 보관한 파일이며 비밀값을 포함하지 않는다. GitHub 자동배포는 매번 현재 커밋 태그로 새 manifest를 만들므로 이 과거 기록을 수정할 필요가 없다.

`deploy.py`는 Bundle의 `images.json`이 있으면 지정한 `repository@sha256:...` 이미지를 사용한다. 잘못된 파일은 태그 방식으로 우회하지 않고 실패한다. 이 파일이 없는 개발 Bundle과 이전 Bundle은 `환경-배포_SHA` 태그 방식을 유지한다.

기존 이미지를 수동으로 선택한 경우 배포 SHA는 배포 코드의 커밋, `app_sha`는 선택한 앱 커밋을 기록한다. 자동배포에서는 두 SHA가 같다. 같은 배포 SHA의 Bundle·이미지 선택은 불변으로 보관해야 한다. 복구·이전 컨테이너 중지는 해당 이전 릴리스의 `images.json`을 읽으므로, 배포마다 선택한 이미지가 유지된다.

S3의 `releases/<환경>/<배포 SHA>/deploy-bundle.tar.gz`는 `If-None-Match: *`로 새 파일만 업로드한다. 이미 있으면 내려받아 체크섬이 같을 때만 재사용한다. 내용이 다르거나 권한·통신 오류가 나면 SSM 실행 전에 중단한다. GitHub 역할에는 자기 환경의 `releases/dev/*` 또는 `releases/prod/*`에 대한 **`s3:PutObject`와 `s3:GetObject`**가 필요하다. 버킷 위치 확인에는 `s3:GetBucketLocation`을 사용한다.

### 두 서버 배포 순서

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

2026년 10월 13일: 모의 테스트 50개, Compose 6개, Python·Bash 문법 검사 통과. workflow의 배포 허용 조건 14개를 외부 요청 없이 확인했다. actionlint 1.7.12 검사도 통과했으며, 보관한 두 workflow의 의도적인 `if: false` 경고만 제외했다. GitHub OIDC 인증과 실제 배포는 브랜치 반영 후 별도로 검증한다.

2026년 10월 29일: 운영도 master 커밋으로 이미지를 빌드하고 그 Digest를 Bundle에 기록하도록 변경했다. split 테스트 78개 중 76개 통과, `AML_TEST_DOCKER` 미설정으로 DB 통합 테스트 2개 제외. Compose 6개·개발 외부 CA overlay·Python/Bash 문법과 workflow YAML·빌드 조건 16개 조합을 확인했다. AWS IAM·GitHub 환경 설정 변경이나 실제 배포는 실행하지 않았다.

## 핵심 정리

- 새 서버는 `deploy/split/`만 사용한다. 공통 배포 로직은 Python, 실행 대상은 서버별 Compose로 나눈다.
- 보관한 기존 파일에는 EC2 한 대 구성용이라는 주석을 남겼다.
- 로컬 코드 적용과 실제 서비스 전환은 별도다. DB·데이터·운영 추론 설정과 새 서버 검증 후 GitHub·DNS를 전환한다.

## dev 업무 DB 재생성 (초기 스키마 V1이 바뀐 경우)

V1 파일이 바뀌면 기존 dev DB에 새 이미지를 올릴 때 Flyway가 체크섬 불일치로 기동을 막는다. `deploy/DB_TRANSITION.md`·`deploy/scripts/reset-dev.py`는 예전 EC2 한 대(로컬 Postgres) 구성용이라 지금 구성에는 `reset_dev_rds.py`를 쓴다. dev 묶음에만 들어가며 RDS의 `aml_dev_v3`가 아니면 거절한다. 모든 SQL은 현재 릴리스 API 컨테이너 안에서 배포와 같은 환경으로 실행되어 DB 비밀번호가 명령·출력에 나오지 않는다.

백엔드 EC2에서, 업로드·분석을 멈춘 상태로 순서대로 실행한다(`<sha>`는 새 커밋, 그 커밋의 배포가 한 번 실행돼 `/opt/aml/releases/dev/<sha>`가 있어야 한다).

1. `sudo python3 /opt/aml/releases/dev/<sha>/deploy/split/reset_dev_rds.py` — 대상·스키마·행 수만 확인한다.
2. `sudo python3 .../reset_dev_rds.py --apply --backup-file /root/aml-dev-config-<날짜>.json` — dev API를 멈추고 설정 4개 표(직원·은행·보고 기간·환율)를 백업한 뒤 업무 스키마와 Flyway 이력을 비운다. 백업 파일은 소유자 전용이며 비밀번호 해시가 있으므로 출력·채팅·저장소에 넣지 않는다.
3. GitHub Actions에서 그 커밋의 배포를 다시 실행한다. 새 이미지가 빈 DB에 V1을 만든다. 빈 DB는 사전 점검에서 진행 중 작업 없음으로 본다.
4. `sudo python3 .../reset_dev_rds.py --restore-config /root/aml-dev-config-<날짜>.json` — 설정을 한 트랜잭션으로 복원한다. 업무 데이터가 있으면 거절한다.
5. `sudo python3 .../reset_dev_rds.py --grant-analysis` — 분석 계정에 `analysis_permissions.sql` 권한을 다시 준다. 계정 생성·비밀번호 변경은 하지 않는다.
6. 로그인, 조작패널에서 업무 시각 설정 후 은행 파일 전송·분석을 재개한다.

3에서 배포가 또 실패하면 자동 복구가 옛 API를 빈 DB로 띄워 옛 스키마를 다시 만든다. 이때는 원인을 고친 뒤 2를 **다른 백업 파일 이름**으로 다시 실행하고, 4에서는 **처음 백업 파일**을 쓴다.
