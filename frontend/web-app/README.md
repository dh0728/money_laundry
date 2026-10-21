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

### fe/work 통합 검증의 한계

이번 변경은 생산 로직 4파일·검사 4파일·이 README에 한정한다. 원격 fe/work의 rem 글자 크기, 기존 판정 컨트롤과 대시보드 API·검사, 디자인 시스템·워크플로를 유지한다. dev 전체나 별도 재구축 앱을 병합하지 않는다.

- 원장 초기/선택/해제/검색과 사건 왕복의 탭·의견·409 보존을 직접 확인하는 회귀 7건이 통과했다. 1440×900·390×844의 합성 live UI에서 기존 fe/work와 같은 선택/검토 상태의 11개 영역 클래스·스타일·기하를 비교했다. 실제 서버 쓰기는 없다.
- 타입·lint·live 빌드가 통과한다. 기존 TanStack lint 경고 1건과 큰 chunk 경고는 남는다.
- 전체 테스트는 녹색이 아니다. 통합 전 fe/work 원본에서도 실패하는 기존 UI 기대값을 대조했다. 원본 실패 32건 중 31건이 그대로 남고, 새 실패는 없었다. 원장 navigation fixture 1건을 보정했다. 테스트를 건너뛰거나 기존 화면을 옛 기대값에 맞추지 않는다.
- 남은 전체 실패는 App/mock Alert·Episode/대시보드와 일부 LiveCases/LivePages의 기존 UI 기대값에 걸쳐 있다. 기능별 회귀 통과나 CI lint/build 성공을 전체 테스트 통과·사용자 검수 완료로 확대 해석하지 않는다.
- 401 뒤 새 로그인 workspace에서의 의견 복원과, Live 개요에서 정확한 근거 거래로 이동할 기존 컨트롤이 없는 부분은 이번 최소 변경에 포함하지 않는다. 새 디자인으로 채우지 않는다.
