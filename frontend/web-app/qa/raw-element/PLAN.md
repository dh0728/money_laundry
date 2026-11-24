# 맨 태그 교체 인계 (JPM-15 · MONEY17-151)

화면 파일(`src/components` 밖)에 맨 DOM 태그를 두지 않고 공용 부품 인스턴스만 두는 작업이다.
규칙은 `component/raw-element`(eslint, 상한 관리)이고, 이 문서는 Codex가 이어서 하기 위한 인계 문서다.
도구와 순서는 저장소 스킬 `.agents/skills/raw-element-migration/SKILL.md`에 있다.

## 지금 상태 (2026-11-24, 브랜치 `fe/panel-inset`)

- 2310건 → 341건. 상한 `scripts/design-baseline.json`의 `component/raw-element` = 341.
- 0건이 되어 오류 규칙으로 바꾼 폴더: `src/features/notifications/`, `src/lib/` (`scripts/design-rules.mjs`의 `errorIn`).
- 화면별로 줄인 수: 대시보드 269→20, 룰 115→4, Alert 162→8, 조사 496→38, 그래프 259→69, Episode 103→3, 거래 58→5,
  설정 51→4, 에이전트 42→23, 검색 13→1, 알림 5→0, 판정 이력·화면 이동 100→0, 컴포넌트 카탈로그 86→10, 옛 화면(`src/pages/*.tsx`·`App.tsx`·`src/lib` 등) 417→22.
- 교체한 태그는 같은 DOM을 그리는 `Box`·`Text`·`Heading`(`src/components/layout-primitives.jsx`)으로 바꿨다.
  화면마다 고치기 전·후 DOM 구조가 같고(자동 id·현재 시각만 정규화) 픽셀 차이는 움직이는 로고·버튼 광택·시각 글자뿐임을 확인했다.

## 남은 341건 (파일별)

| 파일 | 수 | 태그 |
| --- | ---: | --- |
| `src/app/layout.js` | 103 | 문자열 div 42, 문자열 span 14, 문자열 p 9, 문자열 section 7, 문자열 h3 6, 문자열 label 3, 문자열 input 3, 문자열 code 2, 문자열 img 2, 문자열 footer 2, 문자열 strong 2, 문자열 li 2, 문자열 main 2, 문자열 header 1, 문자열 nav 1, 문자열 ul 1, 문자열 ol 1, 문자열 time 1, 문자열 canvas 1, 문자열 form 1 |
| `src/app/screen-layouts.js` | 31 | 문자열 div 24, 문자열 section 3, 문자열 h2 2, 문자열 h1 1, 문자열 p 1 |
| `src/features/graph/owner-graph-timeline.jsx` | 30 | g 8, text 5, rect 4, path 4, circle 3, title 2, line 1, svg 1, defs 1, clipPath 1 |
| `src/features/agent/RadarSweep.tsx` | 21 | stop 6, circle 5, path 4, svg 1, defs 1, radialGradient 1, linearGradient 1, g 1, animateTransform 1 |
| `src/features/graph/timeline/PairTimeline.tsx` | 13 | text 5, line 2, circle 2, svg 1, g 1, rect 1, path 1 |
| `src/features/dashboard/PatternRelation.tsx` | 11 | path 3, svg 2, stop 2, defs 1, linearGradient 1, g 1, circle 1 |
| `src/features/investigation/investigation-components.jsx` | 10 | svg 3, path 2, stop 2, defs 1, linearGradient 1, rect 1 |
| `src/pages/LiveCasesPage.tsx` | 9 | textarea 4, select 2, option 2, input 1 |
| `src/features/graph/0.24.0/Graph.tsx` | 7 | br 5, button 2 |
| `src/features/graph/graph-flow-pulse.jsx` | 7 | path 3, g 2, defs 1, mask 1 |
| `src/features/investigation/ibm-ledger.jsx` | 7 | option 5, select 2 |
| `src/pages/component-catalogue.jsx` | 7 | a 2, 문자열 div 1, 문자열 code 1, select 1, option 1, iframe 1 |
| `src/features/investigation/AntInvestigation.tsx` | 6 | br 3, p 2, div 1 |
| `src/features/graph/0.24.0/FlowDetail.tsx` | 5 | path 2, text 2, g 1 |
| `src/features/graph/timeline/TimeGraph.tsx` | 5 | br 2, circle 1, animateMotion 1, button 1 |
| `src/features/investigation/overview-score-chart.jsx` | 5 | g 3, text 2 |
| `src/features/dashboard/dashboard-analytics.jsx` | 4 | defs 1, pattern 1, rect 1, path 1 |
| `src/features/transactions/TransactionExplorer.tsx` | 4 | svg 1, path 1, button 1, a 1 |
| `src/app/App.tsx` | 3 | item.icon 2, button 1 |
| `src/features/alerts/CaseActivityCharts.tsx` | 3 | option 2, select 1 |
| `src/features/dashboard/preview-dashboard.jsx` | 3 | rect 2, svg 1 |
| `src/features/investigation/AntReviewSite.tsx` | 3 | p 1, nav 1, item.icon 1 |
| `src/features/settings/model-risk-dial.jsx` | 3 | svg 1, g 1, path 1 |
| `src/pages/LoginPage.tsx` | 3 | br 2, button 1 |
| `src/pages/RulesPage.tsx` | 3 | a 2, button 1 |
| `src/pages/component-variables.jsx` | 3 | option 2, select 1 |
| `src/features/agent/Agent.tsx` | 2 | button 2 |
| `src/features/alerts/AlertTxTable.tsx` | 2 | a 1, input 1 |
| `src/features/episodes/LinkedAlerts.tsx` | 2 | input 1, button 1 |
| `src/features/investigation/case-transaction-edit.jsx` | 2 | input 2 |
| `src/features/investigation/preview-case-overview.jsx` | 2 | select 1, option 1 |
| `src/features/rules/RuleConditionBlocks.tsx` | 2 | select 1, option 1 |
| `src/features/rules/rule-controls.jsx` | 2 | svg 1, path 1 |
| `src/pages/SettingsPage.tsx` | 2 | input 1, t.icon 1 |
| `src/features/alerts/AlertDetail.tsx` | 1 | textarea 1 |
| `src/features/alerts/AlertReview.tsx` | 1 | button 1 |
| `src/features/alerts/AlertVerdictForm.tsx` | 1 | a 1 |
| `src/features/dashboard/InstitutionView.tsx` | 1 | a 1 |
| `src/features/dashboard/WorkCard.tsx` | 1 | a 1 |
| `src/features/episodes/EpisodeOverview.tsx` | 1 | button 1 |
| `src/features/graph/0.24.0/OwnerGraph.tsx` | 1 | canvas 1 |
| `src/features/graph/preview-graph-controls.jsx` | 1 | input 1 |
| `src/features/investigation/case-judgment.jsx` | 1 | br 1 |
| `src/features/investigation/preview-case-graph.jsx` | 1 | input 1 |
| `src/features/investigation/preview-case-list-table.jsx` | 1 | br 1 |
| `src/features/search/GlobalSearch.tsx` | 1 | button 1 |
| `src/features/settings/model-graph.jsx` | 1 | canvas 1 |
| `src/features/transactions/transaction-stage.tsx` | 1 | button 1 |
| `src/pages/AccountPage.tsx` | 1 | input 1 |
| `src/pages/NotificationsPage.tsx` | 1 | button 1 |

## 교체 규칙

1. 상자·글자 태그(div·section·ul·li·dl·label·p·span·strong·code·time·h1~h6 …)는 코드모드로 `Box`·`Text`·`Heading`으로 바꾼다.
   className·속성·ref를 그대로 넘기므로 화면이 바뀌지 않는다. 배치까지 부품이 정하게 바꿀 때만 `Stack`·`Grid`를 쓰고, 그때는 화면 동일성 검사를 반드시 한다.
2. 누르는 것(button·a)은 `src/components`의 기존 버튼·링크 부품(`PrimaryButton`·`IconButton`·`ui/button` 등)으로 바꾼다. 모양이 같은 부품이 없으면 새로 만들지 말고 남겨 두고 보고한다.
3. 입력(input·select·option·textarea)은 `query-controls`·`search-field`·`form-dropdown`·`ui/*` 부품으로 바꾼다.
4. SVG(svg·g·path·circle·text·defs·stop …)는 차트·그래프 그림이므로 `src/components/charts` 또는 `features/graph`의 공용 그림 부품으로 옮긴다. 화면 파일에서 그림 조각을 직접 그리지 않는다.
5. `layout.js`·`screen-layouts.js`의 문자열 HTML은 `src/components/components.js`의 문자열 부품(`PanelHTML` 등)으로 바꾼다. 없는 부품은 같은 파일에 최소로 더한다.
6. br은 줄바꿈을 CSS(`white-space`)나 `Text` 두 개로 바꾼다. canvas·iframe은 해당 화면 부품 안으로 옮긴다.
7. 이름이 겹치는 파일(`AntInvestigation.tsx`·`AntReviewSite.tsx`는 antd `Text`)은 antd 부품을 쓰거나 별칭 import로 처리한다.

## 순서

대시보드 → 룰 → Alert → 조사 → 그래프 → 나머지 features → `src/pages`·`src/app`의 현재 화면 → 옛 화면(`src/pages/*.tsx`·`App.tsx`)을 맨 뒤에.
옛 화면 파일은 지우지 않는다.

## 매 화면마다

1. 고치기 전 화면을 찍는다(`parity.mjs capture before …`).
2. 교체한다(코드모드 또는 손 교체).
3. 고친 뒤를 찍고 비교한다(`parity.mjs capture after …` → `compare`). DOM 차이가 0이 아니면 원인을 찾는다.
4. 검사: `pnpm lint` · `pnpm lint:design` · `pnpm exec tsc -b` · `pnpm test` · `pnpm build`.
5. 상한을 실제 수로 내린다: `pnpm lint:design --rule component/raw-element`로 수를 보고 `scripts/design-baseline.json`의 값만 고친다.
   (`--update`는 다른 상한도 같이 내리므로 쓰지 않는다.)
6. 폴더가 0건이 되면 `scripts/design-rules.mjs`의 `errorIn`에 그 폴더를 더한다.
7. 커밋: `git -c user.name=kmg200164 -c user.email=kmg200164@gmail.com commit -m "MONEY17-151 [refactor] 명사형 요약"` — 화면 하나에 커밋 하나.
   `scripts/`는 .gitignore 대상이라 `git add -f scripts/…`로 올린다.

## 하지 말 것

- 겉모습 바꾸기(이 작업은 화면이 그대로여야 한다). 색·간격 토큰 값을 만들거나 고치지 않는다. 명기가 손으로 정한 색·간격 값을 덮지 않는다.
- eslint-disable·stylelint-disable로 디자인 규칙 끄기, `scripts/design-exceptions.json`에 이유 없이 예외 넣기, 상한 올리기.
- lucide 말고 다른 아이콘 패키지.
- 동현이 정한 폴더 구조 바꾸기, 쓰지 않는 폴더·파일 만들기.
- `src/**/case-read-state.test.js`·`src/**/live-data.test.js` 수정(부하가 걸리면 시간 초과가 나는 불안정 테스트다. 따로 돌리면 통과한다).
- master·dev 직접 푸시, 강제 푸시, 브랜치 보호 우회. 병합은 명기가 한다.
