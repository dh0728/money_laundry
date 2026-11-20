# Ant 조사 검수 경로 — 수동 Spec Kit plan / tasks / analyze

Source: UI 재설계.md 현재 요약, §8.10–8.11 / 2026-10-23 사용자 구현 승인.
공식 templates/commands/{plan,tasks,analyze}.md의 구조만 수동 적용. 설치기/스크립트/브랜치 생성 없음.

## Plan
동일 web-app에서 Ant 검수 진입점을 제공하고 기존 앱/화면을 보존한다. 동일 HTTP 계약과 fixture 읽기 경계, 기존 그래프 renderer/ID 변환/명령 builder/권한 방어를 재사용한다. UI는 한국어 Ant 기본 theme. 원본 메모리 초안이 있는 5208 탭은 조작하지 않는다.
고정 아이콘 sidebar + 한국어 focus/hover Tooltip, 현재 메뉴/제목을 유지한다. 개요/그래프/거래표/의견의 역할을 보존한다. 의견 동시 Drawer는 검수 제안으로 표시한다.
실제 API 쓰기/배포/commit/push/실제 AI 판정은 제외. 합성 저장 시도는 성공 처리하지 않는다.

## Tasks (dependency order)
- [x] T1 U1: 편입 원본/summary 집합과 계좌→소유주 회귀 RED→GREEN.
- [x] T2 U2/U3: 합성 dashboard/Alert/Episode/거래 내역/알림과 정확한 ID/출발점/복귀 상태.
- [x] T3 U4/U5: 기존 그래프·직접 거래 상세·동시 의견·명시 판정/조건·쓰기 차단/입력 보존. 실제 서버 처리 성공은 검증하지 않음.
- [x] T4: 한국어 기본 UI·두 테마·focus Tooltip·읽기 오류/빈 결과의 제한된 검증. 전체 접근성 인증이나 터치 검수는 아님.
- [x] T5: 48파일262테스트, lint 오류0/기존 경고1, 타입 포함 build 통과. 브라우저 교차 흐름은 evidence/result.json 참조.
- [ ] 독립 UI 재검수·사용자 직접 검수·실제 BE/AI 증거·PairView 완성 FE 연결. 이 체크리스트의 자동/개발자 검사가 이를 대신하지 않음.

## Analyze (implementation preflight)
U1 precedes U2/U3 because bad fixture state corrupts evidence counts. All use same adapter/IDs; no invented endpoint.
Ant is presentation, not a graph replacement. No global theme-token replacement. Fixture != dev/BE/AI validation.
No deletion/worktree setup/commits from generic skill steps: user explicitly forbids those operations.
Known limits: unavailable ruleHits/run metadata/indirect paths/real save stay explicit. Detailed placement is review proposal, not team approval.
Behavioral fixture RED is required; the old missing-module test is only a skeleton until a component exists.

## 안정화 결과 (2026-10-23)
Graph의 기존 Radix TooltipProvider 의존성을 같은 graph 경계에 제공해 실제 canvas 렌더링을 복구했다. 권한 테스트의 시간 초과는 전체 DOM의 접근성 이름 탐색에 걸렸으며, 현재 tabpanel로 범위를 좁히고 동일 접근성 이름·disabled·명령0 단언을 유지했다. 권한 방어를 완화하거나 해당 테스트 시간을 늘리지 않았다.
알림과 전역 검색이 같은 임시 입력 state를 공유해 알림을 숨기던 문제는 입력 state만 분리했다. 알림→E-150의 COMMENT 이력 연결을 실제 브라우저에서 확인했다. 스크린샷의 테마 전환 중간색은 animations:'disabled'로 전환 완료 상태를 캡처해 재확인했다.

## PairView 기존 FE 연결 (후속 승인 범위)
기존 PairView Source/프로토콜/입력 화면을 재사용한다. 새 도구·디자인·공개 게시·실제 API 요청 없음. 5209 독립 UI 검수 종료 확인 전 FE 소스는 유지한다.
- [x] P1: 검증된 http://127.0.0.1:5209/ant-review.html만 앱 URL 입력에 추가. 다른 origin/port/path/query/hash/자격증명 거부 테스트 RED→GREEN9개.
- [x] P2: 기존51행은 그대로 보존하고 Ant 입력을 URL 경로로 선택. 실제 존재하는 영역과 실제 adapter/request/response·미연결을 구별.
- [x] P3: 동결 해제 뒤 ant-main 초기화, Ant shell 테마 이벤트/앵커, investigation 탭/상세 focus와 앵커. 기존 bridge는 선택적 앵커 목록만 받고 원래 기본값 유지. 업무/배치/명령 변경 없음.
- [ ] P4: 메시지 origin/window/channel/nonce/ID 거부, 실제 rect/focus-ready, 테마 양방향, 메뉴/탭/스크롤/정확한 상세, 실제 API0을 테스트·빌드·headless 브라우저로 확인. 사용자 Chrome 탭 미조작.
