# AML RADAR 웹앱

팀 작업 브랜치 `frontend` · 기본 화면 3.4.1

## 화면 검수

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5215 --strictPort
```

[샘플 로그인](http://127.0.0.1:5215/login?data=sample) → **관리자 테스트로 열기**

## API 연결

[요청 코드](src/api/) · [화면별 API 인계](../../docs/frontend/implementation/api.md#live-layout-api-handoff)

실제 API 사용 시 실행 명령 앞에 `VITE_API_MODE=live` 추가. `/api` 기본 연결은 로컬 8080.
