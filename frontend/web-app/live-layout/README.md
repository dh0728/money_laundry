# AML RADAR 인터랙티브 프리뷰

화면 코드는 [서비스 앱의 src](../src)에 있습니다. 아래 명령은 기존 프리뷰 주소에서 같은 화면을 엽니다.

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm exec vite live-layout --config live-layout/vite.config.mjs
```

[내 대시보드](http://localhost:5215/dashboard/mine)를 열고 **관리자 테스트로 열기**를 선택하면 팀원 권한과 모델 위험 구간을 확인할 수 있습니다. **분석가 테스트로 열기**는 `STAFF` 권한으로 입장합니다. 샘플 로그인 입력은 아이디 `demo`, 비밀번호 `radar-demo`를 사용합니다. 정적 빌드는 같은 폴더에서 `pnpm exec vite build live-layout --config live-layout/vite.config.mjs`로 생성합니다.

| 화면 | 로컬 주소 |
| --- | --- |
| 대시보드 | [내 대시보드](http://localhost:5215/dashboard/mine) · [전체 대시보드](http://localhost:5215/dashboard/all) |
| 룰 엔진 | [룰 목록](http://localhost:5215/rules) · [룰 만들기](http://localhost:5215/rules/new) · [백테스트](http://localhost:5215/rules/backtest) |
| 조사 | [원장](http://localhost:5215/investigate/ledger) · [Alert](http://localhost:5215/investigate/alerts) · [Episode](http://localhost:5215/investigate/episodes) |
| 보고서 | [판정 이력과 PDF 미리보기](http://localhost:5215/report) |
| 공통 컴포넌트 | [카탈로그](http://localhost:5215/components.html) |

상단 중앙의 아이콘으로 대시보드, 룰 엔진, 조사, 보고서로 이동합니다. 아이콘에 마우스를 올리면 화면 이름을 확인할 수 있습니다. 대시보드와 카드 보기에서는 상단의 조회 도구를 사용합니다. 표 보기에서는 표 제목 옆 도구와 열 제목의 정렬 버튼을 사용합니다. 표 머리의 체크박스는 표시된 행 전체를 선택합니다. 필터나 기간은 조건을 고른 뒤 **적용**을 누릅니다. 적용한 조건은 조회 영역의 태그에서 확인하고 제거합니다.

기본 [조사 화면](http://localhost:5215/investigate/ledger)은 소유주 → 계좌 → 거래와 연결 업무를 샘플로 보여줍니다. 카드와 표는 같은 거래와 선택을 사용합니다. [IBM 벤치마크 대시보드](http://localhost:5215/dashboard/all?data=ibm)는 2022년 9월 1~18일의 전체 거래, 원본 세탁 라벨, 처음 등장한 계좌와 은행 코드를 집계합니다. 선택한 기간을 집계와 CSV에 함께 적용합니다.

원장에는 원본 세탁 라벨이 1인 거래 5,177건과 0인 예시 88건을 담았습니다. IBM이 제공한 CSV에서 행을 선별하고 JSON으로 변환했으며 지급·수취 통화와 금액을 보존했습니다. 거래 ID는 CSV의 행 순서와 거래일에서 생성합니다. 다시 생성하려면 `python3 scripts/extract-ibm-hi-small.py <HI-Small_Trans.csv 경로> src/mocks/ibm-hi-small-data.json`을 실행합니다. [IBM AML-Data](https://github.com/IBM/AML-Data) · [CDLA-Sharing-1.0](https://cdla.dev/sharing-1-0/)

담당자별 Alert·Episode와 판정 이력에는 팀 업무 API 연결이 필요합니다. 기존 그래프, 판정·보고서 등 업무 흐름은 [샘플 검수 모드](http://localhost:5215/dashboard/mine?data=sample)에서 확인할 수 있습니다. 개별 원본 거래는 [IBM 벤치마크 원장](http://localhost:5215/benchmark/ledger?view=table)에서 조회합니다.

**다운로드** 메뉴에서 조회 범위의 CSV나 화면에 표시된 차트·그래프를 PNG 또는 SVG로 저장할 수 있습니다. 샘플 검수 모드에서는 판정을 선택한 뒤 PDF도 저장할 수 있습니다.

팀원 각자의 컴퓨터에서 개발 서버가 실행되는 동안 로컬 URL이 열립니다. 브랜치에 푸시된 최신 커밋으로 맞춘 뒤 다시 실행하면 같은 프리뷰를 볼 수 있습니다.

## 룰 엔진과 백엔드 인계

- 룰 목록·상세와 샘플 상태는 [preview-rule-workspace.jsx](../src/features/rules/preview-rule-workspace.jsx)에 있습니다.
- 룰 작성·백테스트 화면은 [workflow-components.jsx](../src/pages/workflow-components.jsx), 조건 트리는 [rule-condition-tree.jsx](../src/features/rules/rule-condition-tree.jsx)에 있습니다.
- 조회·저장·실행 API의 현행 계약과 합의할 항목은 [백엔드 인계](../../../docs/frontend/implementation/api.md#live-layout-api-handoff)에서 확인할 수 있습니다.

## 디자인 시스템

프리뷰의 공통 변수는 개발용 [변수 카탈로그](http://localhost:5215/components.html#variables)에서 확인할 수 있습니다. 라이트·다크 색상, 실제 변수 이름, 주요 적용 위치를 검색할 수 있습니다. [카드와 목록](http://localhost:5215/components.html#records)에서는 카드, 판정 태그, 표를 직접 조작해 볼 수 있습니다.

| 단위 | 맡는 일 | 수정하는 곳 |
| --- | --- | --- |
| 변수 | 색, 글자 크기, 여백, 모서리와 같이 반복하는 값 | [Figma 프리뷰 디자인 시스템](https://www.figma.com/design/iWjQL5GdXwenHGeZNHF4Uw?node-id=8-101)과 [웹의 디자인 시스템 CSS](../src/styles/preview-design-system.css) |
| 공통 컴포넌트 | 태그의 아이콘, 카드의 버튼, 패널의 글래스처럼 반복하는 모양과 동작 | [태그](../src/components/semantic-tags.jsx) · [카드 헤더](../src/components/card-header.jsx) · [패널](../src/components/panel.jsx) · [표](../src/components/workflow-table.jsx) |
| 화면 | 구성 요소의 배치와 표시할 거래·Alert·Episode 선택 | [대시보드](../src/features/dashboard/preview-dashboard.jsx) · [Alert 개요](../src/features/investigation/preview-case-overview.jsx) · [분석](../src/features/investigation/preview-case-graph.jsx) |

예를 들어 이상 판정의 색을 바꾸면 공통 색을 읽는 태그와 카드, 표, 글로우에 반영됩니다. 체크박스의 모양이나 플러스 버튼의 크기를 바꿀 때는 공통 카드 헤더를 수정합니다. 각 화면에 배치된 카드 인스턴스는 이 헤더에 자기 제목과 상태, 클릭 시 동작을 전달합니다.

대시보드에서 전체·그 외 거래는 회색입니다. 빨강은 고위험, 망고 노랑은 주의, 초록은 낮은 위험이나 처리 완료, 파랑은 처리 중, 보라는 처리 전을 표시합니다. 차트와 진한 태그는 같은 색을 읽고, 보드 열 제목의 태그는 그 색을 옅게 섞어 표시합니다.

Figma의 **Local variables**에서 공통 변수를 편집할 수 있습니다. 컴포넌트는 원본을, 배치는 [Figma 화면 흐름](https://www.figma.com/design/iWjQL5GdXwenHGeZNHF4Uw?node-id=10-3)을 편집하세요. 바꾼 변수나 화면의 링크를 공유하면 해당 변경을 프리뷰 코드에 반영할 수 있습니다.

별도 비교판은 팀장님의 [`test_front` 구현](https://github.com/dh0728/money_laundry/tree/792970ce6be97f435b89299714e5651af8e0db2d/frontend/web-app/src/redesign)입니다. 인터랙티브 프리뷰의 화면 배치를 검토할 때 [Figma 원본](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh)과 함께 참고합니다.
