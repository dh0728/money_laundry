# AML RADAR Web App

팀 작업 Branch `frontend` · 기본 화면 3.5.0

## 화면 검수

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5215 --strictPort
```

[Sample Login](http://127.0.0.1:5215/login?data=sample) → **관리자 테스트로 열기**

## API 연결

- 화면의 저장 호출부: [`saveEpisode`](src/app/layout.js)
- 요청 생성: [`buildAlertTransfer`·`buildEpisodeUnlink`](src/api/reviewCommands.ts)
- 요청 전송: [`submitReviewCommand`](src/api/liveReview.ts) · `POST /api/v1/review/commands`
- 편입은 사건 `caseId`·`revision`과 기존 대상의 `targetCaseId`·`targetRevision` 사용. 해제는 대상 Episode의 `caseId`·`revision`과 소속 Alert의 `groupId` 사용.
- `saveEpisode`는 현재 Sample 저장 호출부. 실제 Episode 저장 연결은 진행 전. `/api` 기본 연결은 Local 8080.
