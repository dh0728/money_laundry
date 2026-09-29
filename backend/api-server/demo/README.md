# Streamlit 시연 화면과 조작패널

기존 백엔드 API의 분석 작업 → 의심 거래 → Alert 상세·버전·그래프를 조회한다.
DB 직접 조회, 가짜 완료 상태, 화면 자체 점수 계산은 하지 않는다.
app.py는 조회 전용이다. control_panel.py는 발표자용 로컬 조작패널이며 기존 은행 목업 모듈과 분석 API를 호출한다.

## 로컬 전체 실행 — 권장

Docker Desktop을 실행한 뒤 이 디렉터리에서 PowerShell로 시작한다. 호스트 Python 설치는 필요 없다.

```powershell
./demo.ps1 -Action start -DataDir '<준비된 날짜별 은행 파일의 상위 폴더>'
./demo.ps1 -Action status
./demo.ps1 -Action stop
```

시작하면 조작패널 http://127.0.0.1:8502 를 연다. 결과 조회는 http://127.0.0.1:8501 이다. API는 localhost:8080이며 EC2·AWS에 연결하지 않는다. 첫 실행은 이미지 빌드 시간이 필요하다. 브라우저 자동 열기를 생략하려면 `-NoBrowser`를 추가한다.

PostgreSQL, S3 호환 MinIO, 더미 추론 워커, Spring, 두 화면을 함께 실행한다. 원본 파일은 읽기 전용으로 연결하고 조작패널에서는 `/data-input`으로 보인다. 첫 준비 단계에서 파일명의 은행 코드·날짜를 기준으로 보고 은행과 제출 기간을 등록한다. 은행명은 임의로 만들지 않고 보고 검증 과정에서 저장한다. 기존 등록은 덮어쓰지 않는다.

`stop`은 컨테이너만 내린다. DB, 업로드·입출력 파일, 추론 상태, 작업 파일, 암호화 키는 `aml-demo_` 접두 Docker 볼륨에 보존된다. 같은 명령으로 다시 시작하면 이어서 조회할 수 있다. Docker Desktop에서 이 볼륨을 삭제하면 해당 데이터가 사라지므로 유지한다. 이 구성은 백업을 대신하지 않는다. 조작패널 세션의 진행 이력은 서버 데이터와 달리 재시작 시 초기화된다.

로컬 키·TLS 인증서는 준비 컨테이너가 전용 볼륨에 생성하며 기존 키를 재사용한다. 키가 일부 유실되면 새 키로 조용히 교체하지 않고 시작을 중단한다. 실제 모델 대신 시연 더미를 사용한다. 포트는 loopback에만 공개하며 신뢰된 개인 PC용이다.

이 Compose에서만 `APP_INGEST_SCHEDULED_ENABLED=false`로 예약 분석 등록을 끈다. 조작패널 트리거를 사용하며 검수·분석·재시도·복구는 그대로 실행한다. 일반 서버의 기본 예약 동작은 유지한다.

포트가 사용 중이면 시작 전에 `AML_DEMO_API_PORT`, `AML_DEMO_VIEW_PORT`, `AML_DEMO_CONTROL_PORT` 환경변수로 변경한다. 변경된 포트는 출력되는 주소를 사용한다. 실패하면 `status`로 서비스 상태를 확인하며, 재실행은 저장 데이터를 초기화하지 않는다.

## 조작패널 — 별도 서버에 수동 연결

같은 AML Python 환경에서 demo 디렉터리를 기준으로 실행한다:

```powershell
$env:AML_DEMO_API_URL = 'http://127.0.0.1:8080'
$env:AML_DEMO_DATA_DIR = '<준비된 날짜별 은행 파일의 상위 폴더>'
python -m streamlit run control_panel.py --server.address 127.0.0.1 --server.port 8502 --browser.gatherUsageStats false
```

브라우저에서 http://127.0.0.1:8502 에 접속한다. 데이터 폴더는 화면에서도 지정할 수 있다. 구조는 `YYYY-MM-DD/bank_은행번호_YYYY-MM-DD.csv`이며 파일은 읽기만 한다. 기존 bank-mock 디렉터리를 포함한 저장소 체크아웃에서 실행한다. 추가 패키지는 필요 없다.

- 날짜 하나 선택 → ‘선택 날짜 전송’ → 검수 완료 → ‘분석 트리거’.
- 여러 날짜 선택 → ‘전송 → 분석 자동 재생’: 날짜순 전송·검수·분석 완료 후 지정한 초만큼 기다리고 다음 날짜 진행.
- ‘현재 날짜 완료 후 일시정지’는 실행 중인 날짜를 취소하지 않는다. 같은 세션에서 자동 재생을 다시 누르면 완료한 날짜는 건너뛴다.
- 실패하면 다음 날짜로 넘어가지 않는다. 실패 원인을 해결한 뒤 작업 ID로 ‘실패 작업 재개’를 요청한다. 자동 재생 재시도는 이미 받은 작업 ID를 재사용한다.

백엔드는 `local` 프로파일과 별도 시연 DB·저장소·추론 더미가 준비돼 있어야 한다. 해당 은행·기간 등록도 기존 업로드 조건대로 필요하다. 패널은 서버나 DB를 생성·초기화하지 않으며 데이터 삭제 버튼도 없다. 원격 주소 제어는 허용하지 않는다.

트리거는 예약 시각 대기만 생략한다. 보고 기준일 다음 날을 분석 구분 날짜로 쓰고 실제 수신 cutoff는 요청 시각으로 남긴다. 다음 날짜 파일을 미리 모두 전송하지 않는다. 검수 중 파일은 기존 WAIT_INGEST로 기다리고, 오류는 기존 실패 경로를 따른다. 전체 처리 시간은 실제 연산·저장 시간에 따라 달라진다.

패널의 진행 이력은 세션 메모리다. 새로고침/프로세스 재시작으로 세션을 잃었거나 전송 응답이 불명확하면 표시된 uploadId/jobId와 조회 화면에서 서버 상태를 먼저 확인한다. 무조건 재업로드하면 기존 중복 거절을 받는다. 패널 프로세스를 종료해도 이미 서버에 접수한 작업을 취소하지 않는다.

## 결과 조회 화면

AML Python 환경에서 설치한 뒤 이 디렉터리에서 실행:

```powershell
python -m pip install -r requirements.txt
$env:AML_DEMO_API_URL = 'http://127.0.0.1:8080'
python -m streamlit run app.py --server.address 127.0.0.1 --server.port 8501 --browser.gatherUsageStats false
```

명령의 python은 활성화한 AML 환경의 인터프리터를 뜻한다. 종료는 Ctrl+C.
백엔드 주소는 UI에서도 설정할 수 있다. 원격 주소는 HTTPS, 로컬은 HTTP도 지원한다.
Cloudflare 인증이 있으면 CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET 환경변수로 제공한다.
시크릿을 파일에 커밋하지 않는다. 인증 환경변수가 있으면 AML_DEMO_API_URL로 지정한 주소만 조회한다.
다른 서버에 연결할 때는 인증 환경변수를 제거하거나 해당 서버의 인증정보와 주소를 함께 재설정한다.
동시 사용자 서비스가 아닌 신뢰된 운영자의 로컬 시연 도구다.

백엔드가 실행 중이어야 하며 완료된 분석 결과가 있어야 상세를 볼 수 있다.
이 화면은 example.com이나 미구성 추론 연결을 완성하지 않는다.
로컬 E2E 실행기는 끝나면 서버를 정리하므로 상시 서버로 사용할 수 없다.
모델 버전에 demo가 있으면 더미로 표시하고, 그 외는 출처 확인 필요로 표시한다.
저장된 Alert 근거와 거래별 점수를 표시한다. 탐색 한도는 내부 진단 자료로 유지하고 사용자 경고로 표시하지 않는다. 직원 조사·판정은 아래 네 화면에서 제공한다.

검증: `python -m unittest discover -s tests -v` (이 디렉터리 기준).


## 네 화면·조사 시연

1. 조작패널(8502)에서 전송 전에 업무 시각을 설정한다. 자동 재생은 거래일 다음 날 09:00 KST로 전진한다. 기존 분석을 실제 시각으로 실행했던 DB는 초기화 후 시작해야 날짜가 일관된다. 진행 중/복구 대기 작업이 있거나 과거로 이동하면 거절한다.
2. 아래 계정 등록 절에 따라 STAFF·ADMIN 테스트 계정을 준비한다. 조회 화면(8501)에서 아이디·비밀번호로 로그인한다. 본인 담당 사건만 변경할 수 있으며 조작패널은 ADMIN 로그인이다.
3. 대시보드는 개인/기관 탭, Transactions는 소유주→계좌→거래를 한 화면에서 탐색한다. 기간·필터 태그 X를 사용한다. 모델 판정과 사람 결론은 별도다.
4. 담당 직원은 Alerts 상세에서 거래 범위를 선택해 정상·제외·참고/조사 대상 변경·Episode 이관한다. 목록의 여러 Alert도 범위를 확인한 뒤 한 번에 이관할 수 있다. 일부만 처리하면 열린 업무로 남는다.
5. 같은 팀의 담당 직원은 Episodes에서 묶음을 분리·이동·제외하고 묶음의 조사 대상 전체에 판정한다. 판정 후 범위를 바꾸려면 재검토로 판정을 열고 조정한다. 모든 조사 대상 처리 후 별도로 종결한다. 이전 결론/범위는 이력으로 남는다.
6. 자금 흐름 탭에서 계좌 그래프/소유주 박스를 전환하고 시간 슬라이더로 거래를 순서대로 확인한다. 실명·실계좌번호는 표시하지 않는다.

새 화면 API는 dev/local의 서버 세션 인증을 사용한다. UI는 Spring HTTP API만 호출한다. 실제 모델·원격 연결·실제 탐지 성능 검증은 이번 시연 범위 밖이다.

업무 시각과 조사 이력은 DB에 보존된다. 기존 stop/start 보존 방식은 같고 새 코드를 반영하려면 start 단계의 이미지 빌드를 완료해야 한다. 데이터 초기화는 기존 reset 명령을 사용하며 여기서 자동으로 삭제하지 않는다.


개요의 자금 지표는 ‘조사 중심 계좌 S’에서 계좌를 선택해 비교한다. 초기에는 씨앗 거래 계좌를 사용한다. 총 거래액은 사건 거래 합계이고, 외부 유입/유출·순유입 집중도·단시간 유출은 관측 기간 내 선택 계좌의 수신 원장 전체로 계산한다. 시간 기준은 기본180분이며 선택 변경으로 비교할 수 있다. FIFO는 계산상 추정이고 동일 자금 추적 결과가 아니다. 은행 보고 미완료 날짜는 관측 완료로 간주하지 않는다. 종결 사건은 당시180분 지표로 고정한다.


기관 전체 대시보드의 ‘Episode 업무 현황’에서 현재 열린/오늘 신규/오늘 종결/배정3일 경과/검토 시작 전 건수와 첫 검토·종결 평균시간을 확인한다. 평균은 선택 기간의 해당 행동과 표본 수 기준이다. 대시보드는5분마다 갱신하며 기존 사건에 Alert를 추가해도 신규 건수는 늘지 않는다. 상세의 ‘검토 시작 기록’을 누른 시점으로 첫 검토를 센다. 고정 업무 시각에서는 경과시간도 고정된다.


## 서버 세션 로그인·테스트 계정 등록

직원 선택 버튼을 단일 로그인으로 교체했다. 결과 화면은 STAFF 또는 ADMIN으로 로그인하고, 조작패널은 ADMIN으로 로그인한다. 회원가입은 없다. 최초 실행 후 DB에 테스트 계정을 등록해야 하며 비밀번호가 없는 초기 계정은 로그인·신규 자동 배정 대상이 아니다. 기존 담당 사건을 열려면 해당 기존 계정에 비밀번호 해시를 설정한다. 기존 사용자명 l1a/l2a도 역할은 모두 STAFF다.

1. 호스트의 Python 환경에서 `password_hash.py`를 실행한다. 비밀번호를 두 번 숨김 입력하면 Spring 호환 해시만 출력한다. Python이 없으면 실행 중인 로컬 demo UI 컨테이너에서 다음 명령으로 생성할 수 있다(저장소 루트 PowerShell):

```powershell
docker compose -p aml-demo -f ./backend/api-server/demo/compose.demo.yaml exec -it view python /workspace/backend/api-server/demo/password_hash.py
```

평문 비밀번호를 SQL이나 명령행 인수에 쓰지 않는다.

2. 관리자 DB 도구에서 사용자명·표시 이름·해시를 대입하여 등록한다. 아래 `<생성한 해시>`는 실제 해시로 교체한다.

```sql
INSERT INTO users(username,name,role,password_hash)
VALUES ('demo-staff','시연 직원','STAFF','<생성한 해시>');
INSERT INTO users(username,name,role,password_hash)
VALUES ('demo-admin','시연 관리자','ADMIN','<별도로 생성한 해시>');
-- 기존 계정에 로그인 비밀번호를 설정할 경우 사용자명 하나를 지정한다.
-- UPDATE users SET password_hash='<생성한 해시>' WHERE username='l1a';
```

API 연동: API.md §5의 CSRF 조회 → form 로그인 → CSRF 재조회 → 쿠키·CSRF 포함 요청 순서다. dev는 HTTPS 쿠키, local은 loopback HTTP 쿠키다. 서버 재시작·30분 유휴 후 재로그인하며 재생 중 인증 만료가 발생하면 실패를 표시하고 다음 날짜로 넘어가지 않는다. 직접 EC2 배포·FE 프록시 왕복 검증은 로컬 자동 테스트와 별개다.


### dev 관리자 API 확인 (PowerShell)

배포와 계정 등록 후 실행한다. HTTPS dev 주소를 사용하며 자격 증명은 대화식으로 입력한다. 아래는 로그인·현재 사용자 확인만 수행하며 데이터는 변경하지 않는다.

```powershell
$apiBase = 'https://dev.aiaml.co.kr'
$credential = Get-Credential -Message 'DB에 등록한 시연 계정'
$csrf = Invoke-RestMethod "$apiBase/api/auth/csrf" -SessionVariable amlSession
Invoke-RestMethod "$apiBase/api/auth/login" -Method Post -WebSession $amlSession `
  -ContentType 'application/x-www-form-urlencoded' `
  -Headers @{'X-CSRF-TOKEN'=$csrf.token} `
  -Body @{username=$credential.UserName; password=$credential.GetNetworkCredential().Password}
$csrf = Invoke-RestMethod "$apiBase/api/auth/csrf" -WebSession $amlSession
Invoke-RestMethod "$apiBase/api/me" -WebSession $amlSession
Invoke-RestMethod "$apiBase/api/auth/logout" -Method Post -WebSession $amlSession `
  -Headers @{'X-CSRF-TOKEN'=$csrf.token}
Remove-Variable credential,csrf,amlSession
```

변경 API를 실행하려면 로그아웃 전에 같은 WebSession과 새 CSRF 헤더를 사용한다. 관리자의 업무 시각 설정·분석 트리거도 동일한 인증 경계를 사용하며 수신/통합 완료 조건을 우회하지 않는다.

## 배포된 dev 서버 조작패널

로컬 PC에서 패널만 실행하고 파일은 dev의 업로드 API가 발급한 S3 URL로 보낸다. 업무 시각·분석·결과 저장은 EC2의 dev 백엔드와 DB에서 처리한다. 이 실행에는 로컬 Docker가 필요 없고, Python 환경에 위 requirements.txt의 Streamlit·httpx가 설치되어 있어야 한다. 기존 로컬 Docker 시연 명령은 그대로 사용한다.

저장소 루트의 PowerShell에서 실행한다. 아래 Python 명령 경로와 데이터 폴더는 자기 환경에 맞게 바꾼다. 아이디·비밀번호는 인수로 넣지 않는다.

```powershell
& '<AML Python 실행 파일>' -X utf8 -B '.\backend\api-server\demo\dev_control.py' --api-url 'https://dev.aiaml.co.kr' --data-dir '<날짜별 은행 파일의 상위 폴더>'
```

Cloudflare Access로 보호된 dev는 실행 명령 끝에 `--cloudflare`를 추가한다. Cloudflare **Service Token의 Client ID·Client Secret**을 먼저 숨김 입력하고, 이어서 ADMIN 계정을 입력한다. 서비스 토큰은 ADMIN 비밀번호나 브라우저 로그인 비밀번호와 다르다. 기존 은행 목업에 사용하던 토큰이 있으면 사용하되, 해당 토큰의 접근 정책이 은행 경로뿐 아니라 `/api/auth/*`, `/api/me`, `/api/v1/demo/*`, `/api/v1/batch-jobs/*`에도 적용되어야 한다.

`--cloudflare`를 생략하면 기존 은행 목업과 같은 `CF_ACCESS_CLIENT_ID`·`CF_ACCESS_CLIENT_SECRET` 환경변수를 읽는다. 두 값 중 하나만 설정되거나 헤더 형식이 잘못되면 요청 전에 거절한다. 숨김 입력 방식은 환경변수를 생성하지 않는다. 토큰은 dev API에만 전달하고 S3 PUT이나 리다이렉트 목적지에는 전달하지 않는다. 브라우저의 Cloudflare 로그인 상태는 Python 프로세스에 공유되지 않는다. 302이면 API 계정 비밀번호를 바꾸기 전에 Access 토큰/접근 정책을 확인한다.

1. 터미널에서 dev DB에 등록한 ADMIN 아이디와 비밀번호를 입력한다. 비밀번호는 숨김 입력한다. 인증과 업무 시각 API 조회가 성공하면 `http://127.0.0.1:8502`를 연다. 포트가 이미 사용 중이면 기존 패널을 종료하거나 `--port 8503`을 지정한다.
2. 브라우저에는 로그인 창 없이 조작패널이 열린다. 서버·파일 경로는 시작 시 지정한 값으로 고정된다. ADMIN 자격 증명은 해당 Python 프로세스 메모리에서만 유지하며 파일·환경변수·명령행·브라우저 저장소에 보관하지 않는다. 인증 만료 응답이 확인된 경우에만 한 번 재로그인·재요청한다. 네트워크 오류·타임아웃·권한 거절·처리 조건 충돌은 자동 반복하지 않는다.
3. 날짜를 선택하고 **전송 → 분석 자동 재생**을 누르면 날짜순으로 `업무 시각 설정 → 해당 날짜 모든 은행 파일 전송·검수 → 분석 요청 → 분석 완료 대기 → 다음 날짜`를 실행한다. 날짜·파일 진행률과 uploadId/jobId가 표시된다. 다른 탭에서 열어도 같은 프로세스의 재생 상태를 공유하고 동시에 두 재생 작업을 실행하지 않는다.
4. 업무 시각은 거래일 다음 날 09:00 KST로 전진하며 수동 지정이 더 미래이면 유지한다. **시연 업무 시각 설정**에서 수동 조정할 수 있다. 서버의 과거 이동 금지·실행/복구 대기 작업 제한은 유지된다. 이미 실제 시각으로 분석한 DB에서 최초 과거 업무 시각 설정이 거절되면 패널로 우회할 수 없다. 초기화는 별도로 결정하며 이 프로그램이 수행하지 않는다.
5. 날짜 전송만·분석만·실패 작업 재개도 가능하다. **현재 날짜 완료 후 일시정지**는 진행 중 날짜를 끝내고 다음 날짜 진입을 멈춘다. 결과는 배포된 서비스 화면에서 조회한다.
6. 작업 완료 또는 일시정지 완료를 확인한 뒤 터미널에서 **Ctrl+C**로 종료한다. 실행 중 종료하면 현재 날짜 처리가 끝날 때까지 종료가 지연될 수 있다. 브라우저 탭만 닫으면 프로세스와 작업은 계속된다. 종료 시 로그아웃을 시도하고 자격 증명 참조를 해제한다.

dev에는 보고 은행·기준일 적용 기간·AML17 양식의 사전 등록이 필요하다. 패널이 은행을 임의 등록하지 않으며 미등록 업로드는 기존 `403 REPORTING_NOT_REGISTERED`로 거절된다. STAFF 시연 계정과 추론 환경 등 기존 분석 실행 조건도 준비되어 있어야 한다.

패널의 전송 완료 기억·재생 목록은 메모리에 있으므로 프로세스 재시작 시 초기화된다. S3 파일·DB·업무 시각·분석 작업은 유지된다. 응답을 잃었거나 패널을 재시작했다면 서비스의 업로드/분석 상태를 확인한 뒤 진행한다. 동일 파일 재전송을 복구 수단으로 반복하지 않는다. 이 패널에는 dev 데이터 삭제 기능이 없다.

자동 검증은 `tests/test_dev_control.py`의 HTTP 대역 및 Streamlit AppTest로 수행한다. 실제 dev 로그인·S3 업로드·EC2 분석 왕복은 별도 실환경 검증이다.
