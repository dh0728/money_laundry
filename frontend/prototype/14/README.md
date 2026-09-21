---
parent: '[[Frontend]]'
created: 2026-09-16
updated: 2026-09-17
tags: [project, frontend, wireframe]
---

# AML RADAR · v14

[단일 HTML 실행](AML-RADAR-v14.html). 브라우저에서 열면 된다. React·CSS·아이콘·컴포넌트 코드를 한 파일에 포함하며 런타임 CDN 의존성이 없다. 개발 원본은 이 폴더의 `src/`다.

후속 HTML v15는 사용자가 Figma에 정리한 **v14 수정사항**을 기준으로 Claude가 이어서 작업한다. 전체 인수인계 지시는 [Claude v15 인수인계 프롬프트](Claude-v15-인수인계-프롬프트.md)에 기록했다.

## 기준

- 사용자가 복제한 [Figma shadcn UI Kit / Wireframe](https://www.figma.com/design/5UKRqTKWbuTI1oUXpTKDMc/AML-RADAR-%C2%B7-shadcn-ui-kit?node-id=6003-17)의 v1~12를 참고했다. v0은 백엔드 HTML이며, v12를 우선 정본으로 취급하지 않는다. 이번 비교에서 v1~12 대시보드, v1~4 Alert 상세, v11 comment pin의 관련 화면을 확인했다. 모든 버전의 모든 frame을 정밀 검수했다는 의미는 아니다.
- 현재 판단은 [디자인 원칙](../../../디자인%20원칙.md), [Userflow 설계 기록](../../../../Userflow%20설계%20기록.md), 2026-09-16 사용자 지시를 적용했다. 오래된 회의의 상충하는 규칙으로 최신 지시를 덮지 않았다.
- Figma의 복제 킷은 이미 존재한다. 코드의 shadcn 소스는 별도이며, 이번 v14에 공식 CLI `shadcn@4.21.0 add`로 가져왔다. 실제 Figma 파일과 v1~12 SVG는 수정하지 않았다.
- 사용자 시각 승인 전 HTML 검토본이다. 실제 backend repository의 API 구현 완료를 의미하지 않는다.

## 구현

- 사이드바 내부 접기, 하단 알림·설정·계정 진입, 중앙 전역 검색, 할 일 개수·권한·전체화면을 갖춘 AML RADAR application shell.
- 개인/기관 대시보드, Alert·Episode 검색/AND 필터/단일 기간 선택기/정렬/페이지/CSV, 상세 개요와 하단 이력, 거래, 검토 의견, 임시 저장과 복원, 종결 확인, 기존 Episode 연결. `내 담당 미처리 / 고위험 / 3일 이상 / 전체`는 category tab이 아니라 filter preset으로 제공한다.
- 역할별 시연 진입. 두 역할 모두 공통 화면에 접근하며 담당자만 최종 처리한다. 역할 변경은 로그아웃 후 시연 계정 선택으로 진행한다.
- 30계좌·33연결 관계 그래프. 위험도 필터, 노드 선택과 1~3 hop, 계좌 검색 후 Enter, 거래선 선택과 좌·우 account lane, 금액 굵기/위험도 색, pan/zoom/화면 맞춤/전체화면, 내부 거래 스크롤.
- 조사 도우미의 현재 표시 방식 button과 sidebar/floating/전체화면 선택 menu, draggable floating panel, agent 내부 새 대화·이전 대화 sidebar, 후속 질문. **응답은 스크립트 예시**이며 실제 모델 분석과 외부 전송은 없다.
- 로그인 왼쪽은 Vanta NET의 관계 시각화를 참고한 canvas node·edge animation이다. pointer에 반응하며 reduced-motion에서는 정지 화면으로 바뀐다.
- 알림 읽음, 시스템/라이트/다크 테마, 시간대·날짜 형식·목록 기본값·알림 설정, 프로필 이미지의 화면 내 변경, 현재/다른 세션 카드와 로그아웃 확인.
- 로딩·빈 결과·첫 조회 실패·재조회 실패 상태를 구성 요소 단위로 검증한다.

## 컴포넌트 출처

`src/components/ui/`는 [공식 shadcn UI](https://ui.shadcn.com/docs/installation/vite) registry에서 가져온 소스다. Button, Input, Label, Textarea, Card, Badge, Tabs, Table, Calendar, Dialog, Alert Dialog, Sheet, Popover, Select, Checkbox, Switch, Slider, Tooltip, Scroll Area, Resizable, Sidebar, Chart, Progress, Avatar, Skeleton, Sonner를 조합했다. 아이콘은 Lucide다.

공식 Tabs의 `line` variant에 하단 전체 divider와 같은 위치의 active stroke를 적용했고, 공식 Sidebar의 active 대비 및 neutral theme token을 조정했다. 차트는 shadcn Chart/Recharts다. shadcn에 해당 도메인 표현이 없는 계좌 관계 그래프와 계좌쌍 거래 화살표만 SVG로 직접 구현했다. 별도의 버튼·입력창·달력 라이브러리를 새로 만들지 않았다.

## 실행과 검증

Node 22.12 이상에서 이 폴더를 연 뒤 실행한다.

```sh
npm ci
npm run dev
npm test
npm run build
```

빌드는 `dist/index.html`과 동일한 `AML-RADAR-v14.html`을 만든다. 검증 당시 파일 크기는 약 1.11 MB다.

2026-09-17 2차 전면 재구현 확인:

- TypeScript 검사와 production single-file build 통과. 자동 테스트 16개 통과: 기존 domain·Calendar 테스트와 sidebar, agent, 기간, table, graph, 상세 header, Dashboard, 로그인 canvas 회귀 테스트.
- 브라우저에서 agent 대화 sidebar·mode 전환·document scrollbar 유지, Alert 기간 필터 22→6건, 거래 금액 column 정렬, 상세 목록 복귀의 공통 header 배치, sticky header, graph 전체화면→화면 맞춤 순서·3 hop·risk 색·edge account lane을 직접 조작했다.
- 1440×900 headless Chrome에서 로그인 양분 화면과 canvas network의 node·edge 배치를 시각 확인했다.
- 1440×1000과 1280×900 desktop에서 확인. 1280px 문서의 가로 overflow 없음. [최종 그래프 렌더](preview-graph.png) 확인. 모바일 전체 흐름과 실제 API/모델은 검증 범위가 아니다.
- 개발 모드의 `next-themes` inline script에 React 경고가 기록되었으나 최종 production 페이지에서 새 오류가 기록되지는 않았다. 테마는 `next-themes`를 사용한다.

## 프로토타입 경계

수치·계좌·기관·프로필·세션은 샘플이며 인증, 서버 저장, 모델 추론, SSO가 연결되지 않았다. 처리 결과·의견·연결은 현재 실행 메모리에서 유지하고 새로고침 시 초기화한다. CSV는 현재 필터 결과를 브라우저에서 생성한다. 그래프는 동일한 관계 데이터셋을 보여주며 실제 사건별 API 범위 조회를 대신하지 않는다. Episode 신규 생성/병합/분리, 실시간 충돌 제어, 대용량 graph 성능은 이 검토본에 포함하지 않았다.
