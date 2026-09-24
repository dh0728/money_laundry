---
parent: '[[Frontend]]'
created: 2026-09-18
updated: 2026-09-18
tags: [project, frontend, wireframe, review]
---

# AML RADAR v18 브라우저 QA

기준은 [figma-v17-수정사항-인벤토리](figma-v17-수정사항-인벤토리.md)예요. 2026-09-18에 box에서 vitest·tsc로 1차 검증했고, 단일 HTML 빌드 후 Mac에서 열어 확인하는 흐름이에요.

| 영역 | 확인 동작 | 결과 |
|---|---|---|
| 로그인 L1 | frosted glass 패널 | `.login-glass-panel` + backdrop blur CSS / Tailwind 보강. v18-shell 3 tests |
| 표 T1–T3 | 정렬 아이콘·활성 반전·행/폰트 | shared SortIcon + Lists/UtilityPages. 9 tests |
| Agent R2–R5 | textarea resize, 구분선, 플로팅 클램프, 히스토리 폭 | 8 tests. F11은 App shell 유지 |
| Detail R1–R2 | 저장본 없으면 목록 버튼 disabled, textarea resize-y | 4 tests |
| Graph G1–G7 | 세로 계좌, 화살표 중앙, 5px 왼쪽 갭, push 분할, 리사이즈, Sankey pan/zoom | 11 tests |
| 전체화면 R4 | F11 | App.tsx `aria-label` + `<Kbd>F11</Kbd>` + keydown |

**검증 한계**
- Figma section v17 frame ~13장 중 UI 판독 9장.
- 리사이즈 드래그·라이트 테마·세로 모니터 실기기는 코드/단위 테스트로만 확인.
