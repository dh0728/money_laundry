# AML RADAR 전체 샘플 프론트엔드 인계

2026-11-15 작성 · `fe/work` 작업 트리의 전체 샘플 구현 인계.

> **작성 당시와 원격 반영 상태 구분:** 아래 각 작업 절의 “커밋·push·stage 없음”은 해당 절을 작성한 작업자가 그 시점에 수행하지 않았다는 이력이다. 이후 이 문서와 샘플 구현은 [`62c6624f`](https://github.com/dh0728/money_laundry/commit/62c6624f609c23c342ac03d8105a36818df88626)에 포함되어 `fe/work`에 반영됐다. 이후 문서 정정과 QA 변경의 반영 여부는 `fe/work`의 커밋 이력으로 확인한다. 구현의 원격 저장은 API 연동·운영 배포·전체 QA 통과·사용자 디자인 승인을 뜻하지 않는다.

사용자가 전체 화면 구현을 먼저 끝내고 디자인을 나중에 한 번에 검수하도록 범위를 확장했다. 이 기록은 기존 `first-bundle.md` 이후의 기능 구현과 데이터·성능 경계를 설명한다. Figma 최종 디자인 승인이나 운영 배포 기록이 아니다.

## 2026-11-16 Figma 디자인 검수 준비

[편집 가능한 검수 화면과 검증 경계](figma-review.md)를 별도로 기록했다. 실제 프로토타입 재생·웹 화면 일치·사용자 디자인 승인은 미확인이다. 아래 구현 및 테스트 기록과 구분한다.

## 2026-11-16 Mac 재검증

- 기간 선택: 적용 전 닫기·Escape는 변경 취소, Escape 후 키보드 초점 복귀. 빈 날짜·역순·미래 기간 적용 방지.
- 로그아웃·세션 만료: 이전 조회 결과·오류·업무 초안 초기화. 다시 로그인하면 초기 샘플 상태.
- `pnpm test --maxWorkers=2`: 69개 파일, 402개 테스트 통과. 4테마×4브랜드 및 토큰 참조 회귀 검사 포함.
- `pnpm lint`: 오류 0, 기존 TanStack Table 호환성 경고 1. `pnpm build`: 성공, 기존 큰 청크 경고 유지.
- 자동 검사 통과는 실제 화면 검수·디자인 수용·API 통합 완료를 뜻하지 않음. 라이트·다크 캡처와 사용자 검수는 별도.

## 실행과 상태 보존

앱: `frontend/implementation/1.14.0/web-app`. `pnpm dev --host 127.0.0.1 --port 5211 --strictPort`, 접속 `http://127.0.0.1:5211/`. `demo / radar-demo` 또는 샘플 계정 버튼. React + TypeScript + Vite, PageHeader 48px·Sidebar 240px, main 하나의 스크롤. 기존 ShellChrome 기본 스토리와 빈 콘텐츠 `/next-review.html`, 인계 당시 미커밋이었던 Storybook 구성을 보존한다(이후 위 구현 커밋에 포함).

`WorkspaceProvider`가 업무·거래·룰·판정·의견·알림·열린 업무를 공유한다. 페이지 이동은 상태를 유지하며 새로고침·로그아웃은 초기 샘플로 돌아간다. 표/카드·필터·선택·페이지는 해시 URL로 표현한다. 테마·브랜드·글자 크기만 브라우저 설정에 저장한다. 실제 인증·API·모델·서버 저장·운영 룰 배포는 연결하지 않았다. 기존 `src/app` live 시연 코드와 새 `src/next` 앱을 혼동하지 않는다.

## 공통 데이터와 유형 기준

- `src/next/dashboard-data.ts`: 2026-11-09~15 합성 거래와 업무 원본·기준일·마스킹 이름·점수·확률. Figma의 숫자를 데이터로 사용하지 않는다.
- `src/next/workspace-data.ts`: 위 원본으로 126 거래·24 업무·3 룰·6 초기 판정·3 알림을 구성한다. 사용자 조작으로 신규 Episode·판정·룰·알림이 추가된다. 계좌 47개·소유주 19명은 fixture에서 도출한다.
- `workspace-store.ts`: 새 앱 내부 계약. `LedgerTransaction`, `WorkspaceCase`, `RuleRecord`, `JudgmentRecord`, `WorkspaceNotification`은 확정된 백엔드 DTO가 아니다.
- `src/api/codes.ts`가 유형 값의 기준이다. 0 NON_PATTERN, 1 FAN-OUT, 2 FAN-IN, **3 GATHER-SCATTER**, **4 SCATTER-GATHER**, 5 CYCLE, 6 RANDOM, 7 BIPARTITE, 8 STACK. 화면은 패턴명과 확률을 함께 표시한다. 유형별 패턴 집계에서는 0을 제외한다.
- 사람 판정은 내부 `normal | abnormal`, 모델 점수·의심 여부와 별개다. FALSE_POSITIVE 판정 UI 없음. SUSPICIOUS를 확정 API 저장 값으로 보내지 않는다. 서버 연동 전 API 판정 enum 매핑을 확인해야 한다.
- 표시 ID, numeric caseId/sourceId는 독립적이다. 화면 ID 문자열을 잘라 API ID로 쓰지 않는다. 점수·확률 0~1, 금액 USD 또는 값 없음, 날짜 KST.
- AI 요약·보고서는 합성 데이터 설명문이다. 실제 AI 호출·정확도·실제 자금세탁 여부를 주장하지 않는다.

## 화면·Figma·출처·필요 데이터

Figma 파일 `eHgUPAyr9bZ2UC7oTZNmwh`의 아래 노드는 화면 구조 대응이다. 이번 전체 확장에서는 선행 조사 메타데이터와 문서를 재사용했으며 새 픽셀 대조를 수행했다고 주장하지 않는다. Figma MCP 동시 접근 없음·쓰기 없음.

초기 캡처의 기본 위치는 `/tmp/aml-complete-captures/`, 표의 `캡처명`에 `-light.jpg`, `-dark.jpg`를 붙인다. 첫 묶음 로그인 캡처와 4테마×4브랜드 행렬은 `/tmp/aml-first-bundle-captures/`에 별도로 남아 있다. 새 화면의 16조합과 화면별 상태 보완 검증은 아래 **추가 QA** 절과 `/tmp/aml-complete-theme-qa/`를 기준으로 한다.

| 화면 / 경로 | 대응 Figma 노드 | 숫자·글자 출처 / 필요한 서버 데이터 | 유형 값 | 캡처명 |
| --- | --- | --- | --- | --- |
| 로그인 `#/login` | 첫 묶음 문서 참조 | 앱 고정 문구·샘플 계정 / 세션·직원·역할·로그인 실패·만료 | 해당 없음 | 첫 묶음 login-light-dark |
| 내 담당·전체 대시보드 `#/dashboard/mine`, `/all` | 첫 묶음 문서 참조 | `selectDashboard`가 공유 거래·업무에서 집계 / 조회 기간·담당자 범위·서버 KPI·일별 건수·처리율·점수 구간·새 계좌/소유주·AI 요약·페이지별 업무 | 0~8, 패턴 차트 1~8 | dashboard-mine, dashboard-all |
| 룰 목록·사유 `#/rules?selected=RULE-001` | 3420:11402 / 3456:12547 | 공유 rules·history / 룰 ID·이름·조건·버전·상태·작성자·시각·사유·권한·허용 전이·검색 페이지 | 0~8 또는 전체 | rules |
| 룰 생성·수정 `#/rules/new?edit=RULE-001` | 3420:11917 | 입력 draft·검증 오류·`saveRule` 결과 / 스키마·validation·revision·작성/수정·실패 응답 | 0~8 또는 전체 | rule-create |
| 백테스트 `#/rules/RULE-001/backtest` | 3420:12337 | fixture 거래에 동일 계좌 시간 창 평가 / 비동기 job ID·조건/룰 버전·기간·진행률·취소·총계·결과 cursor·오류 | 0~8 | backtest |
| 원장 `#/investigate/ledger` | 3522:12443 | 공유 transactions로 소유주·계좌·입출금 집계 / owner/account/transaction 검색 페이지·집계·방향·거래 금액·소유 관계·연관 caseId | 0~8 | ledger |
| Alert 카드·표 `#/investigate/alerts?view=cards/table` | 3267:7243 / 3320:14760 | 공유 records에서 ALERT / 검색·기간·담당·판정·상태·위험도·유형·정렬·페이지·전체 수 | 0~8 | alerts-cards, alerts-table |
| Episode 카드·표 `#/investigate/episodes?view=cards/table` | 3267:7250 / 4044:14857 | 공유 records에서 EPISODE / 위 목록 필드와 묶인 Alert·중복 제거 거래 수·USD 총계 | 0~8 | episodes-cards, episodes-table |
| Alert 묶기 `mode=bundle` | Alert 목록 묶기 모드 | 선택 가능한 내 담당·미종결·미묶음 업무·사유 / 원자적 생성·새 Episode ID·원본 연결·revision·충돌 응답 | 0~8 | 추가 QA의 alert-bundle-cards/table/dialog 및 light-dark 묶음 |
| Alert 개요 전체·패널별 `#/alerts/8100?tab=overview&mode=all/per` | 3031:7313 / 3130:9205 | 공유 case·근거 거래·관련 계좌·history·합성 요약 / 상세·근거 cursor·계좌 집계·USD 총계·AI 요약 | 0~8 | alert-overview, alert-panel |
| Alert 분석 패턴·소유주 `tab=analysis&view=pattern/owner` | 3031:7320 | case 근거 거래로 방향 그래프 / 제한된 neighborhood·노드/엣지·방향/금액/위험도·소유주 매핑·생략 수·기간 | 0~8 | alert-analysis, alert-owner |
| Alert 연관·검토 `tab=related/review` | 3031:7327 / 공통 검토 | transaction/계좌 중복 및 직접 연결·공유 comments/history / 서버 연관 후보 cursor·연결 근거·권한·의견 이력 | 0~8 | alert-related, alert-review |
| 다른 담당자 상세 | 3763:15893 | assigneeId·status 기반 읽기 전용 / 서버 접근·수정 권한·revision | 0~8 | alert-readonly |
| Episode 개요·분석·연관 `#/episodes/8102?tab=overview/analysis/related` | 3031:7335 / 3031:7342 / 3031:7349 | Alert 상세와 같은 계약 + 연결 Alert IDs·중복 제거 거래 / 서버 case evidence·관계 집계 | 0~8 | episode-overview, episode-analysis, episode-related |
| 단일·복수 판정 공통 다이얼로그 | 3763:14855 / 3763:15019 / 3763:15556 | 공유 선택 업무·사유·revision·판정 저장 결과 / 권한 재검증·원자적 판정·불변 근거·판정 ID·실패/충돌 | 유형은 선택 업무의 0~8, 판정은 내부 normal/abnormal | verdict, verdict-error-dark |
| 보고서 표·카드 `#/report?view=table/cards` | 4240:15822 / 4240:16259 | 저장된 JudgmentRecord의 고정 case snapshot·reportText / 판정 기록 cursor·선택 IDs·KST 기간·사유·검토자·PDF/export job | 0~8 근거 보존 | report-table, report-cards |
| 알림 drawer | 3031:7357 | 공유 notifications·read / 알림 페이지·읽음 변경·대상 경로·미확인 수·권한 | 해당 없음 | notifications |
| 계정 dialog | 3031:7363 | 마스킹 직원·STAFF 고정 샘플 / 실제 직원 프로필·역할·세션·로그아웃 | 해당 없음 | account |
| 설정 dialog | 3031:7369 / 4239:15664 | 로컬 표시 설정 draft·적용 / 사용자 설정 저장 정책·지원 theme/accent/fontSize | 해당 없음 | settings |

## 상태·동작 계약

- 개발 서버 상단 `검수 상태`로 목록/대시보드/상세/보고서의 로딩·빈 결과·재조회 오류를 재현한다. 상세는 원래 업무를 유지하는 오류 배너와 재시도, 빈 결과는 다시 조회를 제공한다. `case-loading/empty/error-{light,dark}.jpg`에 남겼다. 개발 도구는 production build에서 숨긴다.
- 룰 목록·원장·업무 목록·보고서 재조회 실패는 직전 성공 결과와 빈 결과를 유지한다. 필터 draft는 적용 시 URL에 반영한다. 날짜 역전·잘못된 날짜는 검증한다. 백테스트는 실행 전·실행 중·0건·성공·재실행 오류가 다르며 이전 결과를 유지한다.
- 생성/설정/계정은 로컬 입력·로컬 조회라 별도 네트워크 로딩이 없다. 실제 서버가 연결되면 각 mutation pending·validation·권한·실패 응답을 연결해야 한다. lazy route import에는 공통 로딩 표시가 있다.
- 단일·최대100건 복수 판정은 사유 필수, 최종 확인 후 저장한다. 타 담당·종결 항목·revision 충돌이 섞이면 전체 실패, 상태와 판정 기록을 일부만 저장하지 않는다. 실패/충돌은 입력을 보존한다. 거래 판정은 연결 업무 전체의 담당·종결 여부를 검사한다.
- Alert 묶기는 2~100건, 내 담당·미종결·미묶음만 허용한다. 거래 ID를 deduplicate하고 새 Episode를 만들며 Alert 처리 상태·사람 판정은 그대로 유지한다.
- 룰은 초안→승인 대기→테스트→운영/반려/중지 등의 허용된 전이만 사유와 함께 기록한다. 실제 승인자 역할과 운영 배포 정책은 미확정이므로 모의 전이임을 표시한다.
- 상세 개요 all/per, 패턴/소유주 그래프, 기간·위험도·노드 선택·재생/속도·확대/맞춤/전체화면, 근거 표·거래 상세·관련 계좌·연관 업무·검토 의견을 제공한다. 열린 업무는 6개씩 페이지로 표시하며 총 탭 개수 제한은 두지 않는다.
- 보고서 링크의 selected ID는 해당 기록이 있는 페이지로 진입한다. 명시한 page는 우선하며 화면 이동 시 숨겨진 선택을 내보내지 않는다. 판정 당시 근거를 복사해 저장하므로 이후 데이터 변경이 과거 보고서를 바꾸지 않는다.
- PDF는 선택한 기존 판정을 하나의 실제 PDF로 내보낸다. 한국어 A4 캔버스 raster 방식이므로 텍스트 검색·복사·벡터 인쇄는 지원하지 않는다. PDF 최대25판정·100쪽·32MiB 이미지 예산. 대규모/장기보관 보고서는 서버 생성이 필요하다. CSV는 BOM·CRLF·따옴표 escape·공백/탭/개행 뒤 수식 시작 문자 방어를 사용한다.

## 수억 건 처리 경계와 운영 API 인계

이 구현은 126건 합성 데이터의 프론트 작업 흐름이다. 수억 건 실데이터 처리나 SLA/부하 성능을 검증한 결과가 아니다. **원장 전체를 내려받아 프론트에서 집계하는 구조로 운영 연결하면 안 된다.**

| 영역 | 이번 프론트 제한·최적화 | 운영에서 필요한 처리 |
| --- | --- | --- |
| 공유 샘플 adapter | 각 collection 최대10,000, 업무 거래/이력/의견 누적 참조 예산10,000. 초과하면 집계 이전에 서버 조회 필요 상태 | 화면별 bounded DTO, 전체 원장 hydrate 금지, 서버 권한/validation |
| 대시보드 | 대시보드 경로에서만 계산, first-seen snapshot index 캐시, 보드 상태별 최대25카드 | 서버 집계/요약 캐시·snapshot/asOf·기간별 preaggregation, 업무 preview+다음 cursor |
| 목록/표 | 25/50/100행 페이지, 정확한 총계·표시 범위, 필터 변경 시 page reset | stable keyset cursor, 허용 pageSize≤100, 정렬 tie-break ID·snapshot, timeout/취소·stale response 방지 |
| 원장 집계 | transaction 한 번 순회 Map, immutable snapshot+filter 캐시, 큰 입력은 행 접근 전 거절 | owner/account aggregate endpoint와 거래 page, 전체 COUNT/대형 OFFSET 반복 금지, 필요한 인덱스·partition/쿼리 계획 검증 |
| 상세/연관 | 전체 원장 인덱스 생성 전 예산 검사, case ID 기반 evidence·표 페이지 | case-scoped evidence/related/neighborhood cursor, lineage·권한 검사·revision |
| 그래프 | 입력10,000 예산, 노드200·엣지400, 실제 생략 수 표시·초과 입력은 서버 필요 | bounded neighborhood 질의, 서버 군집/요약·expand, SVG 수만 노드 렌더 금지 |
| 백테스트 | 입력10,000 예산, 계좌별 정렬 후 two-pointer/구간 누적. 결과≤100행. 날짜 범위는 snapshot당 한 번 순회 | 비동기 job·진행률·취소·재시도·버전 고정·서버 결과 cursor |
| 판정/묶기 | 선택≤100, optimistic revision·원자성 모의 검증 | DB transaction·idempotency·권한/배정/revision 재검증·audit·409응답 |
| CSV/PDF | 화면의 bounded page/선택 범위, PDF 자원 상한·순차 처리 | 비동기 export job·상태·서명 다운로드·만료/권한·감사, 브라우저 수백만행 Blob 생성 금지 |
| 로딩 | route lazy import, feature CSS/JS 분할 | 요청 debounce·AbortSignal·쿼리 키별 cache budget·무효화·최신 응답 보장, 실제 API 단계에서 검증 |

`backend/api-server/API.md`는 참고만 했다. 위 API 이름/방식은 인계 요구사항이며 존재하거나 확정된 서버 endpoint로 표시하지 않는다. 상세 페이지 DTO·룰 job·보고서 job·role·판정 enum·Display ID 규칙·대시보드 집계 정의는 팀 계약 확인이 남아 있다. 측정할 때는 실제 데이터 분포/권한/선택도/동시성/새 데이터 유입을 포함해 서버 query plan, p95/p99, 응답 byte/행수, 브라우저 main-thread long task·메모리·DOM 노드 수를 기록해야 한다.

## 검증과 증거

구현 완료 시점의 명령 결과는 아래 검증 로그를 기준으로 한다. 추가 QA는 문서·캡처만 보완했으며 아래 테스트·빌드를 다시 실행하지 않았다. 디자인 확정 검수는 보류다.

- 전체 Vitest: **64파일·351 tests 통과**. 빌드·Storybook·테스트를 동시에 실행한 중간 run에서 보존한 legacy `src/app/App.test.tsx` 한 테스트가 5초 timeout이었다. 코드 변경 없이 해당 파일23개와 전체350개 및 CSV 페이지 제한 추가 후351개를 다시 실행해 통과했다.
- ESLint: 오류0, 기존 `src/hooks/use-data-table.ts`의 TanStack/React Compiler 경고1.
- TypeScript+Vite build 및 Storybook static build 통과. 보존한 legacy review/Graph 청크 크기 경고는 남아 있다. 새 route JS는 별도 chunk다.
- 새 회귀: 권한·원자성·revision/실패 입력 보존·중복 제거 묶기·고정 보고서·새 룰 상태 공유·페이지 경계·26번째 보고서 링크·형식 오류 URL·CSV 수식 방어·PDF 구조/자원 예산·UTC 브라우저 KST·초과 원장 zero row access를 포함한다. **1억 건 length Proxy는 실제 1억 건 적재 테스트가 아니라 초과 입력의 행을 읽지 않는다는 경계 검증**이다.
- 실제 IAB 브라우저: Alert8100+8106→Episode8224(E-261115-000065), 6거래·17,880USD; 그래프 node900→연결 거래1건; Episode 이상 판정→J-261115-000007→보고서; 다운로드 PDF1.4/1페이지; 룰001 백테스트7거래·7계좌·75,355USD; 승인 요청·룰004 생성·내비게이션 공유; 원장 소유주600/계좌900 선택→5거래; 타 담당8101 판정 비활성; 의견 저장; 판정 저장 실패 사유 유지; 알림 모두 읽음; 설정 large 적용·기본 복원; 카드/표 전환·빈 결과 재조회 확인.
- 초기 브라우저 콘솔 error0. 1920×1080에서 body/document 폭1920, main x240/y48/1680×1032 확인. 1280×720 일부 경로도 확인했다. 이후 16조합 검증 범위와 한계는 추가 QA 절을 따른다. 모바일/전 화면 반응형 종합 QA는 미검증이며 native Chrome은 앞선 크래시 이후 사용하지 않았다.
- 캡처61장 및 묶음5장: `investigation-matrix.jpg`, `case-detail-matrix.jpg`, `analysis-matrix.jpg`, `operations-matrix.jpg`, `utility-state-matrix.jpg`. 모두 열어 확인했으며 일부 개요 캡처는 main의 아래 표 스크롤 위치다. 스타일 승인·Figma pixel parity 판정은 하지 않았다.
- `tokens.css` SHA256 `3f83c37f7436d563765c965361fde090bd47c1920de5cd4aab5563aa568a7db4`; `tokens.json` `da7fece43133a8a5870028c24d8d2ae6d9fbb9a5746bf0195df6a27d1e6dc997`. 보존한 v3 snapshot과 일치한다.
- Figma 이번 확장 create_session1, 선행 첫 묶음11호출과 합산 최근24시간 기록12호출. 다른 새 Figma 읽기/쓰기 없음.

로그: `/tmp/aml-complete-{alltests,lint,build,storybook}.log`. 캡처와 로그는 임시 로컬 증거이며 저장소에 대용량 이미지를 추가하지 않았다. 남은 운영 blocker는 실제 인증/API·서버 대량 집계/페이지/job·권한/도메인 계약·실데이터 부하 검증이고, 사용자 디자인 검수는 별도 단계다.

## 추가 QA: 4테마 × 4브랜드와 화면별 상태 (2026-11-15)

**초기 추가 QA 판정: 부분 완료.** 아래 범위의 렌더링과 모의 상태 재현 증거를 보완했다. 이 시점에 발견한 대비 결함 2건은 아래 후속 수정 절에서 해소했다. 서버 연동 등 미검증 항목은 계속 남아 있으므로 전체 QA 통과나 디자인 승인을 뜻하지 않는다. 이 초기 감사에서는 앱 소스·기존 Storybook·원본 v3 토큰을 수정하지 않았고 커밋·push·Figma 호출도 하지 않았다.

### 실행 범위와 증거

- 실제 IAB, 로컬 개발 앱 `http://127.0.0.1:5211/`, 마스킹 샘플 STAFF 계정, 1920×1080, 기본 글자 크기. 브라우저 제어와 캡처는 CUA로 수행했다. native Chrome 재실행은 하지 않았다.
- Default Light/Dark와 Solarized Light/Dark × Sky/Violet/Pink/Lime **16조합**. 아래 42개 화면 변형마다 16회, 총 **672개 안정화 캡처**를 수집했다. 42는 탭·오버레이·아래쪽 스크롤을 포함하는 수이며 서로 다른 제품 페이지 42개를 뜻하지 않는다. 알림의 이 행렬은 안 읽은 항목이 없는 상태다.
- 테마 전환 직후의 중간 색을 결과로 사용하지 않도록 루트와 표시 버튼·현재 링크의 계산된 색/배경이 연속 3회 일치한 뒤 기록했다. 최종 672개 모두 `stabilization.stable=true`다.
- 별도 상태·입력 검증·실패 캡처 178개를 합쳐 **고유 개별 캡처 850개**. 개별 파일 전체를 원본 배율로 육안 정밀 검수했다고 주장하지 않는다. 42개 행렬 및 상태 모음을 열어 전체 배치·테마 적용을 확인하고, 브라우저 DOM의 문구·값·기하·계산된 대비를 함께 검사했다.
- 최종 문서 가로 overflow 0, main 내부 가로 overflow 0. 의도적으로 숨긴 1px 검색 label을 제외한 표시 텍스트 잘림 후보 0. 아래쪽 표는 별도 스크롤 캡처로 확인했다. 모든 키보드 순서·초점·hover·SVG 글자·native input 내부 글자·모바일·실제 네트워크 실패·전 상태×16조합은 미검증이다.
- 추가 QA 브라우저 console error 0. 종료 시 뷰포트를 기본 크기로 복원했다. `src/next` 55개 파일의 상대 경로+내용 SHA256을 시작·종료에 비교하여 `0fee6f443b455fdf36bd5c2e0a5bfc6a68d2ca2807d1524bd8a86468f768934e` 일치를 확인했다(`source.sha256`). 원본 두 토큰의 SHA256도 위 기록과 일치한다.

모든 추가 증거의 루트는 **`/tmp/aml-complete-theme-qa/`**이다.

| 증거 | 파일 규칙 / 내용 |
| --- | --- |
| 개별 조합 캡처 | `{화면명}-{theme}-{brand}.jpg` |
| 16조합 행렬 | `{화면명}-matrix.jpg`, 작은 열람본 `{화면명}-compact.jpg`. 행은 light/dark/solarized-light/solarized-dark, 열은 sky/violet/pink/lime |
| 화면별 상태 | `{화면명}-state-{loading/empty/error}-{light/dark}-sky.jpg`, 모음 `{화면명}-states-sheet.jpg` |
| DOM 원자료 | `results.json`: 850개 개별 캡처의 theme/brand·overflow·잘림 후보·대비 후보·문구·안정화 기록 |
| 상태 판정 원자료 | `state-results.json`: 165개 관찰. 기대 문구 일치 148, 불일치 13, 판정 대화상자 복합 관찰 4. 불일치를 통과로 세지 않음 |
| 파일 무결성과 범위 | `manifest.json`: 850개 경로·SHA256·안정화 여부. `coverage.csv`: 42개 화면 변형별 조합 수·기하·대비 후보·상태 검증 여부 |

### 16조합으로 확인한 화면 변형

| 묶음 | 캡처 화면명 | 수 |
| --- | --- | --- |
| 룰 | rules, rules-reason, rule-create, rule-edit, rule-backtest | 5 |
| 원장 | ledger, ledger-lower | 2 |
| 업무 목록 | alerts-cards, alerts-cards-lower, alerts-table, episodes-cards, episodes-table | 5 |
| Alert 묶기 | alerts-bundle-cards, alerts-bundle-table, alerts-bundle-dialog | 3 |
| Alert 상세 | alert-overview, alert-overview-lower, alert-panel, alert-analysis, alert-analysis-lower, alert-owner, alert-related, alert-review, alert-readonly | 9 |
| Episode 상세 | episode-overview, episode-overview-lower, episode-panel, episode-analysis, episode-owner, episode-related, episode-review | 7 |
| 보고서 | report-table, report-cards | 2 |
| 공통 기능 | notifications, settings, account | 3 |
| 업무 오버레이 | rule-status-dialog, alert-verdict-dialog, episode-verdict-dialog, bulk-verdict-dialog, transaction-detail-dialog, transaction-verdict-dialog | 6 |

로그인·내 담당/전체 대시보드의 첫 묶음 16조합 증거는 `first-bundle.md`와 `/tmp/aml-first-bundle-captures/`에 유지했다. 이번 672개에는 중복해 포함하지 않았다.

### 초기 감사에서 발견한 대비 결함 — 당시 원본 기록

1. **중요: Sky의 활성 primary 버튼 흰 글자 대비 부족.** `rgb(255,255,255)` / `rgb(13,153,255)` = **2.99:1**, 일반 크기 텍스트 AA 기준 4.5:1 미달. 4테마에서 재현했다. 예: 룰 만들기·초안 저장·적용·판정하기·Episode 만들기·PDF 다운로드·설정 적용·로그아웃. 백테스트 버튼의 관찰된 hover 배경은 `rgb(0,144,242)`로 **3.35:1**이며 역시 미달이다. 증거: `rule-create-light-sky.jpg`, `settings-dark-sky.jpg`, `alerts-bundle-dialog-dark-sky.jpg` 및 각각 행렬. 안전한 후속안은 원본 토큰을 보존하면서 v3 안에서 기준을 충족하는 foreground/background 의미쌍을 정하는 것이다. 흰 글자를 그대로 쓸 경우 배경 쌍 검증이 필요하다.
2. **중요: 선택된 룰 행의 백테스트 링크가 읽기 어려움.** `#/rules?selected=RULE-001`에서 선택 행의 역상 글자색과 secondary 버튼 자체 배경이 섞여 **Light/Solarized Light 1.35:1, Dark/Solarized Dark 1.47:1**, 4브랜드 모두 재현했다. 증거: `rules-reason-{theme}-{brand}.jpg`, `rules-reason-matrix.jpg`. 원인 후보: `src/next/styles/workspace.css:13`의 선택 행 링크/버튼 색 상속과 `src/next/styles/rules.css:11`의 역상 행, `src/next/features/RulesPage.tsx`의 secondary 링크 조합. 후속안은 선택 행의 secondary 버튼 전경·배경을 함께 지정하거나 선택 행 배경을 그대로 쓰는 변형을 적용하는 것이다.

대비 측정은 표시된 직접 텍스트와 조상 배경의 alpha 합성을 대상으로 했다. disabled·숨김·SVG·native input 내부 글자는 제외했다. 이 제한된 검사에서 확인한 결함이며 전체 접근성 인증이 아니다. 디자인 취향 판단은 보류하되 읽기 가능성 결함은 남은 작업으로 기록한다.

### 화면별 로딩·빈 결과·오류 검증

아래 표의 **확인**은 Default Light와 Default Dark, **Sky**에서 개발용 검수 상태를 UI로 선택하고 기대 문구·기존 데이터 표시를 관찰한 결과다. 실제 API timeout/HTTP 오류를 발생시킨 테스트가 아니다. 공통 상세 wrapper를 쓰는 탭도 각각 진입해 기록했다. **24개 변형 × 3상태 × 2테마 =144개 문구 일치**다. 상태별 16조합 전체 교차 검사는 미검증이다.

| 화면명 | 로딩 | 빈 결과 | 오류 | 증거 / 한계 |
| --- | --- | --- | --- | --- |
| rules | 확인 | 확인 | 확인 | rules-states-sheet.jpg |
| rules-reason | 확인 | 확인 | 확인 | rules-reason-states-sheet.jpg |
| ledger | 확인 | 확인 | 확인 | ledger-states-sheet.jpg; 기존 원장 표시 유지 |
| alerts-cards | 확인 | 확인 | 확인 | alerts-cards-states-sheet.jpg |
| alerts-table | 확인 | 확인 | 확인 | alerts-table-states-sheet.jpg |
| episodes-cards | 확인 | 확인 | 확인 | episodes-cards-states-sheet.jpg |
| episodes-table | 확인 | 확인 | 확인 | episodes-table-states-sheet.jpg |
| alerts-bundle-cards | 확인 | 확인 | 확인 | alerts-bundle-cards-states-sheet.jpg |
| alerts-bundle-table | 확인 | 확인 | 확인 | alerts-bundle-table-states-sheet.jpg |
| alert-overview | 확인 | 확인 | 확인 | alert-overview-states-sheet.jpg |
| alert-panel | 확인 | 확인 | 확인 | alert-panel-states-sheet.jpg |
| alert-analysis | 확인 | 확인 | 확인 | alert-analysis-states-sheet.jpg |
| alert-owner | 확인 | 확인 | 확인 | alert-owner-states-sheet.jpg |
| alert-related | 확인 | 확인 | 확인 | alert-related-states-sheet.jpg |
| alert-review | 확인 | 확인 | 확인 | alert-review-states-sheet.jpg; 의견 저장 mutation 상태는 별도 미검증 |
| alert-readonly | 확인 | 확인 | 확인 | alert-readonly-states-sheet.jpg; 타 담당 판정 비활성 |
| episode-overview | 확인 | 확인 | 확인 | episode-overview-states-sheet.jpg |
| episode-panel | 확인 | 확인 | 확인 | episode-panel-states-sheet.jpg |
| episode-analysis | 확인 | 확인 | 확인 | episode-analysis-states-sheet.jpg |
| episode-owner | 확인 | 확인 | 확인 | episode-owner-states-sheet.jpg |
| episode-related | 확인 | 확인 | 확인 | episode-related-states-sheet.jpg |
| episode-review | 확인 | 확인 | 확인 | episode-review-states-sheet.jpg; 의견 저장 mutation 상태는 별도 미검증 |
| report-table | 확인 | 확인 | 확인 | report-table-states-sheet.jpg |
| report-cards | 확인 | 확인 | 확인 | report-cards-states-sheet.jpg |

아래는 위 144개와 구분하는 미검증·일부 검증 항목이다. 파일 이름에 loading/error가 있어도 실제 상태가 관찰되지 않은 시도는 증거로 인정하지 않았다.

| 화면 / 동작 | 로딩 | 빈 결과 / 빈 입력 | 오류 | 검증 증거와 남은 범위 |
| --- | --- | --- | --- | --- |
| 로그인 | 이번 미검증 | 첫 묶음 참조 | 첫 묶음 참조; 실제 인증 오류 미검증 | 새 API 상태 검증 없음 |
| 내 담당 대시보드 | 이번 미검증 | 첫 묶음 상태 기록 참조 | 첫 묶음 상태 기록 참조 | 새 fixture로 화면별 3상태 재검증 미실시 |
| 전체 대시보드 | 이번 미검증 | 첫 묶음 상태 기록 참조 | 첫 묶음 상태 기록 참조 | 새 fixture로 화면별 3상태 재검증 미실시 |
| rule-create | **미구현/미검증** | 로컬 빈 draft만 확인; 서버 빈 결과 미검증 | 로컬 필수입력 오류 Light/Dark 확인; 서버 실패 미검증 | rule-create-validation-error-{light,dark}-sky.jpg. 검수 상태 6회 모두 화면 변화 없음 |
| rule-edit | **미구현/미검증** | 서버 빈 결과 미검증 | 서버 실패·이번 브라우저 validation 재검증 미검증 | rule-edit-states-sheet.jpg는 실패한 재현 시도이며 통과 증거 아님 |
| rule-backtest | **브라우저 시각 상태 미검증** | Light/Dark 0거래·0계좌·0USD 확인 | 재실행 오류에서 직전 0건 결과 유지 확인 | rule-backtest-state-{empty,error}-{light,dark}-sky.jpg. 150ms 실행을 캡처할 때 이미 성공 상태였으므로 loading-light 파일은 로딩 증거 아님. 컴포넌트 테스트와 실제 브라우저 관찰 구분 |
| Alert 단일 판정 | 서버 pending 미검증 | 필수입력 비었을 때 확인 버튼 disabled 확인 | 저장 실패·revision 충돌·사유 유지·최신 상태 확인 버튼 Light/Dark 확인 | alert-verdict-states-sheet.jpg; 실제 HTTP/서버 원자성 미검증 |
| Episode 단일 판정 | 서버 pending 미검증 | 필수입력 비었을 때 확인 버튼 disabled 확인 | 저장 실패·revision 충돌·사유 유지·최신 상태 확인 버튼 Light/Dark 확인 | episode-verdict-states-sheet.jpg; 실제 HTTP/서버 원자성 미검증 |
| 복수 판정 | 서버 pending 미검증 | 필수항목 미입력 화면 확인; 빈 대상 호출 미검증 | 이번 저장 실패/충돌 재현 미검증 | bulk-verdict-dialog 16조합; 기존 단위 테스트와 구분 |
| 거래 판정 | 서버 pending 미검증 | 이번 빈 입력 재현 미검증 | 이번 저장 실패/충돌 재현 미검증 | transaction-verdict-dialog 16조합 렌더링만 확인 |
| Alert 묶기 dialog | 서버 pending 미검증 | 이번 빈 사유 검증 미검증 | 이번 저장 실패/충돌 재현 미검증 | alerts-bundle-dialog 16조합; 초기 성공 journey와 구분 |
| 룰 상태 변경 dialog | 서버 pending 미검증 | 이번 빈 사유 검증 미검증 | 이번 저장 실패/충돌 재현 미검증 | rule-status-dialog 16조합 렌더링만 확인 |
| 거래 상세 dialog | 서버 조회 로딩 미검증 | 없는 거래 상세 미검증 | 서버 조회 실패 미검증 | transaction-detail-dialog 16조합 렌더링만 확인 |
| 알림 drawer | **미구현/미검증** | 모두 읽음 후 안 읽은 알림만 선택하여 0건 Light/Dark 확인 | **미구현/미검증** | notifications-empty-{light,dark}-sky.jpg. 메모리 알림 조회이며 실제 서버 상태 없음 |
| 계정 dialog | **미구현/미검증** | 프로필 없음 미검증 | 프로필/로그아웃 서버 실패 미검증 | account 16조합 렌더링만 확인 |
| 설정 dialog | 서버 pending 미검증 | 빈 서버 설정 미검증 | 서버 저장 실패 미검증 | settings 16조합. 현재 localStorage 표시 설정 |
| Episode 타 담당 읽기 전용 | **미검증** | **미검증** | **미검증** | 해당 샘플 진입 경로 별도 재현 없음. Alert 읽기 전용 결과를 대체 증거로 쓰지 않음 |
| PDF/CSV 생성·다운로드 | 이번 진행 상태 미검증 | 빈 선택 안내 재현 미검증 | 생성 실패/자원 초과 브라우저 재현 미검증 | 초기 실제 PDF 다운로드 및 기존 단위 테스트와 구분 |

### Alert 묶기 전용 제출 캡처

안정화된 원본에서 별도 이름으로 복사했다. Default Light/Dark × Sky이며 선택 2건과 사유 입력 화면을 포함한다.

- `alert-bundle-cards-light.jpg`, `alert-bundle-cards-dark.jpg`
- `alert-bundle-table-light.jpg`, `alert-bundle-table-dark.jpg`
- `alert-bundle-dialog-light.jpg`, `alert-bundle-dialog-dark.jpg`
- 한눈에 보는 모음: **`alert-bundle-light-dark.jpg`** — 위에서부터 카드·표·사유 대화상자, 왼쪽 Light·오른쪽 Dark.
- 나머지 브랜드/테마까지는 `alerts-bundle-{cards,table,dialog}-matrix.jpg`의 각 16조합을 참조한다.

### Figma 대응과 대량 데이터 검증의 구분

위 Figma 노드 표는 **대응 화면을 찾아둔 목록**이다. 이번 추가 QA에서 Figma 원본을 열어 동일 뷰포트·동일 상태로 나란히 비교하거나 픽셀 차이를 측정하지 않았다. **Figma 실제 시각적 일치 검수는 미검증**, 사용자 최종 디자인 검수는 보류다. 로컬 16조합 렌더링 확인을 Figma 일치 판정으로 바꾸어 표현하지 않는다.

**1억 건 length Proxy 검사는 초과 입력을 행 접근 전에 조기 거절하는 경계 테스트**다. 1억 건을 적재·조회·집계·렌더링한 부하 검사가 아니다. 이번 850개 캡처도 126건 샘플 화면 QA다. 실제 수억 건 데이터·동시 사용자·p95/p99·서버 쿼리 계획·메모리/long-task 부하 검증은 미실시이며 운영 승인 근거로 쓰지 않는다.

## 대비 결함 2건 수정 및 16조합 회귀 (2026-11-15)

사용자 지시로 위 대비 결함만 수정했다. **두 결함의 지정 회귀 검사는 통과**했으며, 디자인 취향 확정·Figma 시각적 일치·서버 상태·실데이터 부하의 기존 미검증 판정은 유지한다. 초기 850개 캡처와 상태 원자료를 덮어쓰지 않았다. 새 증거 루트는 **`/tmp/aml-contrast-fix-qa/`**이다.

### 변경

- `src/next/styles/app.css`: 앱의 Sky `--aml-brand-ink`를 기존 v3 `--aml-gray-020`으로 매핑했다. 파란 배경은 그대로이며 기존 의미 토큰 `text/on-primary`·`icon/on-primary`가 어두운 잉크를 함께 상속한다. 앱 루트와 중첩 shell의 theme scope, 앱 루트 안에 렌더링하는 portal dialog를 모두 포함한다. 원본 `tokens.css/json`과 독립 ShellChrome 스토리는 수정하지 않았다.
- `src/next/styles/workspace.css`: 선택 표 행의 secondary 버튼은 `--aml-text-primary` / `--aml-surface-muted` 전경·배경 쌍을 함께 적용한다. 선택 행의 역상 글자를 버튼 자체 배경 위에 상속하던 문제가 해소된다. 기존 hover outline은 유지한다.
- 기능 문구·도메인 값·선택·이동·저장 동작은 변경하지 않았다. 새 라이브러리·JavaScript 계산·전역 데이터 작업은 추가하지 않았다.

### 선택지별 실제 문구와 측정 근거

UI의 테마 선택지 문구는 **기본 라이트(light), 기본 다크(dark), 솔라라이즈드 라이트(solarized-light), 솔라라이즈드 다크(solarized-dark)**이고 브랜드 선택지는 **Sky(sky), Violet(violet), Pink(pink), Lime(lime)**다. 아래 값은 해당 선택지를 UI로 고른 뒤 스타일 안정화를 확인하고, 실제 표시 문구와 계산된 foreground/background를 읽어 sRGB 상대 휘도로 산출했다. 일반 크기 글자의 기준은 **4.5:1**이다.

각 브랜드의 primary 버튼에서 확인한 표시 문구는 **룰 만들기·승인 요청·초안 저장·설정 적용**이다. 앞의 두 문구는 선택된 룰 화면에서 수정 전후 각각16조합, 뒤의 두 문구는 작성 화면과 portal 대화상자에서 수정 후 각각16조합으로 확인했다.

| 브랜드 선택지 | 기본 라이트 / 솔라라이즈드 라이트 | 기본 다크 / 솔라라이즈드 다크 | 수정 전후 |
| --- | --- | --- | --- |
| Sky | **5.756:1** | **5.756:1** | 흰 글자 2.992 → gray-020 글자 5.756, 배경 rgb(13,153,255) 유지 |
| Violet | 5.284:1 | 5.284:1 | 변경 없음 |
| Pink | 5.478:1 | 5.478:1 | 변경 없음 |
| Lime | 13.119:1 | 14.658:1 | 변경 없음 |

선택된 RULE-001 행의 링크 표시 문구는 **백테스트**다. 아래 결과는 각 테마에서 **4브랜드 전부 동일하게 통과**했다.

| 테마 선택지 | 수정 전 | 수정 후 | 수정 후 실제 전경 / 배경 |
| --- | --- | --- | --- |
| 기본 라이트 | 1.345:1 | **12.803:1** | rgb(27,27,27) / rgb(222,222,222) |
| 기본 다크 | 1.473:1 | **12.645:1** | rgb(250,250,250) / rgb(48,48,48) |
| 솔라라이즈드 라이트 | 1.346:1 | **12.810:1** | rgb(29,27,18) / rgb(224,222,215) |
| 솔라라이즈드 다크 | 1.472:1 | **12.584:1** | rgb(249,250,251) / rgb(42,49,57) |

추가 토큰 계산으로 Sky의 gray-020 잉크와 rest/hover/pressed 배경 쌍은 각각 **5.756 / 5.144 / 4.527:1**이다. 후자의 두 값은 원본 v3 hover/pressed 색을 이용한 수학적 쌍 검증이며, 모든 pseudo 상태를 실제 마우스로 재현·캡처했다는 뜻이 아니다. 기존 전 hover·focus·키보드 순서 종합 검수 미검증 기록은 유지한다.

### 수정 전후 검증과 증거

- 수정 **전** 실제 IAB 16조합, 3문구씩48검사에서 **24실패**: Sky 두 primary 문구×4테마 8실패 + 백테스트 링크16실패. `check.py before`의 종료1을 확인한 뒤 CSS를 수정했다. `red.log`, `before-contrast.csv`.
- 수정 **후** 같은16조합·48검사 **실패0**, 작성·portal 두 맥락32검사도 **실패0**. `check.py after` 종료0, `green.log`, `after-contrast.csv`.
- UI 동작: 룰 만들기→작성 화면, 선택된 RULE-001의 백테스트→해당 룰 실행 화면 이동 확인. 테스트 목적으로 새 룰/판정을 저장하지 않았다. 브라우저 console error0, 뷰포트 기본 복원.
- **`pnpm test`: 64파일351 tests 통과**. 기존 jsdom pseudo-element getComputedStyle 미지원 메시지는 출력됐으며 실패는 없다.
- **`pnpm lint`: 오류0, 기존 TanStack/React Compiler 경고1**. **`pnpm build`: TypeScript+Vite 통과**, 기존 legacy Graph 큰 청크 경고 유지.
- `git diff --check` 통과. 기존 v3 두 토큰의 SHA256은 앞선 기록과 일치한다. 초기850개 manifest의 해시도 그대로인지 대조했다. 커밋·push·stage 없음.

| 추가 증거 | 경로 / 내용 |
| --- | --- |
| 수정 전후 원자료 | `results.json`: 각16조합의 표시 문구·계산된 색·대비·안정화 기록 |
| 다른 렌더링 맥락 | `context-results.json`: 작성 화면·설정 portal의 각16조합 |
| 재실행 가능한 증거 검사 | `python3 /tmp/aml-contrast-fix-qa/check.py before`는 기준 미달로 종료1, `after`는 종료0. 캡처 관찰값을 검산하며 새 브라우저를 실행하는 명령은 아님 |
| 16조합 캡처 모음 | `before-rules-selected-matrix.jpg`, `after-rules-selected-matrix.jpg`, `after-rule-create-matrix.jpg`, `after-settings-dialog-matrix.jpg` |
| 전후 Light/Dark 비교 | **`rules-contrast-before-after.jpg`**: 왼쪽 수정 전, 오른쪽 수정 후; 위 Light, 아래 Dark |
| 실행 로그 | `tests.log`, `lint.log`, `build.log` |

## 관계 그래프 상호작용 확장 (2026-11-15)

Alert/Episode 분석의 계좌·소유주 그래프를 고정 SVG 배치에서 **React Flow + Worker ELK**로 바꿨다. 화면에서 실제 이동·선택·재생이 가능하다. 샘플 데이터 화면이며 서버 이웃 조회와 운영 데이터 성능 검증은 연결하지 않았다. 디자인 취향 확정과 Figma 시각적 일치 검수는 보류다. 별도 Onlook 호환성 복사본에는 접근하거나 변경하지 않았다.

### 기존 구현 비교와 선택

| 비교 대상 | 확인한 구현 | 이번 판단 |
| --- | --- | --- |
| 정본 `dev`의 `frontend/web-app/src/features/graph/v24/Graph.tsx` | `react-force-graph-2d`의 Canvas/force 배치 | 기존 네트워크 탐색 구현과 원본을 보존했다. 새 조사 화면에는 별도 force 물리 엔진을 더하지 않았다. |
| 정본 `dev`의 같은 디렉터리 `OwnerGraph.tsx` | ELK 배치 + 직접 그리는 Canvas | 계좌를 소유주 단위로 모으는 기존 의미를 참고했다. 새 화면은 소유주를 모르는 계좌를 임의로 합치지 않는다. |
| 현재 1.14.0 작업 트리의 `src/features/graph/timeline/TimeGraph.tsx` | `@xyflow/react` 기반 시간축 | React Flow는 정본 `dev` 검색 결과가 아니라 현재 작업 트리의 기존 의존성이다. 새 관계 그래프는 시간축 화면을 복제하지 않고 방향·근거 거래 선택에 사용한다. |
| 이전 `src/next/features/CaseGraph.tsx` | 고정 원형 SVG, 거래 필터와 재생 prefix | 기존 데이터 경계·판정·근거 표를 유지하면서 화면 이동, 노드 드래그, 키보드 선택과 배치 Worker를 추가했다. |

정본 비교 시점은 `dev` **`1c408070`**이다. 해당 dev package에는 `elkjs ^0.12.0`, `react-force-graph-2d ^1.29.1`이 있고 React Flow import는 검색되지 않았다. 현재 설치된 **`@xyflow/react 12.12.0`과 `elkjs 0.12.0`**을 재사용했다. 이번 묶음에서 의존성 버전·lockfile·기존 그래프 원본은 변경하지 않았다. React Flow Pro 예제 코드는 사용하지 않았다.

### 구현과 데이터 경계

- `CaseFlowCanvas.tsx`: 계좌/소유주 노드, 방향 화살표, USD 합계에 따른 연결 굵기, 위험도 글자와 색, 넓은 연결 선택 영역을 제공한다. 노드 드래그, 빈 공간 pan, 휠/버튼 zoom, 현재 범위 맞춤, 검색한 노드로 이동, 미니맵을 연결했다. Enter 선택·방향키 이동·Escape 해제와 접근 가능한 연결 선택 select를 제공한다. 연결 생성·재연결·노드 삭제는 허용하지 않는다.
- `CaseGraph.tsx`: 위험도/기간 필터와 선택 노드·연결의 실제 근거 거래를 연동한다. 거래는 `occurredAt` 시각과 ID 순으로 재생한다. 이전/다음·처음·재생/일시 정지·1/2/4배·재생 위치를 제공한다. 움직이는 점선은 흐름 방향의 시각적 보조이며 실제 금융망 이벤트 스트림이 아니다. 애니메이션 끄기와 `prefers-reduced-motion` CSS를 포함한다.
- `case-graph-layout.ts`: RIGHT/DOWN ELK layered 요청을 별도 classic Worker에 보낸다. 요청마다 cleanup/취소와 **5초 timeout**을 적용하고, 이전 업무의 늦은 응답은 무시한다. 실패하면 기본 grid에서 계속 조사하고 다시 시도할 수 있다. 재생 중에는 전체 필터 범위의 topology와 사용자가 옮긴 좌표를 유지한다. 수동 재배치나 방향 변경 때만 배치를 초기화한다.
- `case-edge-path.ts`: 역방향·자기 연결을 노드 몸체 바깥으로 돌리고, 화면 맞춤에는 돌아가는 곡선의 여유 공간을 포함한다. 사용자가 직접 겹쳐 놓은 노드를 자동으로 벌리는 기능은 없다.
- 입력 거래 **10,000건** 초과는 순회 전에 거절한다. 화면은 **200노드·400연결**까지만 만들고 생략 개수와 범위 축소 안내를 표시한다. 표는 기존 **25/50/100건** 페이지와 현재 페이지 CSV를 유지한다. React Flow에 전체 원장을 전달하지 않는다. 이 제한은 프론트의 자원 경계이며 수억 건 서버 조회·집계 성능을 입증하지 않는다.
- CasePage는 기존 lazy route다. React Flow 코드는 그 업무 화면 청크에 포함되고 ELK Worker는 별도 정적 자산이다. 분석 탭에서만 React Flow 청크를 불러오는 추가 분리는 하지 않았다. Worker 원본 약 1.60MB와 기존 legacy Graph/review 큰 청크 경고가 남는다.

### 화면별 출처·유형·필요 데이터·Figma 대응

모든 숫자와 글자는 기존 `workspace-data.ts`의 합성 거래/업무, `dashboard-data.ts`의 샘플 정보, `case-selectors.ts`의 범위 내 파생값에서 온다. 운영 DB·실제 모델 결과가 아니다. 각 캡처의 업무에는 3거래·6노드·3연결이 있다. ID는 샘플 ID, 계정 이름은 마스킹 값이며 원장 금액은 `amountUsd` 합이다. 사람 판정 이상이 위험도보다 우선하고, 나머지는 모델 `score`의 기존 위험 구간을 따른다. 모델 확률·점수·사람 판정은 서로 구분한다.

| 화면 / 제출 이름 | 숫자·글자의 구체 출처 | `codes.ts`·필요 서버 데이터 | Figma 대응 |
| --- | --- | --- | --- |
| Alert 분석 · 패턴별 (`alert-account`) | Alert `transactionIds` → 근거 거래, from/to 계좌 ID, 거래 수·USD 합, `score`, `humanVerdict`, `typeCode`·`probability`; 선택 연결은 해당 transactionIds만 표시 | 아래 공통 유형 값. 서버의 제한된 계좌 이웃, 방향, 근거 거래 cursor와 누락 개수 필요 | `eHgUPAyr9bZ2UC7oTZNmwh` / 분석 `3031:7320` |
| Alert 분석 · 소유주별 (`alert-owner`) | 위 근거 + 기존 `accountId → ownerId` Map으로 소유주별 집계, 계좌 수; 미확인 소유주는 계좌 노드로 남김 | 소유권 맵·기준 시각·미확인 상태와 소유주 집계 범위 필요 | 같은 Alert 분석의 소유주 전환, 별도 새 노드 ID를 만들지 않음 |
| Episode 분석 · 패턴별 (`episode-account`) | Episode `transactionIds` → 동일 집계·선택·표; Alert 값을 대신 사용하지 않음 | Episode의 제한된 근거/연결 조회, transaction cursor 필요 | 분석 `3031:7342` |
| Episode 분석 · 소유주별 (`episode-owner`) | Episode 근거 + 소유권 Map, 소유주/계좌 수·USD 합 | Episode 소유주 이웃·집계 기준·미확인 상태 필요 | 같은 Episode 분석의 소유주 전환 |

공통 유형은 `0 NON_PATTERN`, `1 FAN-OUT`, `2 FAN-IN`, **`3 GATHER-SCATTER`**, **`4 SCATTER-GATHER`**, `5 CYCLE`, `6 RANDOM`, `7 BIPARTITE`, `8 STACK`이다. `NON_PATTERN`은 유형 요약 차트에서 제외하는 규칙을 유지하지만 그래프·거래 근거에서 삭제하지 않는다. UI 사람 판정은 기존 내부 `normal/abnormal`이며 `FALSE_POSITIVE`를 추가하거나 `SUSPICIOUS`를 확정 API 값으로 쓰지 않았다.

실제 서버 연결 시에는 업무 ID·revision·asOf, 제한된 nodes/edges와 account-owner 매핑, 표시/생략 개수, 위험도와 통화/합계의 집계 기준, from/to/시각/유형/확률/점수/사람 판정이 있는 거래 cursor, 기간·위험·정렬·조회 한도 조건이 필요하다. 현재는 이 API 계약을 서버에 구현하거나 전체 원장을 다운로드하지 않았다. 배치 좌표는 메모리 내 화면 상태이며 서버에 저장하지 않는다.

위 Figma ID는 앞서 확보한 **대응 목록**이다. 이번 작업에서 Figma MCP를 다시 사용하거나 원본과 시각적 일치를 검수하지 않았다. 실제 Figma 일치·사용자 디자인 승인 미검증 기록은 유지한다.

### 상태와 브라우저 검증 증거

증거 루트는 **`/tmp/aml-graph-upgrade/`**, 원본 화면은 `captures/`다. **98개 고유 원본 캡처**와 이를 묶은 **10개 모음**을 분리한다. 이전 850개 QA와 대비 수정 증거는 덮어쓰지 않았다. `manifest.json`은 원본/모음별 SHA256, `screen-state-verification.csv`는 64개 정상 조합과 24개 mock 상태를 기록한다. `python3 /tmp/aml-graph-upgrade/verify-evidence.py` 종료0으로 캡처·17개 관찰·v3 토큰·원본 legacy 그래프·라이선스 원문·배포 Worker 원본 일치와 **이전 캡처 919개 해시 보존**을 대조했다. 이 명령은 저장된 관찰값을 검사하며 새 브라우저나 대량 원장을 실행하지 않는다.

| 화면 | 정상 렌더링 | 로딩 | 빈 결과 | 재조회 오류·기존 내용 유지 | Light/Dark 제출 |
| --- | --- | --- | --- | --- | --- |
| Alert 계좌 | 4테마×4브랜드 16조합 | Light/Dark 확인 | Light/Dark 확인 | Light/Dark 확인 | `alert-account-{light,dark}-sky.jpg` |
| Alert 소유주 | 16조합 | Light/Dark 확인 | Light/Dark 확인 | Light/Dark 확인 | `alert-owner-{light,dark}-sky.jpg` |
| Episode 계좌 | 16조합 | Light/Dark 확인 | Light/Dark 확인 | Light/Dark 확인 | `episode-account-{light,dark}-sky.jpg` |
| Episode 소유주 | 16조합 | Light/Dark 확인 | Light/Dark 확인 | Light/Dark 확인 | `episode-owner-{light,dark}-sky.jpg` |

위 24개 상태 캡처는 UI 검수 상태를 직접 선택한 mock 조회 상태다. 로딩은 “조사 업무를 불러오는 중입니다.”, 빈 결과는 “표시할 조사 업무가 없습니다”, 오류는 “재조회에 실패했습니다. 마지막 조사 내용을 유지합니다.”와 기존 그래프를 관찰했다. 실제 HTTP pending/실패의 검증 증거로 대체하지 않는다. 필터로 거래를 모두 제외한 실제 빈 그래프도 Light/Dark 각각 확인했다.

- `graph-light-dark.jpg`: 위에서부터 Alert 계좌·소유주, Episode 계좌·소유주; 왼쪽 Light, 오른쪽 Dark. 네 `{variant}-matrix.jpg`는 각각16조합, 네 `{variant}-states.jpg`는 Light/Dark의 로딩·빈 결과·오류 모음이다.
- `graph-interactions.jpg`: 연결 선택·1거래 재생·세로 배치·소유주 선택·소유주 연결 선택·역방향 연결을 모았다. `return-connection-dark.jpg`는 실제 노드를 끌어 연결이 역방향이 된 경우의 캡처다. `fullscreen-unavailable-light.jpg`는 브라우저 전체 화면 거절 안내다.
- 실제 브라우저에서 pan transform 변화, 버튼/휠 zoom, 노드·연결 선택 후 해당 1거래, 검색 성공/실패, 드래그 좌표가 재생 뒤 유지됨, 4배 재생 완료, Enter 선택·방향키 이동·Escape 해제, 삭제 키로 노드가 없어지지 않음, 점선 animation offset 변화/끄기, 세로 배치, 역방향 곡선을 관찰했다. `browser-results.json`에 **17개 관찰 기록**과 98개 화면의 DOM 상태를 남겼다. 휠 zoom 때 main scrollTop은 0을 유지했다. 마지막 console error는 **0**, 98개 화면의 document 가로 overflow는 **0**이다.
- 10개 모음과 역방향 원본을 열어 큰 배치·표시 상태를 확인했다. 이 모음 검토를 98개 원본의 모든 글자·대비·focus·전체 반응형 뷰포트에 대한 정밀 시각 검수로 확대하지 않는다. 정상 16조합 사이 배치 방향·사용자 위치가 다를 수 있다.

### 테스트·라이선스·남은 범위

- 최종 **`pnpm test --maxWorkers=2`: 67파일·363 tests 통과** (`all-tests-release.log`). 그래프 집중 **4파일·17 tests 통과** (`graph-tests-final.log`). 시각적 드래그·휠·실제 Worker 응답은 브라우저에서, 시간순/선택/키보드·Worker 실패/5초 timeout/이전 응답 무시·실제 ELK 상호/자기/분리 연결·좌표 검증/노드 상한·역방향 곡선은 해당 테스트에서 확인했다.
- 처음 제한 없는 전체 실행은 기존 legacy UI 테스트 3개가 5초 timeout이었다 (`all-tests.log`). 이 기존 테스트를 바꾸지 않고 Worker 수를 2로 제한해 전체를 다시 통과했다. jsdom pseudo-element getComputedStyle 미지원 출력은 테스트 실패와 구분한다.
- **lint 오류0·기존 TanStack/React Compiler 경고1**, **TypeScript+Vite build 통과** (`lint-complete.log`, `build-final.log`). 기존 Graph/review 큰 청크 경고는 남는다. Storybook 원본은 보존했고 이번 묶음에서 Storybook 빌드를 다시 돌렸다고 주장하지 않는다.
- `public/third-party/react-flow-MIT.txt`, `elkjs-EPL-2.0.txt`는 설치 패키지의 원문을 복사했다. `graph-libraries.txt`에 정확한 설치 버전·저작권·upstream 소스/빌드 지침·패키지 링크를 남겼다. React Flow의 MIT 고지와 화면 attribution을 유지한다. ELK는 **EPL-2.0 경로**를 사용하며 선택적 GPL secondary license를 임의로 선택하지 않는다. ELK/API/Worker 소스는 수정하지 않았다. EPL 적용 프로그램 및 수정분의 고지·소스 제공 조건은 유지해야 한다. [React Flow 원문](https://github.com/xyflow/xyflow/blob/main/LICENSE), [elkjs 소스](https://github.com/kieler/elkjs), [EPL-2.0 원문](https://www.eclipse.org/legal/epl-2.0/). 이번 고지는 직접 사용한 그래프 패키지 범위이며 전체 전이 의존성 법무 검수·정확한 릴리스 소스 스냅샷 동봉까지 완료한 배포 인증은 아니다.
- **미검증:** 브라우저가 `requestFullscreen`을 거절하여 성공한 전체 화면 전환은 확인하지 못했다. 거절 안내만 확인했다. OS reduced-motion 실제 시각 재현, 미니맵 직접 드래그/클릭 journey, 자기 연결의 실제 브라우저 fixture는 미검증이다. 자기/상호 연결은 실제 ELK와 곡선 단위 테스트로만 검증했다. Worker 실패/timeout/stale 응답은 테스트 경계에서 재현했으며 실제 서버 장애 검증이 아니다.
- **미구현:** 서버 이웃 확장/hop 조회, 전체 원장 탐색, 새 force 물리 배치, 다중 박스 선택, 좌표 영속화, 그래프 이미지 내보내기, 별도 시간 버킷 축. 기존 판정 workflow는 그대로다. 실제 데이터·동시 사용자·장시간 재생·200/400 상한의 기기별 frame/memory 성능·수억 건 p95/p99는 측정하지 않았다. 기존 1억 length Proxy는 행 접근 전 조기 거절 테스트라는 기록을 유지한다.
- v3 원본 토큰·기존 Storybook/ShellChrome·legacy 그래프를 보존한다. 커밋·push·stage는 하지 않았다.


