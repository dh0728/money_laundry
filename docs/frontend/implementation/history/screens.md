> 보존 기록 · 현재 지침 아님. 2026-11-16 두 정본 통합 전 내용을 보존한다. 현재 기준은 [영어 FE 구현 지침](../frontend-handoff.md)과 [한국어 API 요구사항](../api.md)이다. 아래 문구·상태는 당시 기록이다.

# 화면과 경로

대상: 프론트엔드·백엔드 팀원 · 언어: 한국어 · 구분: 팀 공유 구현 기준

갱신: 2026-11-16.

구현할 화면과 필요한 상태를 정리한 목록이다. 아래 경로는 화면 설계상의 제안이며, 실제 샘플 앱 경로와 검증 범위는 [기존 구현 기록](complete-bundle.md)을 함께 확인한다. 레이아웃은 [화면 구현 지침](frontend-handoff-2026-11-16.md)을 따른다.

원본 Figma 섹션: Dashboard, RuleEngine, AddTab, Alert, Episode, Report, ETC.

<a id="required-variants-and-evidence"></a>
## 필요한 변형과 검수 자료

로그인을 포함한 모든 화면은 Default Light/Dark, Solarized Light/Dark × Sky/Violet/Pink/Lime, 총 16개 조합을 지원해야 한다. v3 토큰과 컴포넌트 연결을 유지한다. 일정은 [구현 일정](frontend-handoff-2026-11-16.md#delivery-schedule)에서 관리한다.

화면 하나를 끝낼 때마다 원본 Figma 프레임 링크(로그인은 `Figma 원본 없음`), 구현 버전·커밋·실행 링크, 필요한 데이터, `codes.ts` 대응값, 로딩·빈 결과·오류 동작, 라이트·다크 캡처를 기록한다. 열리지 않는 링크와 검증하지 못한 상태는 따로 표시한다. 아래 경로만으로 실행 가능한 미리보기가 제공되는 것은 아니다.

<a id="screen-inventory"></a>
## 화면 목록

| Figma 섹션 | 화면 식별자 | 제안 경로 | 필요한 변형·확인 사항 |
| --- | --- | --- | --- |
| Dashboard | dashboard/mine | `/dashboard/mine` | 전체 대시보드와 한 쌍 |
| Dashboard | dashboard/all | `/dashboard/all` | 내 담당 대시보드와 한 쌍 |
| RuleEngine | rule-engine/draft-list | `/rules` | 사유를 보여주는 옆 패널 |
| RuleEngine | rule-engine/draft-create | `/rules/new` | 없음 |
| RuleEngine | rule-engine/draft-backtest | `/rules/:id/backtest` | 없음 |
| AddTab | add-tab/owner-account-transaction | `/investigate/ledger` | 조사 화면의 세 탭 중 하나 |
| AddTab | add-tab/alerts-cards | `/investigate/alerts?view=cards` | `내 담당` 필터 켬/끔, 표 보기와 한 쌍 |
| AddTab | add-tab/alerts-table | `/investigate/alerts?view=table` | `내 담당` 필터 켬/끔, 카드 보기와 한 쌍 |
| AddTab | add-tab/alerts-bundle | `/investigate/alerts?mode=bundle` | 미정: 별도 화면 또는 목록 안 패널 |
| AddTab | add-tab/episodes | `/investigate/episodes?view=cards` | `사람 판정 이상만` 필터 켬/끔(기존 설계 기록), 표 보기와 한 쌍 |
| AddTab | add-tab/episodes-table | `/investigate/episodes?view=table` | `사람 판정 이상만` 필터 켬/끔, 카드 보기와 한 쌍 |
| Alert | alert/overview-allpanel | `/alerts/:id?tab=overview&mode=all` | 패널별 보기와 한 쌍 |
| Alert | alert/overview-perpanel | `/alerts/:id?tab=overview&mode=per` | 전체 패널 보기와 한 쌍 |
| Alert | alert/analysis | `/alerts/:id?tab=analysis&view=pattern` | 소유주 보기만 |
| Alert | alert/related | `/alerts/:id?tab=related` | 소유주 보기 |
| Alert | alert/judge-single, judge-bundle | 개요/관련 화면 위 다이얼로그 | 정상/이상 선택 상태 설계 미정 |
| Alert | alert/overview-staff-readonly | `/alerts/:id?tab=overview` | 다른 담당자 업무, 읽기 전용 |
| Episode | episode/overview | `/episodes/:id?tab=overview` | 없음 |
| Episode | episode/analysis | `/episodes/:id?tab=analysis&view=pattern` | 소유주 보기만 |
| Episode | episode/related | `/episodes/:id?tab=related` | 소유주 보기 |
| Episode | episode/judge | 개요 위 다이얼로그 | Episode 판정 방식은 팀 확인 필요 |
| Report | report/write | `/report` (제안) | 판정 이력 표/카드 보기, 체크박스 선택, PDF 다운로드 |
| ETC | notifications | 사이드바 드로어 | 없음 |
| ETC | account | 사이드바 메뉴 | 없음 |
| ETC | settings | 설정 창 | 글자 크기, 테마 |
| ETC | auth/login (Figma 원본 없음) | `/login` | 세션 만료, 테마·브랜드 16개 조합 |
| ETC | state/loading-empty, refetch-error, judge-result | 각 본문 화면 위 | 로딩/결과 없음 구분, 한 줄 재시도 안내, 저장 성공/실패/추가 확인 |

화면에서 제외된 항목: 12개 탭 제한 상태(기능 폐기). 분석 화면의 선택 변형(노드 선택, 상세 거래 숨김)은 별도로 그리지 않는다는 2026-11-11 18:02 결정 기록이 있다.

<a id="implemented-screen-entries"></a>
## 구현 기록

기존 [전체 샘플 앱](complete-bundle.md)과 [첫 화면 묶음](first-bundle.md) 인계문에 mock 동작과 당시 검증 범위가 있다. 최종 디자인 승인이나 실제 API 연동 완료 기록이 아니다. 본문을 복사하지 않고 이 목록에서 연결한다. 새 검증 기록은 최신 항목부터 추가하고, 실제 실행 화면 또는 소스와 캡처 근거를 연결한다. 2026-11-16 폐기 결정이 내려진 Figma 구현 검수본은 새 디자인 기준으로 사용하지 않는다.

화면별 데이터 기록 순서: 표시 필드·지표 → mock 원본 필드 → 의미·단위·계산식 → 도메인 코드 → 누락·로딩·오류 처리 → 백엔드 합의 여부. 가짜 데이터는 반드시 mock으로 표시한다.
