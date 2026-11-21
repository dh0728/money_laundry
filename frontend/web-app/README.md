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

[요청 코드](src/api/) · [화면별 API 인계](../../docs/frontend/implementation/api.md#episode-api-handoff)

실제 API 사용 시 실행 명령 앞에 `VITE_API_MODE=live` 추가. `/api` 기본 연결은 Local 8080.

[화면 버전 기록](../../docs/frontend/implementation/version-history.md) · [이전 시안과 버전별 사본](https://github.com/dh0728/money_laundry/tree/09b67d800783d46df5cf2a90f2eac9d8e5a24af2/frontend)
