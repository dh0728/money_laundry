# v22 Design QA — 2026-09-22

검증 대상: `b0bdad6`까지의 v22 구현. 실행 주소 `http://127.0.0.1:5182/`, Codex in-app browser(iab). Chrome은 조작하지 않았다. 저장된 Product Design 사용자 문맥이 없어 현재 코드·승인 spec을 기준으로 진행했다.

## 현재 실행 증거와 범위

- 캡처: 2026-09-22 12:38:02–12:45:57 KST. PNG 74개를 로컬 SDD QA 폴더에 저장했다. 아래 인용 파일은 저장한 동일 파일을 열어 확인했다. 이전 QA 스크린샷은 재사용하지 않았다.
- DOM `innerWidth/innerHeight`는 1440×900 및 720×1100. iab의 넓은 PNG는 1404×900으로 반환되어 오른쪽 36px은 이미지로 확인할 수 없다. 좁은 PNG는 720×1100이다.
- `72-login-dark-wide.png`는 viewport 전환 직후 잘린 캡처여서 반려했다. `43-rdr-light-narrow-docked.png`는 심볼 모핑 도중 캡처여서 정지 화면 판정에서 제외했다. 라이트 좁은 도킹은 DOM에서 확인했지만 최종 정지 화면 증거는 제한된다.
- 그래프 초기 빈 캡처와 사이드바 닫힘 중 캡처는 안정 상태로 재저장했다. 그래프 애니메이션 중 노드 위치는 픽셀 동일성 평가 대상이 아니다.
- PNG는 git에 넣지 않은 로컬 증거다. 아래 링크는 현재 작업 폴더 기준이다. 공유 시 SDD의 `qa-20260922` 폴더도 함께 전달해야 한다.

## 화면 매트릭스

PASS는 해당 화면 검증 항목에 대한 결과다. 이미지 업로드·모션·성능 한계는 뒤의 표를 따른다.

| 화면 | 테마 | 뷰포트 | 검증·증거 | 결과 |
|---|---|---|---|---|
| Dashboard | 다크 | 1440×900 | 업무 카드·요약 배치·탭 표시; [04-dashboard-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/04-dashboard-dark-wide.png) | PASS |
| Dashboard | 라이트 | 1440×900 | 업무 카드·요약 배치·탭 표시; [18-dashboard-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/18-dashboard-light-wide.png) | PASS |
| Dashboard | 다크 | 720×1100 | 업무 카드·요약 배치·탭 표시; [48-dashboard-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/48-dashboard-dark-narrow.png) | PASS |
| Dashboard | 라이트 | 720×1100 | 업무 카드·요약 배치·탭 표시; [36-dashboard-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/36-dashboard-light-narrow.png) | PASS |
| Transactions | 다크 | 1440×900 | 3단계 자연 높이·native overflow; [05-transactions-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/05-transactions-dark-wide.png) | PASS |
| Transactions | 라이트 | 1440×900 | 3단계 자연 높이·native overflow; [19-transactions-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/19-transactions-light-wide.png) | PASS |
| Transactions | 다크 | 720×1100 | 3단계 자연 높이·native overflow; [53-transactions-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/53-transactions-dark-narrow.png) | PASS |
| Transactions | 라이트 | 720×1100 | 3단계 자연 높이·native overflow; [37-transactions-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/37-transactions-light-narrow.png) | PASS |
| Alerts | 다크 | 1440×900 | 열·배지·검색/필터; [06-alerts-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/06-alerts-dark-wide.png) | PASS |
| Alerts | 라이트 | 1440×900 | 열·배지·검색/필터; [20-alerts-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/20-alerts-light-wide.png) | PASS |
| Alerts | 다크 | 720×1100 | 열·배지·검색/필터; [49-alerts-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/49-alerts-dark-narrow.png) | PASS |
| Alerts | 라이트 | 720×1100 | 열·배지·검색/필터; [38-alerts-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/38-alerts-light-narrow.png) | PASS |
| Episodes | 다크 | 1440×900 | 목록·배지·페이지 컨트롤; [07-episodes-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/07-episodes-dark-wide.png) | PASS |
| Episodes | 라이트 | 1440×900 | 목록·배지·페이지 컨트롤; [21-episodes-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/21-episodes-light-wide.png) | PASS |
| Episodes | 다크 | 720×1100 | 목록·배지·페이지 컨트롤; [50-episodes-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/50-episodes-dark-narrow.png) | PASS |
| Episodes | 라이트 | 720×1100 | 목록·배지·페이지 컨트롤; [39-episodes-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/39-episodes-light-narrow.png) | PASS |
| Notifications | 다크 | 1440×900 | 읽음/안 읽음·반응형; [08-notifications-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/08-notifications-dark-wide.png) | PASS |
| Notifications | 라이트 | 1440×900 | 읽음/안 읽음·반응형; [22-notifications-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/22-notifications-light-wide.png) | PASS |
| Notifications | 다크 | 720×1100 | 읽음/안 읽음·반응형; [51-notifications-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/51-notifications-dark-narrow.png) | PASS |
| Notifications | 라이트 | 720×1100 | 읽음/안 읽음·반응형; [40-notifications-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/40-notifications-light-narrow.png) | PASS |
| Settings | 다크 | 1440×900 | 데스크톱 2열 / 좁은 창 1열; [03-settings-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/03-settings-dark-wide.png) | PASS |
| Settings | 라이트 | 1440×900 | 데스크톱 2열 / 좁은 창 1열; [17-settings-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/17-settings-light-wide.png) | PASS |
| Settings | 다크 | 720×1100 | 데스크톱 2열 / 좁은 창 1열; [47-settings-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/47-settings-dark-narrow.png) | PASS |
| Settings | 라이트 | 720×1100 | 데스크톱 2열 / 좁은 창 1열; [41-settings-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/41-settings-light-narrow.png) | PASS |
| Account | 다크 | 1440×900 | 프로필·권한·세션; [09-account-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/09-account-dark-wide.png) | PASS |
| Account | 라이트 | 1440×900 | 프로필·권한·세션; [23-account-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/23-account-light-wide.png) | PASS |
| Account | 다크 | 720×1100 | 프로필·권한·세션; [52-account-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/52-account-dark-narrow.png) | PASS |
| Account | 라이트 | 720×1100 | 프로필·권한·세션; [42-account-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/42-account-light-narrow.png) | PASS |
| Login | 다크 | 1440×900 | 고정 어두운 artwork·입력/버튼; [01-login-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/01-login-dark-wide.png) | PASS |
| Login | 라이트 | 1440×900 | 고정 어두운 artwork·입력/버튼; [72-login-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/72-login-light-wide.png) | PASS |
| Login | 다크 | 720×1100 | 고정 어두운 artwork·입력/버튼; [71-login-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/71-login-dark-narrow.png) | PASS |
| Login | 라이트 | 720×1100 | 고정 어두운 artwork·입력/버튼; [73-login-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/73-login-light-narrow.png) | PASS |
| Alert 개요 | 다크 | 1440×900 | 요약·정보 계층; [10-alert-detail-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/10-alert-detail-dark-wide.png) | PASS |
| Alert 개요 | 라이트 | 1440×900 | 요약·정보 계층; [24-alert-overview-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/24-alert-overview-light-wide.png) | PASS |
| Alert 개요 | 다크 | 720×1100 | 요약·정보 계층; [61-transactions-alert-link.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/61-transactions-alert-link.png) | PASS |
| Alert 개요 | 라이트 | 720×1100 | 요약·정보 계층; [33-alert-overview-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/33-alert-overview-light-narrow.png) | PASS |
| Alert 거래/의견 | 다크 | 1440×900 | 탭 전환·선택행 대비·입력; [12-alert-transactions-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/12-alert-transactions-dark-wide.png), [13-alert-review-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/13-alert-review-dark-wide.png) | PASS |
| Alert 거래/의견 | 라이트 | 1440×900 | 탭 전환·선택행 대비·입력; [25-alert-transactions-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/25-alert-transactions-light-wide.png), [26-alert-review-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/26-alert-review-light-wide.png) | PASS |
| Alert 거래/의견 | 다크 | 720×1100 | 탭 전환·선택행 대비·입력; [62-alert-transactions-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/62-alert-transactions-dark-narrow.png), [63-alert-review-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/63-alert-review-dark-narrow.png) | PASS |
| Alert 거래/의견 | 라이트 | 720×1100 | 탭 전환·선택행 대비·입력; [34-alert-transactions-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/34-alert-transactions-light-narrow.png), [35-alert-review-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/35-alert-review-light-narrow.png) | PASS |
| Alert 자금 흐름 | 다크 | 1440×900 | 그래프 렌더링·검색·시간축; [11-alert-flow-dark-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/11-alert-flow-dark-wide.png) | PASS |
| Alert 자금 흐름 | 라이트 | 1440×900 | 그래프 렌더링·검색·시간축; [27-alert-flow-light-wide.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/27-alert-flow-light-wide.png) | PASS |
| Alert 자금 흐름 | 다크 | 720×1100 | 그래프 렌더링·검색·시간축; [64-alert-flow-dark-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/64-alert-flow-dark-narrow.png) | PASS |
| Alert 자금 흐름 | 라이트 | 720×1100 | 그래프 렌더링·검색·시간축; [32-alert-flow-light-narrow.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/32-alert-flow-light-narrow.png) | PASS |
| FlowDetail | 다크 | 1440×900 | 도킹·플로팅·닫기; [14-flowdetail-dark-wide-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/14-flowdetail-dark-wide-docked.png), [15-flowdetail-dark-wide-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/15-flowdetail-dark-wide-floating.png) | PASS |
| FlowDetail | 라이트 | 1440×900 | 도킹·플로팅·닫기; [28-flowdetail-light-wide-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/28-flowdetail-light-wide-docked.png), [29-flowdetail-light-wide-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/29-flowdetail-light-wide-floating.png) | PASS |
| FlowDetail | 다크 | 720×1100 | 도킹·플로팅·닫기; [65-flowdetail-dark-narrow-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/65-flowdetail-dark-narrow-docked.png), [66-flowdetail-dark-narrow-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/66-flowdetail-dark-narrow-floating.png) | PASS |
| FlowDetail | 라이트 | 720×1100 | 도킹·플로팅·닫기; [45-flowdetail-light-narrow-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/45-flowdetail-light-narrow-docked.png), [46-flowdetail-light-narrow-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/46-flowdetail-light-narrow-floating.png) | PASS |
| RDR 9000 | 다크 | 1440×900 | 모드 전환·닫기·history 제거; [02-dashboard-dark-wide-rdr-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/02-dashboard-dark-wide-rdr-docked.png), [16-rdr-dark-wide-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/16-rdr-dark-wide-floating.png) | PASS |
| RDR 9000 | 라이트 | 1440×900 | 모드 전환·닫기·history 제거; [31-rdr-light-wide-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/31-rdr-light-wide-docked.png), [30-rdr-light-wide-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/30-rdr-light-wide-floating.png) | PASS |
| RDR 9000 | 다크 | 720×1100 | 모드 전환·닫기·history 제거; [68-rdr-dark-narrow-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/68-rdr-dark-narrow-docked.png), [67-rdr-dark-narrow-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/67-rdr-dark-narrow-floating.png) | PASS |
| RDR 9000 | 라이트 | 720×1100 | 모드 전환·닫기·history 제거; [44-rdr-light-narrow-floating.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/44-rdr-light-narrow-floating.png) | PASS — 도킹 정지 캡처 제한 |

## 상호작용 검증

| 단계 | 수행·관찰 | 결과·근거 |
|---|---|---|
| 1 | 메뉴·탭·로그인·로그아웃 이동. 비밀번호에서 Tab으로 ‘비밀번호 보기’ 포커스, 로그인 버튼 Enter로 진입 | PASS. 71/73 및 화면 매트릭스. 전체 키보드 순회는 아님 |
| 2 | 다크 좁은 Transactions의 native thumb를 오른쪽 끝으로 드래그 | PASS. `scrollLeft=1441, scrollWidth=2099, clientWidth=658`. [54-transactions-dark-narrow-drag.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/54-transactions-dark-narrow-drag.png) |
| 3 | 가로 휠 왼쪽 1페이지 후 필터 열기 | PASS. `scrollLeft 1441→721`, 필터 정상 열림. [55-transactions-dark-narrow-filter-after-scroll.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/55-transactions-dark-narrow-filter-after-scroll.png) |
| 4 | Corporation #12485 선택, #18817 검색, 2계좌 중 80CE8B280 선택 | PASS. 거래 3건→1건·연결선 갱신. [56-transactions-dark-narrow-owner.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/56-transactions-dark-narrow-owner.png), [58-transactions-dark-narrow-account.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/58-transactions-dark-narrow-account.png) |
| 5 | TX-161-20-1 금액 cell 두 번 클릭 | PASS. `data-state selected→false`, 상세 표시→제거. [59-transactions-dark-narrow-row-before.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/59-transactions-dark-narrow-row-before.png), [60-transactions-dark-narrow-selected.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/60-transactions-dark-narrow-selected.png) |
| 6 | 연결 Alert ALT-2026-1826, Episode EP-2026-321 이동 | PASS. 대상 ID·제목 확인. [61-transactions-alert-link.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/61-transactions-alert-link.png), [69-transactions-episode-link.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/69-transactions-episode-link.png) |
| 7 | 소유주 위 세로 휠 1페이지, 계좌 영역 위 40페이지, 다시 위로 이동 | PASS. `scrollTop 0→1100→27574`, 최대값도 27574. explorer 내부 `overflowY:auto/scroll` 0개. [57-transactions-dark-narrow-bottom.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/57-transactions-dark-narrow-bottom.png) |
| 8 | FlowDetail 검색·dock/float/close, RDR dock/float/close | PASS. 모드별 화면 증거. 좁은 RDR 도킹 DOM `x=330,y=60,w=390,h=1040`가 720×1100 안에 위치. [68-rdr-dark-narrow-docked.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/68-rdr-dark-narrow-docked.png) |
| 9 | 한 건 읽음 처리 후 알림 화면·사이드바 비교 | PASS. 둘 다 10→9, 읽음 1. [70-notifications-shared-badge.png](../../../.superpowers/sdd/2026-09-22-aml-radar-v22-design-system/qa-20260922/70-notifications-shared-badge.png) |
| 10 | 메뉴·입력·선택 컨트롤의 glow와 정적 요약 카드 비교 | PASS(시각·코드 계약). CSS selector가 native control과 `data-interactive=true`로 한정. Dashboard/Settings/거래 선택 증거 |
| 11 | 탭·사이드바 선택 표시의 대상 위치 확인 | PASS(선택 위치). transform/width/height transition과 reduced-motion transition 제거를 소스·계약 테스트로 확인. 프레임 단위 모션 및 OS 설정 실측은 미수행 |
| 12 | Account 이미지 변경의 file chooser 시도 | 제한. 도구 호출이 527초 응답하지 않아 중단. 업로드·교체·unmount 실제 브라우저 검증 미완료. 소스의 useEffect 정리 함수가 교체/unmount 시 URL.revokeObjectURL을 호출하는 것과 결정적 테스트만 확인 |

## 판단과 한계

이번 실행에서 재현한 제품 결함은 없으며 기능 코드는 수정하지 않았다. 한 scroll owner, 정적 카드 외형, Settings 2열/1열, shared unread badge, 제거된 Agent history UI는 확인했다. 긴 소유주 목록을 끝까지 내렸을 때 계좌·거래 열이 비는 것은 자연 높이 계약에 따른 결과다.

화면 이동·스크롤·선택 중 제품의 눈에 보이는 멈춤은 관찰하지 않았다. CPU/메모리 profile 또는 장시간 soak는 수행하지 않았다. Account chooser의 도구 응답 중단은 앱 결함으로 단정하지 않았다. 정적/서버 렌더링 계약 테스트는 브라우저 검증 전체를 대신하지 않는다.

스크린샷만으로 전체 WCAG 적합성, 명암비 수치, 보조기술 지원, 파일 URL 해제, reduced-motion 실제 동작을 증명할 수 없다. 전 화면 두 테마·두 viewport를 확인했고 native scroll·링크 상세 반복은 다크 720×1100에서 수행했다. 모든 상호작용을 네 조합에서 각각 반복한 것은 아니다.

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
