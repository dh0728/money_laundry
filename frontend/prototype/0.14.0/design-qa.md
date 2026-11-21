---
created: 2026-09-16
updated: 2026-09-16
tags: [project, frontend, design_qa]
---

# v13 design QA

## Evidence

- Source: 사용자 제공 현재 v13 화면 `스크린샷 2026-09-16 19.40.44.png`, 과거 통합 기간 선택기 `19.48.19.png`, 목록 조건 화면 `19.49.02.png`, header control `19.50.13.png`.
- Implementation: `qa-implementation-calendar.png`.
- Combined comparison: `qa-calendar-comparison.png` — 위는 기간 선택 reference, 아래는 v13 구현.
- Implementation viewport: 1440×1000 CSS px. Source screenshot은 3248×2122 px이며 비교 이미지에서 폭 1440 px로 정규화했다.
- Compared state: dark theme, Alert 전체 목록, 기간 선택 popover open.

## Review history

1. P1 — 사이드바 밖 toggle, 기관명 중심 header, 누락된 전역 검색·할 일·권한·전체화면: application shell을 재구성했다.
2. P1 — 목록 조건을 category tab으로 분리하고 시작일·종료일 calendar를 나눈 구성: filter preset과 하나의 range popover로 교체했다.
3. P1 — 설정이 theme 하나로 축소된 상태: 일반·목록·알림·시스템/라이트/다크 설정을 복원했다.
4. P2 — 조사 도우미의 세 표시 방식을 동시에 노출한 상태: 현재 방식 button 하나와 선택 menu로 교체했다.

## Final inspection

- Sidebar: toggle이 sidebar brand 영역 안에 있고, 알림·설정·계정 진입이 하단에 있다.
- Header: AML RADAR, 중앙 전역 검색, 할 일 수, 권한, 전체화면이 보이며 날짜와 가상 은행명이 없다.
- Lists: 결과 축소 조건은 filter preset/chip이며, Dashboard `전체 목록`은 무필터 결과로 이동한다.
- Date range: 한 popover 안에서 preset, 두 달 range calendar, 취소와 적용을 처리한다. 공식 shadcn Calendar의 두 달 배치를 사용해 reference의 연속형 월 경계와 시각적 구조는 다르지만 기능과 정보 구조는 일치한다.
- Agent: 현재 mode 하나만 표시하며 menu를 열었을 때만 세 선택지가 보인다.
- Filter처럼 동작하던 목록 quick view는 Alert와 Episode에서 제거했다. 남은 tab은 상세 구획, 개인/기관 dashboard, 알림 읽음 상태처럼 서로 다른 content view를 전환한다.
- 1440×1000 desktop에서 겹침, 잘림, 비의도 가로 overflow를 발견하지 않았다.
- Actionable P0/P1/P2 findings remaining: none.

final result: passed
