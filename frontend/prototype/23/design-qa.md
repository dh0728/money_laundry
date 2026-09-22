# v22 Design QA — 2026-09-22

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
