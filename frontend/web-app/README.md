# AML RADAR Web App

팀 작업 Branch `frontend` · 기본 화면 3.6.0

## 화면 검수

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5215 --strictPort
```

[Sample Login](http://127.0.0.1:5215/login?data=sample) → **관리자 테스트로 열기**

컴포넌트 카탈로그(`/components.html`), 합성 데이터 검수(`/ant-review.html`, `VITE_API_MODE=fixture`), IBM 벤치마크(`/dashboard/all?data=ibm`)는 로컬 개발 서버에서 확인한다. 배포 빌드는 서비스 진입점(`index.html`)을 생성한다.

## 공용 UI 수정

- 팝업은 [DialogFrame](src/components/dialog-parts.jsx)을 사용한다. 제목과 닫기 버튼은 헤더에, 확인·수정 등 실제 작업은 `actions`에 둔다. 계정·설정 등 앱 셸의 팝업도 같은 헤더와 푸터를 사용한다.
- 패널 재질은 [공용 디자인 토큰](src/styles/preview-design-system.css), 업무 카드의 상태색과 외곽 효과는 [RecordCard](src/components/record-card.jsx)에서 수정한다. 화면별 예외는 기능에 필요한 경우에만 둔다.
- 한 화면에서 세로로 이어지는 영역은 페이지가 스크롤을 맡는다. 원장의 나란한 열처럼 독립 탐색이 필요한 영역은 페이지를 고정하고 목록을 스크롤한다.
- 상단 검색과 목록 검색은 [SearchField](src/components/search-field.jsx)를 사용하고, 목록은 `compact` 배리언트를 쓴다.
- `pnpm lint`는 화면 파일에 직접 선언한 `<dialog>`와 `<input type="search">`를 오류로 처리한다. `frontend` 대상 PR에서도 프런트엔드 lint, test, build를 실행한다.

## API 연결

- 화면의 저장 호출부: [`saveEpisode`](src/app/layout.js)
- 요청 생성: [`buildAlertTransfer`·`buildEpisodeUnlink`](src/api/reviewCommands.ts)
- 요청 전송: [`submitReviewCommand`](src/api/liveReview.ts) · `POST /api/v1/review/commands`
- 편입은 사건 `caseId`·`revision`과 기존 대상의 `targetCaseId`·`targetRevision` 사용. 해제는 대상 Episode의 `caseId`·`revision`과 소속 Alert의 `groupId` 사용.
- 룰 화면은 [`ruleRepository`](src/features/rules/rule-repository.js)를 호출한다. 서비스 모드에서는 서버 저장소를, 로컬 샘플 모드에서는 `sessionStorage`를 사용한다.
- `saveEpisode`는 서비스 모드에서 저장 후 서버 데이터를 다시 불러온다. 로컬 개발 서버는 `/api` 요청을 기본값 `127.0.0.1:8080`으로 전달한다.
