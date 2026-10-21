# AML RADAR 웹앱

## 실행

Node.js 22.12 이상, pnpm 11.24 사용.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

기본값은 로그인 없이 동작하는 시연용 mock. `?mock=empty`와 `?mock=error`로 빈 화면과 오류 화면 확인.

로컬 Backend 서버가 실행 중일 때 실제 API 모드:

```sh
VITE_API_MODE=live pnpm dev
```

기본 프록시 주소는 `http://127.0.0.1:8080`. 서버 주소가 다르면 `VITE_API_PROXY_TARGET` 지정. 브라우저에서는 같은 출처 `/api/...`로 요청하며 로그인 세션 쿠키와 CSRF 토큰 사용. 실제 모드의 대시보드·거래 내역·Alert/Episode 조사 사건은 `backend/api-server/API.md` §6.5·§7.1·§9.8 경로 기준. 알림과 RDR 9000은 실제 모드에서도 `mock` 표시.

실제 로그인·권한·데이터 왕복 확인에는 Backend 테스트 서버와 STAFF/ADMIN 계정 필요.

## 검사

```sh
pnpm lint
pnpm test
pnpm build
```

## dev 디자인 유지 수정 검수 (2026-10-21)

시각 기준을 dev `0ab84296f3a32a8b58a03f75a9545c1641d35473`에서 확인한 뒤, 실제 통합은 기존 `fe/work 40761b80fa1dcf4897879bf101f8e83448adf928`의 구성과 차이를 보존하며 수행했다. dev의 다른 변경을 병합하지 않는다. 기존 `src/styles/theme.css`, `src/components/ui`, shell·내비게이션·화면 배치를 유지한다. 별도 독립 재구축 앱이나 새 스타일을 이식하지 않는다.

현재 선택한 수정 범위:

- 원장 진입 시 소유주·계좌·거래의 첫 페이지를 각각 조회한다. 선택 전 owner/account를 생략한다. 선택으로 좁히고 해제로 상위 범위를 복원한다. 계좌 선택 전 상대 방향을 송금/수취로 단정하지 않는다.
- 같은 로그인 workspace에서 목록을 경유해 같은 사건을 다시 열면 검토 탭과 미제출 의견을 보존한다. 확인창·판정·제출을 자동 복원하거나 실행하지 않는다. 사건 종류/ID로 분리하며 workspace가 종료되면 사라지는 메모리 상태다.
- 409 후 의견 보존과 자동 재전송 차단은 기존 동작을 검사하며 유지한다. 401 후 로그인 workspace 자체가 종료된 다음의 초안 복원은 이번 수정에 포함하지 않는다.

새 clone의 저장소 루트에서 실행한다. 사용자 기기의 절대경로·다른 checkout의 node_modules·Windows 서비스는 요구하지 않는다. package.json의 Node.js/pnpm 버전과 커밋된 lockfile을 사용한다.

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm exec vitest run src/pages/LiveLedgerPage.test.tsx src/api/liveContracts.test.ts src/pages/LiveCasesPage.test.tsx src/pages/LiveNavigation.test.tsx
pnpm lint
pnpm test
pnpm build
pnpm dev --host 127.0.0.1 --port 5173
```

합성 입력은 위 검사 파일 안에 있다. 실제 계정·실서버 응답·회의록·개인 경로는 검수 자료에 필요하지 않다. 새 clone의 최초 의존성 설치에는 패키지 다운로드가 필요할 수 있다. 설치 후 기본 mock UI와 합성 단위/컴포넌트 검사는 인터넷·Backend 없이 실행할 수 있다. 기본 mock UI는 기존 시연 화면이며 Live API 경로의 실제 연결 검증을 대신하지 않는다.

실제 API 화면의 수동 검수는 Backend 및 정상 로그인 계정이 필요하다:

```sh
VITE_API_MODE=live VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm dev --host 127.0.0.1 --port 5173
```

- 원장: `#transactions` 진입 → 세 목록의 첫 페이지 확인 → 소유주 선택 → 계좌 선택 → 같은 계좌/소유주를 다시 눌러 해제. 계좌 미선택 검색도 확인한다.
- 조사: `#alerts`에서 검색/기간/필터 적용 → 사건 열기 → 검토 의견 입력 → 목록 복귀 → 같은 사건 재진입. 검색 조건·검토 탭·미제출 의견 유지와 저장 요청이 자동 발생하지 않음을 확인한다.
- 서버 충돌·권한·실제 저장 검증은 분리된 테스트 데이터에서만 수행한다. 합성 검사 통과를 실제 서버 수용이나 사용자 디자인 승인으로 표시하지 않는다.

작업 기록은 이 README와 코드/검사 diff에 남는다. 로컬 캡처·진단 로그·node_modules·빌드 산출물을 GitHub 인계에 포함하지 않는다. 기기 절전·종료 중 실행 지속은 보장하지 않으며 다음 사용 시 위 명령으로 다시 시작한다.

### 첫 반영본의 검증 기록 (`fd393a1a`)

이번 변경은 생산 로직 4파일·검사 4파일·이 README에 한정한다. 원격 fe/work의 rem 글자 크기, 기존 판정 컨트롤과 대시보드 API·검사, 디자인 시스템·워크플로를 유지한다. dev 전체나 별도 재구축 앱을 병합하지 않는다.

- 원장 초기/선택/해제/검색과 사건 왕복의 탭·의견·409 보존을 직접 확인하는 회귀 7건이 통과했다. 1440×900·390×844의 합성 live UI에서 기존 fe/work와 같은 선택/검토 상태의 11개 영역 클래스·스타일·기하를 비교했다. 실제 서버 쓰기는 없다.
- 타입·lint·live 빌드가 통과한다. 기존 TanStack lint 경고 1건과 큰 chunk 경고는 남는다.
- 전체 테스트는 녹색이 아니다. 통합 전 fe/work 원본에서도 실패하는 기존 UI 기대값을 대조했다. 원본 실패 32건 중 31건이 그대로 남고, 새 실패는 없었다. 원장 navigation fixture 1건을 보정했다. 테스트를 건너뛰거나 기존 화면을 옛 기대값에 맞추지 않는다.
- 남은 전체 실패는 App/mock Alert·Episode/대시보드와 일부 LiveCases/LivePages의 기존 UI 기대값에 걸쳐 있다. 기능별 회귀 통과나 CI lint/build 성공을 전체 테스트 통과·사용자 검수 완료로 확대 해석하지 않는다.
- 401 뒤 새 로그인 workspace에서의 의견 복원과, Live 개요에서 정확한 근거 거래로 이동할 기존 컨트롤이 없는 부분은 이번 최소 변경에 포함하지 않는다. 새 디자인으로 채우지 않는다.

## 11월 4일 평가를 위한 대표 조사 경로

후속 변경도 기존 fe/work 화면을 사용한다. 폐기된 `GET /api/v1/dashboard` 대신 현행 `GET /api/v1/dashboard/summary`의 pipeline/investigation 집계를 기존 카드에 매핑한다. 집계가 아직 게시되지 않았으면 기존 오류 화면으로 알리며 0으로 만들지 않는다. 원장의 기존 연결 Alert 배지는 같은 Badge 안의 키보드 접근 가능한 버튼으로 동작한다. `alertId`를 그대로 사건 주소에 넣지 않고 `GET /api/v1/review/cases?kind=ALERT&query=A-<alertId>` 결과에서 정확히 일치하는 `alertId`의 `caseId`를 찾는다. 조회 실패/미발견은 기존 toast로 알린다. 새 화면·스타일·탭은 추가하지 않는다.

### 준비 환경과 재현 순서

1. 위 실행 명령으로 설치하고, 공유 서버와 분리된 합성 Backend 및 정상 STAFF 테스트 계정을 준비한다. Backend 소유 실행/DB 준비 절차를 따른다. 계정·비밀번호·세션 쿠키를 Git이나 로그에 남기지 않는다.
2. `VITE_API_MODE=live VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm dev`로 실행한다. 실제 Backend 주소가 다르면 해당 로컬 테스트 주소로 바꾼다. 최초 로그인 후 서버 업무 날짜 기준의 30일 대시보드가 표시되는지 확인한다.
3. 거래 내역에서 준비한 거래 ID를 검색하고 거래를 선택한다. 연결 Alert 배지를 눌러 원본 Alert가 가진 실제 조사 사건으로 이동한다. Alert ID와 case ID는 다를 수 있다.
4. 기존 거래 탭에서 조사 대상·맥락과 모델 점수의 출처를 확인한다. 기존 검토 의견 탭에서 의견을 저장한다. Network의 `POST /api/v1/review/commands` 응답과 이어지는 fresh GET의 revision/COMMENT 이력으로 저장을 확인한다.
5. **테스트 계정 본인 담당 OPEN 합성 사건에서만** 정상 판정을 선택하고 기존 최종 종결 확인창을 거친다. CLOSE 한 번, 후속 GET의 `status=CLOSED`, `outcome=NORMAL`, CLOSE 이력 한 건을 확인한다. 성공 toast만으로 완료를 판정하지 않는다.
6. 이미 종결한 사건을 초기화하거나 덮어쓰지 않는다. 재시연은 Backend 담당 절차로 별도 합성 사건을 준비한다. 공유 서버/운영 DB에서는 이 쓰기 시연을 실행하지 않는다.

2026-10-21 격리 합성 Backend `9dc31bab`와 실제 HTTP로 위 경로를 확인했다. 의견 저장 1회·정상 종결 1회가 각각 200이고 fresh GET으로 revision 변경/이력을 확인했다. 대시보드 summary는 200, 폐기 경로 요청은 0회였다. 이 관찰의 최소 기록은 [qa/mvp-acceptance-2026-10-21.json](qa/mvp-acceptance-2026-10-21.json)에 있다. 실제 서버 적용·실데이터 수용·사용자 디자인 검수 완료를 뜻하지 않는다. 이 저장소에는 임의 DB seed나 비밀이 포함되지 않으므로 새 clone만으로 같은 DB가 자동 생성되지는 않는다.

### AI 적용과 검증의 경계

- 현재 Backend 계약의 이진 모델은 `gnn-binary-v10 / materials-v1`, 유형 모델은 시연용 `demo-random-v1 / demo-input-v1`이다. 화면의 유형이나 대표 패턴을 검증된 실제 유형 예측이라고 설명하지 않는다.
- 위 합성 사건의 점수는 DB seed 값이다. 이번 브라우저 경로는 실제 GNN 추론을 실행하지 않았다. 점수 표시·API 왕복·판정 저장의 동작과 모델 성능은 서로 다른 증거다.
- 평가 전 필수 OPEN: 실제 준비 환경에서 분석 runId, 모델/피처 버전, 입력 범위·원본 라벨·임계값, 성공/실패 실행 로그를 확보하고 실제 추론 결과가 해당 사건에 연결됨을 확인한다. 정량 성능은 같은 검증 집합과 기준에서 산출한 precision/recall 등 원본 결과가 있을 때만 기재한다. 현재 이 README에는 검증되지 않은 정확도 수치가 없다.
- 참고 가능한 소스는 현행 dev의 `backend/inference-server/README.md`, `tests/test_binary_v10.py`와 parity fixture다. 가중치 재현 검사는 정확도 평가나 이번 서비스 추론 실행의 증거를 대신하지 않는다.

#### 모델 근거 확인 결과와 필요한 자료

2026-10-21 확보한 dev `0ab84296`의 [패키지 명세](https://github.com/dh0728/money_laundry/blob/0ab84296f3a32a8b58a03f75a9545c1641d35473/backend/inference-server/models/binary_v10/spec.py)와 [메타데이터](https://github.com/dh0728/money_laundry/blob/0ab84296f3a32a8b58a03f75a9545c1641d35473/backend/inference-server/models/binary_v10/assets/binary.json)를 대조했다. 자산 5개의 실제 바이트 SHA-256이 명세와 모두 일치한다. 가중치 지문은 `290f42b183466b4776de7032581f6d7ef18d9c72d08620b9c80eb0bb78806926`, export 메타데이터는 `source_experiment=ego_seed42`, epoch 10, `node19_edge17_v1`, 권장 임계값 `0.4338742792606354`다. 이는 저장된 패키지를 식별하며 서버가 그 가중치를 실행했다는 증거는 아니다.

- [기준 예측 원본](https://github.com/dh0728/money_laundry/blob/0ab84296f3a32a8b58a03f75a9545c1641d35473/backend/inference-server/tests/fixtures/binary_v10/expected_raw_predictions.json)은 18건, context_end `2022-10-03`, model_version은 위 가중치 지문의 앞 16자리다. 모든 `alert`가 score≥threshold와 일치한다. 정답 라벨·검증 집합 정의·precision/recall은 이 파일에 없다. [parity 검사](https://github.com/dh0728/money_laundry/blob/0ab84296f3a32a8b58a03f75a9545c1641d35473/backend/inference-server/tests/test_binary_v10.py)는 허용 오차 `2e-5`로 예측 재현을 검사하도록 구현돼 있다. 이번 확인은 파일·연결 규칙 검사이며 모델을 새로 실행하거나 해당 검사를 실행한 결과가 아니다.
- 확보한 `model@f2e44940`의 실험 지표 요약과 `mod-eunchong@065679e9`의 별도 GNN 노트북에는 평가 결과가 있다. 그러나 이 v10 가중치 SHA와 같은 검증 집합/실험이라는 연결 근거를 확인하지 못했으므로 현재 서비스 성능으로 인용하지 않는다. 전 저장소에 지표가 없다는 뜻도 아니다.
- 서비스 연결은 [API 계약](https://github.com/dh0728/money_laundry/blob/0ab84296f3a32a8b58a03f75a9545c1641d35473/backend/api-server/API.md)상 원본 Alert의 **공개 evidence version → `GET /api/v1/alerts/{alertId}/versions`의 runId**까지 추적할 수 있다. 현재 FE의 조사 DTO는 원본별 alertId/version과 점수를 읽으며 runId·모델 버전을 직접 제공하지 않는다. `GET /api/v1/batch-jobs/{jobId}`의 models는 **현재 run만** 반환하므로 과거 근거의 runId와 같다는 확인 없이 최신 모델 정보를 붙이면 안 된다. 현재 모델 등록표만으로 기존 사건의 점수 출처도 확정하지 않는다.
- **현재 미확보:** 실제 시연 사건에 연결된 완료 추론의 runId/requestId·동결 모델/피처 버전·입력/결과 무결성·게시 완료 로그, 그리고 위 가중치 SHA에 대응하는 라벨 기반 평가 원본. 접근한 패키지/기준 예측/실험 요약/합성 수용 기록만으로 이 연결을 입증할 수 없다. 합성 수용 DB의 COMPLETED run과 점수는 seed로 삽입됐으므로 실제 추론 증거에서 제외한다.
- **팀에서 받을 최소 자료:** ① 준비한 시연 사건의 caseId, 원본 alertId/evidence version, jobId/runId 및 해당 run에 동결된 BINARY/TYPE 버전·requestId·완료/게시 증거(과거 run은 Backend의 읽기 전용 확인 필요), ② 같은 가중치 SHA에 대응하는 평가 집합 식별/기간·분할·라벨 정의·표본/양성 수·임계값 선택 기준·precision/recall/PR-AUC 또는 confusion matrix 원본, ③ 같은 txId의 공개 점수·threshold와 화면 값의 대응 확인. 비밀·서명 URL·원시 고객 거래는 요구하거나 저장하지 않는다. 새 API나 추론 완료를 가정하지 않는다.

### 현재 검사와 평가 전 우선순위

- 후속 확정 코드: 타입 검사 포함 live 빌드 성공, lint 오류 0/기존 TanStack 경고 1. 전체 테스트 **41파일, 179 통과/30 실패**. 통합 전 원본 실패 32개와 이름을 대조했으며 새 실패는 없다. 테스트 삭제·skip·규칙 완화는 하지 않았다.
- 30개 분류: App/mock 대시보드·Alert·Episode 기대값 16개, LiveCases 13개, Live 대시보드 업무 영역 선택자 1개. LiveCases 실패는 기존 combobox/링크/상태 표시 기대값과 현재 radio UI의 차이 등이므로 API 실행 이전에 막히는 검사와 실제 도메인 검증을 구분해야 한다. 실제 정상 종결 경로는 위 HTTP 시연으로 확인했지만, 다른 의심 판정·Episode 편입·네트워크 재시도 전체가 검증됐다는 뜻은 아니다.
- 직접 회귀 실행: `pnpm exec vitest run src/api/liveDashboard.test.ts src/api/liveContracts.test.ts src/pages/LiveLedgerPage.test.tsx src/pages/LiveNavigation.test.tsx`. 의견 왕복·409 보존은 `pnpm exec vitest run src/pages/LiveCasesPage.test.tsx -t '같은 로그인 workspace|기존 의견 저장이 409'`로 확인한다. 관련 파일의 다른 기존 실패는 위 전체 결과에 포함된다.
- 시각 보존: 기존 CSS·shadcn·App/shell·CI 40파일의 diff가 없다. 1440×900/390×844의 동일 합성 선택 상태에서 원장 7개 영역의 클래스·계산 스타일·기하가 일치한다. 기존 사건 화면의 탭·판정 형태도 유지한다. 전체 화면의 픽셀 동일성이나 사용자 승인을 의미하지 않는다.
- **평가 전 필수:** 팀이 준비한 환경의 정상 로그인/권한/데이터 확인, 위 대표 경로의 최종 시연, 실제 AI 실행·출처/검증 결과 확보, 시연에 쓰는 상태/선택자 검사 정합성 확인. 기존 실패 30개를 단순히 모두 무시하거나, 반대로 디자인을 옛 테스트에 맞춰 되돌리지 않는다.
- **보류/OPEN:** 전면 재구축·새 디자인, 새 그래프 구조/명칭 결정, 전체 예외 시나리오 확장, 401 후 새 workspace의 의견 복원, 기존 개요에 없는 정확한 거래 이동 컨트롤, 신규 export/미합의 Backend 계약. 현재 대표 경로 외의 미검증 기능은 완료로 표시하지 않는다.

첫 반영본 `fd393a1a`의 [CI](https://github.com/dh0728/money_laundry/actions/runs/39617283217)는 Frontend lint/build와 Backend test/build 성공이다. fe/work는 자동 push CI 대상이 아니므로 기존 workflow_dispatch를 사용했다. 배포·Docker 작업은 모두 skipped이며, 이 CI에는 Frontend 테스트 실행이 포함되지 않는다. 후속 변경의 전달 SHA/CI는 해당 Git 기록과 실행 결과를 별도로 확인한다.
