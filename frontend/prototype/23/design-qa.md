# v22 Design QA — 2026-09-22

## v23 Auto Layout 전수 점검 — 2026-09-23 00:38 KST

- 기관 전체 대시보드의 `차트 2열 + AI Daily Report 1열`을 하나의 stretch grid로 실측했다. 세 영역 모두 `top 444px`, `bottom 1474.5px`, `height 1030.5px`로 일치한다.
- AI 리포트 내부의 수동 `max-height: 900px` 제한을 제거하고, CardContent와 내부 스크롤 본문을 `h-full / min-h-0 / flex-1` 계약으로 연결했다.
- Alert/Episode 검토 의견의 본문과 참고 정보는 같은 행에서 Fill하도록 바꿨다. 1952×1275 렌더에서 두 Card가 모두 `977px`로 일치한다.
- Alert/Episode 개요의 KPI 행(6개), 일별 금액·상위 송금 계좌 2열, 탐지 근거·조사 정보·처리 이력 3열은 이미 각 행의 가장 큰 요소 기준으로 stretch되고 있어 유지했다.
- 계정 3열, 설정 2×2, 알림 2열은 암묵적인 grid 기본값에 의존하지 않도록 `items-stretch`와 자식 `h-full`을 명시했다.
- 거래 단계 탐색은 소유주·계좌·거래 목록의 길이 자체가 정보이므로 각 Stage를 Hug로 유지하고, 소유주 장기 목록만 내부 스크롤을 소유하게 했다. 그래프 캔버스는 `flex-1 / min-h-0`, 표는 페이지 스크롤 소유 구조를 유지했다.
- 달력·팝오버·미니 생키·차트 뷰포트처럼 고정 높이가 상호작용 범위를 정의하는 요소는 Fill 대상으로 오판하지 않고 유지했다.

검증:

| 명령/환경 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 48 files / 432 tests PASS |
| `npm run build` | exit 0 · 4,391 modules · 단일 HTML 생성 |
| 실제 브라우저 시각 검수 | 1952×1275 · Dashboard / Transactions / Alert overview·graph·review / Account / Settings / Notifications PASS |

final result: passed

## v23 계층 차트 최종 구조 복원 — 2026-09-23 03:40 KST

- 도넛을 두 개의 독립된 동심 링이 아니라 하나의 전체 띠로 복원했다. `패턴 외 · 다건 묶음`과 `패턴 외 · 단일 거래`는 전체 띠 두께를 사용하고, `패턴 소속` 각도에서만 안쪽 절반은 회색 부모, 바깥 절반은 색상 자식으로 분할한다.
- 부모/자식의 반지름 깊이는 `45–67.5%`, `67.5–90%`로 동일하게 맞췄다. 조각 사이 간격과 둥근 모서리를 유지해 계층 관계가 깨지지 않으면서도 각 조각이 붙어 보이지 않는다.
- 도넛 외부 라벨은 실제 말단 조각만 표시한다. 비패턴 2개와 패턴 자식 8개가 가장 가까운 쪽으로 연결되며, 중복되는 부모 라벨은 제거했다.
- 계층 막대는 카드 높이를 채우는 구조는 유지하되 차트 자체를 320px로 제한하고 수직 중앙 정렬해 과도하게 늘어나던 비율을 복원했다.
- Chrome 실제 렌더에서 계층 막대/이중 도넛 전환, 도넛 계층 포함 관계, 조각 간격·라운딩, 라벨 충돌 여부를 확인했다.

최종 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 49 files / 446 tests PASS · 16.71s |
| `npm run build` | exit 0 · 4,390 modules · HTML 3,564.34 kB / gzip 1,033.00 kB |
| `cmp dist/index.html AML-RADAR-v23.html` | exit 0 · 배포 HTML과 dist 일치 |
| `git diff --check -- . ':!AML-RADAR-v23.html'` | exit 0 · 공백 오류 없음 |

final result: passed

## v23 계층 차트 직접 라벨링 수정 — 2026-09-23 03:16 KST

- 사용자 Figma 예시를 기준으로 별도 범례 목록을 제거하고 데이터 조각 자체를 직접 설명하도록 재구성했다.
- 계층 막대는 `패턴 소속` 부모 셀의 아래 절반 안에 8개 패턴 자식 셀을 포함한다. 충분히 넓은 셀은 이름·건수를 내부에 표시하고, 좁은 비패턴 셀은 세로 라벨을 사용한다.
- 이중 도넛은 전체 구성 3개와 패턴 유형 8개를 각각 가장 가까운 좌우 공간에 배치한다. 조각과 라벨은 동일 색상의 짧은 3점 연결선으로 직접 연결되며, 같은 면의 라벨은 최소 28px 간격으로 자동 분산한다.
- 안쪽 링은 전체 구성의 360°를 사용하고 바깥 링은 `패턴 소속` 부모가 점유한 각도에만 한정된다. 부모와 자식의 시작각을 동일한 90°로 고정해 범위가 어긋나지 않도록 했다.
- Chrome 1200×762 다크 테마 실제 렌더에서 라벨/연결선 교차, 카드 잘림, 부모 범위를 벗어난 자식 조각이 없음을 확인했다.

검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 49 files / 446 tests PASS |
| `npm run build` | exit 0 · 4,390 modules · HTML 3,564.45 kB / gzip 1,032.93 kB |
| `git diff --check -- . ':!AML-RADAR-v23.html'` | exit 0 · 공백 오류 없음 |
| Chrome 시각 검수 | 1200×762 · 직접 라벨/부모-자식 범위 PASS |

final result: passed

검증 대상: `b0bdad6`까지의 v22 구현. 실행 주소 `http://127.0.0.1:5182/`, Codex in-app browser(iab). Chrome은 조작하지 않았다. 저장된 Product Design 사용자 문맥이 없어 현재 코드·승인 spec을 기준으로 진행했다.

## 현재 실행 증거와 범위

- 캡처: 2026-09-22 12:38:02–12:45:57 KST. JPEG 74개를 로컬 SDD QA 폴더에 저장했다. 아래 인용 파일은 저장한 동일 파일을 열어 확인했다. 이전 QA 스크린샷은 재사용하지 않았다.
- DOM `innerWidth/innerHeight`는 1440×900 및 720×1100. iab의 넓은 JPEG는 1404×900으로 반환되어 오른쪽 36px은 이미지로 확인할 수 없다. 좁은 JPEG는 720×1100이다.
- `72-login-dark-wide.jpg`는 viewport 전환 직후 잘린 캡처여서 반려했다. `43-rdr-light-narrow-docked.jpg`는 심볼 모핑 도중 캡처여서 정지 화면 판정에서 제외했다. 리뷰 보완에서 메인 태스크가 라이트 좁은 도킹의 안정된 IAB 캡처를 직접 시각 검사했다. 이 보완 캡처는 도구 출력에만 있고 로컬 파일로 저장되지 않았으므로 파일명은 부여하지 않는다.
- 그래프 초기 빈 캡처와 사이드바 닫힘 중 캡처는 안정 상태로 재저장했다. 그래프 애니메이션 중 노드 위치는 픽셀 동일성 평가 대상이 아니다.
- JPEG는 git에 넣지 않은 로컬 증거다. 아래 링크는 현재 작업 폴더 기준이다. 공유 시 SDD의 `qa-20260922` 폴더도 함께 전달해야 한다.
- 리뷰 보완: 최초 저장 파일의 실제 signature가 모두 JPEG(`FF D8`)임을 확인하여 74개 파일을 `.png`에서 `.jpg`로 이름만 변경했다. 이미지 bytes는 바꾸지 않았으며 문서의 74개 링크(고유 72개) 모두 존재함을 검사했다.

## 화면 매트릭스

PASS는 해당 화면 검증 항목에 대한 결과다. 이미지 업로드·모션·성능 한계는 뒤의 표를 따른다.

| 화면 | 테마 | 뷰포트 | 검증·증거 | 결과 |
|---|---|---|---|---|
| Dashboard | 다크 | 1440×900 | 업무 카드·요약 배치·탭 표시; [04-dashboard-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/04-dashboard-dark-wide.jpg) | PASS |
| Dashboard | 라이트 | 1440×900 | 업무 카드·요약 배치·탭 표시; [18-dashboard-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/18-dashboard-light-wide.jpg) | PASS |
| Dashboard | 다크 | 720×1100 | 업무 카드·요약 배치·탭 표시; [48-dashboard-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/48-dashboard-dark-narrow.jpg) | PASS |
| Dashboard | 라이트 | 720×1100 | 업무 카드·요약 배치·탭 표시; [36-dashboard-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/36-dashboard-light-narrow.jpg) | PASS |
| Transactions | 다크 | 1440×900 | 3단계 자연 높이·native overflow; [05-transactions-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/05-transactions-dark-wide.jpg) | PASS |
| Transactions | 라이트 | 1440×900 | 3단계 자연 높이·native overflow; [19-transactions-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/19-transactions-light-wide.jpg) | PASS |
| Transactions | 다크 | 720×1100 | 3단계 자연 높이·native overflow; [53-transactions-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/53-transactions-dark-narrow.jpg) | PASS |
| Transactions | 라이트 | 720×1100 | 3단계 자연 높이·native overflow; [37-transactions-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/37-transactions-light-narrow.jpg) | PASS |
| Alerts | 다크 | 1440×900 | 열·배지·검색/필터; [06-alerts-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/06-alerts-dark-wide.jpg) | PASS |
| Alerts | 라이트 | 1440×900 | 열·배지·검색/필터; [20-alerts-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/20-alerts-light-wide.jpg) | PASS |
| Alerts | 다크 | 720×1100 | 열·배지·검색/필터; [49-alerts-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/49-alerts-dark-narrow.jpg) | PASS |
| Alerts | 라이트 | 720×1100 | 열·배지·검색/필터; [38-alerts-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/38-alerts-light-narrow.jpg) | PASS |
| Episodes | 다크 | 1440×900 | 목록·배지·페이지 컨트롤; [07-episodes-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/07-episodes-dark-wide.jpg) | PASS |
| Episodes | 라이트 | 1440×900 | 목록·배지·페이지 컨트롤; [21-episodes-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/21-episodes-light-wide.jpg) | PASS |
| Episodes | 다크 | 720×1100 | 목록·배지·페이지 컨트롤; [50-episodes-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/50-episodes-dark-narrow.jpg) | PASS |
| Episodes | 라이트 | 720×1100 | 목록·배지·페이지 컨트롤; [39-episodes-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/39-episodes-light-narrow.jpg) | PASS |
| Notifications | 다크 | 1440×900 | 읽음/안 읽음·반응형; [08-notifications-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/08-notifications-dark-wide.jpg) | PASS |
| Notifications | 라이트 | 1440×900 | 읽음/안 읽음·반응형; [22-notifications-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/22-notifications-light-wide.jpg) | PASS |
| Notifications | 다크 | 720×1100 | 읽음/안 읽음·반응형; [51-notifications-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/51-notifications-dark-narrow.jpg) | PASS |
| Notifications | 라이트 | 720×1100 | 읽음/안 읽음·반응형; [40-notifications-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/40-notifications-light-narrow.jpg) | PASS |
| Settings | 다크 | 1440×900 | 데스크톱 2열 / 좁은 창 1열; [03-settings-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/03-settings-dark-wide.jpg) | PASS |
| Settings | 라이트 | 1440×900 | 데스크톱 2열 / 좁은 창 1열; [17-settings-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/17-settings-light-wide.jpg) | PASS |
| Settings | 다크 | 720×1100 | 데스크톱 2열 / 좁은 창 1열; [47-settings-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/47-settings-dark-narrow.jpg) | PASS |
| Settings | 라이트 | 720×1100 | 데스크톱 2열 / 좁은 창 1열; [41-settings-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/41-settings-light-narrow.jpg) | PASS |
| Account | 다크 | 1440×900 | 프로필·권한·세션; [09-account-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/09-account-dark-wide.jpg) | PASS |
| Account | 라이트 | 1440×900 | 프로필·권한·세션; [23-account-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/23-account-light-wide.jpg) | PASS |
| Account | 다크 | 720×1100 | 프로필·권한·세션; [52-account-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/52-account-dark-narrow.jpg) | PASS |
| Account | 라이트 | 720×1100 | 프로필·권한·세션; [42-account-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/42-account-light-narrow.jpg) | PASS |
| Login | 다크 | 1440×900 | 고정 어두운 artwork·입력/버튼; [01-login-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/01-login-dark-wide.jpg) | PASS |
| Login | 라이트 | 1440×900 | 고정 어두운 artwork·입력/버튼; [72-login-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/72-login-light-wide.jpg) | PASS |
| Login | 다크 | 720×1100 | 고정 어두운 artwork·입력/버튼; [71-login-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/71-login-dark-narrow.jpg) | PASS |
| Login | 라이트 | 720×1100 | 고정 어두운 artwork·입력/버튼; [73-login-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/73-login-light-narrow.jpg) | PASS |
| Alert 개요 | 다크 | 1440×900 | 요약·정보 계층; [10-alert-detail-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/10-alert-detail-dark-wide.jpg) | PASS |
| Alert 개요 | 라이트 | 1440×900 | 요약·정보 계층; [24-alert-overview-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/24-alert-overview-light-wide.jpg) | PASS |
| Alert 개요 | 다크 | 720×1100 | 요약·정보 계층; [61-transactions-alert-link.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/61-transactions-alert-link.jpg) | PASS |
| Alert 개요 | 라이트 | 720×1100 | 요약·정보 계층; [33-alert-overview-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/33-alert-overview-light-narrow.jpg) | PASS |
| Alert 거래/의견 | 다크 | 1440×900 | 탭 전환·선택행 대비·입력; [12-alert-transactions-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/12-alert-transactions-dark-wide.jpg), [13-alert-review-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/13-alert-review-dark-wide.jpg) | PASS |
| Alert 거래/의견 | 라이트 | 1440×900 | 탭 전환·선택행 대비·입력; [25-alert-transactions-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/25-alert-transactions-light-wide.jpg), [26-alert-review-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/26-alert-review-light-wide.jpg) | PASS |
| Alert 거래/의견 | 다크 | 720×1100 | 탭 전환·선택행 대비·입력; [62-alert-transactions-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/62-alert-transactions-dark-narrow.jpg), [63-alert-review-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/63-alert-review-dark-narrow.jpg) | PASS |
| Alert 거래/의견 | 라이트 | 720×1100 | 탭 전환·선택행 대비·입력; [34-alert-transactions-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/34-alert-transactions-light-narrow.jpg), [35-alert-review-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/35-alert-review-light-narrow.jpg) | PASS |
| Alert 자금 흐름 | 다크 | 1440×900 | 그래프 렌더링·검색·시간축; [11-alert-flow-dark-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/11-alert-flow-dark-wide.jpg) | PASS |
| Alert 자금 흐름 | 라이트 | 1440×900 | 그래프 렌더링·검색·시간축; [27-alert-flow-light-wide.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/27-alert-flow-light-wide.jpg) | PASS |
| Alert 자금 흐름 | 다크 | 720×1100 | 그래프 렌더링·검색·시간축; [64-alert-flow-dark-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/64-alert-flow-dark-narrow.jpg) | PASS |
| Alert 자금 흐름 | 라이트 | 720×1100 | 그래프 렌더링·검색·시간축; [32-alert-flow-light-narrow.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/32-alert-flow-light-narrow.jpg) | PASS |
| FlowDetail | 다크 | 1440×900 | 도킹·플로팅·닫기; [14-flowdetail-dark-wide-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/14-flowdetail-dark-wide-docked.jpg), [15-flowdetail-dark-wide-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/15-flowdetail-dark-wide-floating.jpg) | PASS |
| FlowDetail | 라이트 | 1440×900 | 도킹·플로팅·닫기; [28-flowdetail-light-wide-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/28-flowdetail-light-wide-docked.jpg), [29-flowdetail-light-wide-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/29-flowdetail-light-wide-floating.jpg) | PASS |
| FlowDetail | 다크 | 720×1100 | 도킹·플로팅·닫기; [65-flowdetail-dark-narrow-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/65-flowdetail-dark-narrow-docked.jpg), [66-flowdetail-dark-narrow-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/66-flowdetail-dark-narrow-floating.jpg) | PASS |
| FlowDetail | 라이트 | 720×1100 | 도킹·플로팅·닫기; [45-flowdetail-light-narrow-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/45-flowdetail-light-narrow-docked.jpg), [46-flowdetail-light-narrow-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/46-flowdetail-light-narrow-floating.jpg) | PASS |
| RDR 9000 | 다크 | 1440×900 | 모드 전환·닫기·history 제거; [02-dashboard-dark-wide-rdr-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/02-dashboard-dark-wide-rdr-docked.jpg), [16-rdr-dark-wide-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/16-rdr-dark-wide-floating.jpg) | PASS |
| RDR 9000 | 라이트 | 1440×900 | 모드 전환·닫기·history 제거; [31-rdr-light-wide-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/31-rdr-light-wide-docked.jpg), [30-rdr-light-wide-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/30-rdr-light-wide-floating.jpg) | PASS |
| RDR 9000 | 다크 | 720×1100 | 모드 전환·닫기·history 제거; [68-rdr-dark-narrow-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/68-rdr-dark-narrow-docked.jpg), [67-rdr-dark-narrow-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/67-rdr-dark-narrow-floating.jpg) | PASS |
| RDR 9000 | 라이트 | 720×1100 | 모드 전환·닫기·history 제거; [44-rdr-light-narrow-floating.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/44-rdr-light-narrow-floating.jpg). 보완: 메인 태스크의 안정된 IAB live 캡처 시각 검사 및 도킹 rect `330,60,390,1040` | PASS — 보완 도킹 캡처는 도구 출력만 보존 |

## 상호작용 검증

| 단계 | 수행·관찰 | 결과·근거 |
|---|---|---|
| 1 | 메뉴·탭·로그인·로그아웃 이동. 비밀번호에서 Tab으로 ‘비밀번호 보기’ 포커스, 로그인 버튼 Enter로 진입 | PASS. 71/73 및 화면 매트릭스. 전체 키보드 순회는 아님 |
| 2 | 다크 좁은 Transactions의 native thumb를 오른쪽 끝으로 드래그 | PASS. `scrollLeft=1441, scrollWidth=2099, clientWidth=658`. [54-transactions-dark-narrow-drag.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/54-transactions-dark-narrow-drag.jpg) |
| 3 | 가로 휠 왼쪽 1페이지 후 필터 열기 | PASS. `scrollLeft 1441→721`, 필터 정상 열림. [55-transactions-dark-narrow-filter-after-scroll.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/55-transactions-dark-narrow-filter-after-scroll.jpg) |
| 4 | Corporation #12485 선택, #18817 검색, 2계좌 중 80CE8B280 선택 | PASS. 거래 3건→1건·연결선 갱신. [56-transactions-dark-narrow-owner.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/56-transactions-dark-narrow-owner.jpg), [58-transactions-dark-narrow-account.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/58-transactions-dark-narrow-account.jpg) |
| 5 | TX-161-20-1 금액 cell 두 번 클릭 | PASS. `data-state selected→false`, 상세 표시→제거. [59-transactions-dark-narrow-row-before.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/59-transactions-dark-narrow-row-before.jpg), [60-transactions-dark-narrow-selected.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/60-transactions-dark-narrow-selected.jpg) |
| 6 | 연결 Alert ALT-2026-1826, Episode EP-2026-321 이동 | PASS. 대상 ID·제목 확인. [61-transactions-alert-link.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/61-transactions-alert-link.jpg), [69-transactions-episode-link.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/69-transactions-episode-link.jpg) |
| 7 | 소유주 위 세로 휠 1페이지, 계좌 영역 위 40페이지, 다시 위로 이동 | PASS. `scrollTop 0→1100→27574`, 최대값도 27574. explorer 내부 `overflowY:auto/scroll` 0개. [57-transactions-dark-narrow-bottom.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/57-transactions-dark-narrow-bottom.jpg) |
| 8 | FlowDetail 검색·dock/float/close, RDR dock/float/close | PASS. 모드별 화면 증거. 좁은 RDR 도킹 DOM `x=330,y=60,w=390,h=1040`가 720×1100 안에 위치. [68-rdr-dark-narrow-docked.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/68-rdr-dark-narrow-docked.jpg) |
| 9 | 한 건 읽음 처리 후 알림 화면·사이드바 비교 | PASS. 둘 다 10→9, 읽음 1. [70-notifications-shared-badge.jpg](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/70-notifications-shared-badge.jpg) |
| 10 | 메뉴·입력·선택 컨트롤의 glow와 정적 요약 카드 비교 | PASS(시각·코드 계약). CSS selector가 native control과 `data-interactive=true`로 한정. Dashboard/Settings/거래 선택 증거 |
| 11 | 탭·사이드바 선택 표시의 대상 위치 확인 | PASS(선택 위치). transform/width/height transition과 reduced-motion transition 제거를 소스·계약 테스트로 확인. 프레임 단위 모션 및 OS 설정 실측은 미수행 |
| 12 | Account 이미지 변경의 file chooser 시도 | 제한. 도구 호출이 527초 응답하지 않아 중단. 업로드·교체·unmount 실제 브라우저 검증 미완료. 소스의 useEffect 정리 함수가 교체/unmount 시 URL.revokeObjectURL을 호출하는 것과 결정적 테스트만 확인 |

### 리뷰 보완 상호작용 — 메인 태스크 IAB 재검증

서브태스크에서 IAB가 노출되지 않아 메인 태스크의 복구된 IAB로 수행했다. Chrome은 사용하지 않았으며 viewport capability와 DOM 값으로 각 크기를 확인했다. 아래는 스크린샷으로 추정한 결과가 아닌 실제 pointer/keyboard 입력과 DOM 관찰이다. 모든 항목을 네 조합에서 중복 반복했다는 의미는 아니다.

| 조합 | 수행 및 관찰 | 결과 |
|---|---|---|
| 라이트 · 1440×900 | Corporation #18817 → 80CE8B280 선택. TX-161-20-1 `false→selected→false`. 필터 popover의 조건 추가·항목·값·조건 적용 표시. 검색창에서 Tab → 기간 버튼 포커스. ALT-2026-1826 링크 → h1 ‘불규칙 경로의 연쇄 이체’ | PASS |
| 다크 · 1440×900 | TX-161-20-1 `selected→false`. 필터 `role=dialog` 1개 표시. 검색창에서 Tab → 기간 버튼 포커스. theme class `dark` 확인 | PASS |
| 다크 · 720×1100 | native overflow owner 1개, `scrollWidth=2053/clientWidth=658`. 보이는 native thumb를 x270→80으로 드래그하여 `scrollLeft 594→0`. 같은 행 해제·owner/account·필터·Alert/Episode 링크·가로 휠·긴 세로 스크롤은 기존 54–69 증거와 함께 확인 | PASS |
| 라이트 · 720×1100 | #18817 선택, 기본 계좌 80CCC1960의 TX-109-17-1 재클릭 `selected→false`. 검색창에서 Tab → 기간 버튼 포커스. native thumb 드래그 `scrollLeft 0→748`. 안정된 RDR 도킹 live 캡처 직접 검사, rect `x330/y60/w390/h1040` | PASS |

키보드는 대표 실제 입력/버튼의 Tab 이동 및 기존 로그인 Enter 활성화를 확인했다. 전체 컨트롤 Tab 순서, 모든 조합의 모든 링크/필터 값 조합까지 전수 검사하지 않았다.

모션 보완: 실제 IAB에서 `matchMedia('(prefers-reduced-motion: reduce)').matches === false`를 읽었고, 로드된 CSSOM에 해당 reduced-motion media rule 7개가 있음을 확인했다. CUA가 media emulation을 제공하지 않고 evaluate는 읽기 전용이므로 `reduce=true`를 강제하지 않았다. OS 설정도 변경하지 않았다. 따라서 reduce=true 실제 실행은 환경 제약으로 미검증이며, fallback 소스·결정적 테스트와 현재 브라우저의 media/CSSOM 상태만 검증했다. `matchMedia`만 바꾸는 방식은 CSS media query를 바꾸지 못하므로 대체 증거로 사용하지 않았다.

## 판단과 한계

이번 실행에서 재현한 제품 결함은 없으며 기능 코드는 수정하지 않았다. 한 scroll owner, 정적 카드 외형, Settings 2열/1열, shared unread badge, 제거된 Agent history UI는 확인했다. 긴 소유주 목록을 끝까지 내렸을 때 계좌·거래 열이 비는 것은 자연 높이 계약에 따른 결과다.

화면 이동·스크롤·선택 중 제품의 눈에 보이는 멈춤은 관찰하지 않았다. CPU/메모리 profile 또는 장시간 soak는 수행하지 않았다. Account chooser의 도구 응답 중단은 앱 결함으로 단정하지 않았다. 정적/서버 렌더링 계약 테스트는 브라우저 검증 전체를 대신하지 않는다.

스크린샷만으로 전체 WCAG 적합성, 명암비 수치, 보조기술 지원, 파일 URL 해제, reduced-motion 실제 동작을 증명할 수 없다. 전 화면 두 테마·두 viewport를 확인했고, 보완 실행에서 네 조합으로 실제 선택·해제·포커스·필터·링크·native scroll 검증 범위를 확장했다. 각 조합의 정확한 수행 항목은 위 표를 따른다. 전체 키보드 순회와 reduce=true 실제 브라우저 실행은 남은 한계다.

## 최종 결정적 검증

초기 실행: `npm test -- --maxWorkers=1` 40개 파일 / 338개 테스트 통과(47.10s), lint exit 0, build exit 0.

최종 실행: 2026-09-22 12:59:18–13:00:13 KST. 기능 코드 변경 없이 문서와 산출물을 정리한 뒤 실행했다.

| 명령 | 결과 |
|---|---|
| `npm test -- --maxWorkers=1` | exit 0 · 40 files / 338 tests PASS · 47.74s |
| `npm run lint` | exit 0 · TypeScript 오류 없음 |
| `npm run build` | exit 0 · 4,387 modules · 655ms · HTML 2,074.97 kB / gzip 572.35 kB |
| `git diff --check` | exit 0 · 공백 오류 없음 |

`postbuild`가 `dist/index.html`을 `AML-RADAR-v22.html`로 복사했다. 최종 산출물 mtime: **2026-09-22 13:00:13 KST**, 크기 **2,074,979 bytes**. 이후 변경은 이 결과 기록뿐이다.

리뷰 보완 후 재실행: 2026-09-22 13:12:44–13:13:43 KST. JPEG 확장자·링크 수정 후 기능 코드 변경 없이 실행했다.

| 명령 | 결과 |
|---|---|
| `npm test -- --maxWorkers=1` | exit 0 · 40 files / 338 tests PASS · 51.85s |
| `npm run lint` | exit 0 · TypeScript 오류 없음 |
| `npm run build` | exit 0 · 4,387 modules · 699ms · HTML 2,074.97 kB / gzip 572.35 kB |
| `git diff --check` | exit 0 · 공백 오류 없음 |
| `cmp dist/index.html AML-RADAR-v22.html` | exit 0 · 배포 HTML과 dist 일치 |

재생성 HTML: **2,074,979 bytes**, mtime **2026-09-22 13:13:43 KST**. 이후 QA 결과 기록만 추가하며 기능 코드는 변경하지 않았다.

## v23 최종 보완 검수 — 2026-09-22 21:28 KST

대상은 `http://127.0.0.1:5184/`, 다크 테마, 1920×1080 뷰포트다. 실제 브라우저에서 Dashboard 기관 전체, Transactions 선택 흐름, Alert/Episode 개요·자금 흐름·거래·검토 의견을 다시 확인했다.

- 기관 전체 차트: 계층형 막대와 이중 도넛 모두 패턴 소속/패턴 외 구성을 한 차트 안에서 표현한다. 범주 팔레트는 vivid red를 제외하고 OKLCH hue를 넓게 분산했으며, 특히 blue/cyan/violet가 연속해서 뭉치지 않는지 렌더 결과를 눈으로 확인했다.
- 소유주 그래프: 무관한 소유주 바깥을 크게 감싸는 perimeter route를 제거했다. 후보 경로에 로컬 최단 경로와 노드 교차 비용을 추가해 42개 소유주/49개 연결의 밀집 사례에서도 엣지가 실제 단말 주변을 우선 통과한다.
- 거래 탐색: 선택 소유주 고정 표시와 목록 선택 상태가 동시에 유지되고, Corporation #18817에서 2개 계좌와 10개 거래가 표시된다. 거래 상세 생키는 송·수취 소유주/계좌를 모두 표시하며 긴 통화명은 BRL/CNY/RUB 코드로 축약해 금액이 잘리지 않는다.
- Alert/Episode: compact header pill, dense overview grid, 패턴 카드별 연결 Alert 액션, 거래 테이블 열 순서·그룹 대비, `참고 정보` 판단 보조 항목을 확인했다.
- 공용 색상 검수 규칙은 vault의 `.agents/skills/categorical-color-audit`에 저장했고 `.claude/skills` loader와 agent-neutral test를 추가했다. 수치상 hue 차이만으로 통과시키지 않고 실제 테마·viewport 렌더 검수를 필수로 한다.

결정적 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 48 files / 424 tests PASS · 15.72s |
| `npm run lint` | exit 0 · TypeScript 오류 없음 |
| `npm run build` | exit 0 · 4,391 modules · HTML 2,113.39 kB / gzip 584.28 kB |
| `git diff --check` | exit 0 · 공백 오류 없음 |

처음 test/lint/build를 동시에 실행했을 때 동적 import 테스트 3개가 각각 5초 제한을 넘겼다. 세 테스트만 단독 실행하면 25/25, 전체 테스트를 빌드와 분리해 재실행하면 424/424가 통과했으므로 기능 실패가 아니라 동시 TypeScript/Vite 부하로 인한 테스트 시간 초과로 판정했다.

공용 vault 검증은 canonical/Claude loader 테스트를 포함해 10개가 통과했다. 기존 startup context 크기 예산 17 KiB 제한은 20,805 bytes로 1개 실패했고, host Python에 PyYAML이 없어 `quick_validate.py`는 실행하지 못했다. 두 항목은 v23 앱 동작과는 분리된 vault 유지보수 과제다.

## v23 소유주 그래프 최종 라우팅 — 2026-09-22 22:41 KST

밀집 그래프의 실제 사용성을 기준으로 경로 계산과 그리기 순서를 다시 보완했다.

- X자 교차 사례에서 두 경로가 같은 내부 구간을 공유하지 않도록 충돌 비용을 높였고, 회피 경로가 무관한 소유주 외곽까지 크게 우회하지 않도록 연속적인 perimeter-distance 비용을 적용했다.
- 동일 소유주 사이의 다중 관계 8개도 독립된 내부 lane을 선택하도록 후보 폭을 확장했다.
- 일반 거래를 먼저, 의심 거래를 나중에 그려 중요 신호가 묻히지 않게 했다. 각 엣지 아래에는 캔버스 배경색 halo를 그려 교차점과 평행 구간이 한 선처럼 붙어 보이지 않게 했다.
- 1952×1275 실제 렌더에서 노드 드래그, 배경 이동, 포트별 연결, 의심/일반 거래 구분과 밀집 구간 판독성을 확인했다.

최종 결정적 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 48 files / 426 tests PASS · 15.79s |
| `npm run lint` | exit 0 · TypeScript 오류 없음 |
| `npm run build` | exit 0 · 4,391 modules · HTML 2,111.48 kB / gzip 583.66 kB |
| `cmp dist/index.html AML-RADAR-v23.html` | exit 0 · 배포 HTML과 dist 일치 |
| `git diff --check` | exit 0 · 공백 오류 없음 |

순수 클라이언트 렌더에서도 SSR 초기화 스크립트를 출력하던 `next-themes`를 로컬 테마 공급자로 교체했다. 재로드 후 새 콘솔 오류·경고가 발생하지 않았고, light/dark/system 저장 및 시스템 테마 추적은 그대로 유지된다.

final result: passed

## v23 계층 막대 영역 분할 수정 — 2026-09-23 00:03 KST

- 계층 막대를 사용자 예시와 같은 단일 2행 그리드로 재구성했다.
- `패턴 소속` 열은 위 절반에 부모 회색 블록, 아래 절반에 유형별 색상 블록을 배치한다.
- `패턴 외 · 다건 묶음`, `패턴 외 · 단일 거래` 열은 두 행 전체 높이를 차지한다. 부모 막대와 자식 막대를 별개 행으로 떨어뜨리던 구조를 제거했다.
- 열 너비는 실제 구성 비율 `11,442 : 360 : 96`, 하위 블록 너비는 패턴별 Alert 비율을 그대로 사용한다.
- 1952×1275 실제 렌더에서 왼쪽 부모/자식 높이와 오른쪽 형제 범주의 전체 높이가 일치하고, 하단 유휴 공간이 남지 않음을 확인했다.

검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run src/v23-dashboard.test.tsx` | exit 0 · 9/9 PASS |
| 실제 브라우저 시각 검수 | 1952×1275 · 계층 막대 2행 정렬 PASS |

final result: passed

## v23 계층 도넛 채움·영역 분할 수정 — 2026-09-22 23:54 KST

- 고정 240px 도넛을 320–440px 반응형 정사각 영역으로 바꿔 카드 하단의 비어 있던 높이를 실제 차트로 채웠다.
- 전체 부모 띠는 반지름 `45–90%`를 사용한다. `패턴 소속` 구간만 중간 경계 `67.5%`에서 나눠 안쪽 절반은 부모 회색, 바깥 절반은 자식 패턴색이 차지한다. 두 띠를 서로 포개지 않고 하나의 영역을 반씩 나눈다.
- 자식 데이터의 비패턴 나머지는 투명하므로 `패턴 외 · 다건 묶음`, `패턴 외 · 단일 거래`는 분할되지 않은 회색 부모 띠 전체 두께를 유지한다.
- 1952×1275 실제 브라우저 렌더에서 도넛 컨테이너가 440×440px로 채워지고, 범례 양쪽과 차트 사이의 겹침·잘림이 없음을 확인했다.

결정적 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run src/v23-dashboard.test.tsx` | exit 0 · 9/9 PASS |
| 기존 시간 초과 5개 파일 단독 재실행 | exit 0 · 34/34 PASS |
| `npm run build` | exit 0 · 4,391 modules · HTML 2,114.16 kB / gzip 584.21 kB |
| `cmp dist/index.html AML-RADAR-v23.html` | exit 0 · 배포 HTML과 dist 일치 |
| `git diff --check` | exit 0 · 공백 오류 없음 |

전체 430개 병렬 테스트 중 425개는 통과했고, 기존 동적 import 테스트 5개만 5초 제한을 넘겼다. 해당 5개 파일을 단독 재실행해 34/34 통과를 확인했다.

final result: passed

## v23 계층 차트 범례·밀도 수정 — 2026-09-22 23:36 KST

- 계층 막대의 구성 범례를 상단 막대 위로, 패턴 범례를 하단 막대 아래로 분리했다. 서로 다른 계층의 항목이 한 범례에 섞이지 않는다.
- 이중 도넛은 `전체 거래 구성 범례 | 도넛 | 패턴 소속 유형 범례`의 3열 구조로 바꿔 좌우 유휴 공간을 정보로 채웠다.
- 패턴 유형만 H 값이 분산된 범주색을 사용한다. 전체 구성 3종은 전용 dark/mid/light 무채색 토큰으로 교체해 정보 계층과 색상 의미가 충돌하지 않는다.
- 1280×720 다크 테마 실제 렌더에서 막대·도넛 전환, 범례 분리, 회색 구성 링, 좌우 3열 채움 및 콘솔 상태를 확인했다.

결정적 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 48 files / 429 tests PASS · 18.73s |
| `npm run build` | exit 0 · 4,391 modules · HTML 2,113.75 kB / gzip 584.15 kB |
| `cmp dist/index.html AML-RADAR-v23.html` | exit 0 · 배포 HTML과 dist 일치 |
| `git diff --check` | exit 0 · 공백 오류 없음 |

final result: passed

## v23 계층 차트 구조 수정 — 2026-09-22 23:20 KST

사용자 주석 이미지의 계층 막대·이중 도넛을 기준으로 기관 전체 차트를 다시 대조했다.

- 이전 구현은 `패턴 소속 내부의 Alert 유형` 행과 도넛 바깥 링에 비패턴 두 범주를 함께 넣어 부모·자식 의미를 혼합했다.
- 계층 막대는 하위 유형을 `패턴 소속` 부모 폭 안에서만 100% 분해한다. 실제 1280×720 렌더 DOM에서 부모와 자식의 좌우 범위가 모두 `272px → 1181.742px`로 일치했다.
- 이중 도넛은 안쪽 링만 전체 거래 구성을 표시하고, 바깥 링의 색상은 `패턴 소속` 각도 안에서만 유형별로 나뉜다. 나머지 각도는 투명하여 별도 하위 범주가 존재하는 것처럼 보이지 않는다.
- 전용 카드의 기본 상하 여백과 내부 padding을 줄이고, 도넛/범례 폭을 유동 그리드로 배분해 주석 이미지에서 지적된 오른쪽·아래쪽 유휴 공간을 축소했다.

결정적 검증:

| 명령 | 결과 |
|---|---|
| `npm test -- --run` | exit 0 · 48 files / 427 tests PASS · 18.49s |
| `npm run lint` | exit 0 · TypeScript 오류 없음 |
| `npm run build` | exit 0 · 4,391 modules · HTML 2,112.40 kB / gzip 583.95 kB |
| `cmp dist/index.html AML-RADAR-v23.html` | exit 0 · 배포 HTML과 dist 일치 |
| `git diff --check` | exit 0 · 공백 오류 없음 |

첫 전체 테스트는 lint와 동시에 실행되어 기존 동적 import 테스트 4개가 각각 5초 제한을 넘겼다. 테스트만 분리해 재실행한 결과 427/427가 통과했다.

final result: passed
