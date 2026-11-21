# AML RADAR 웹앱

팀 작업 브랜치는 `frontend`예요. 기본 앱에서 3.4.1 화면이 열려요.

## 화면 검수

```sh
cd frontend/web-app
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5215 --strictPort
```

[샘플 로그인](http://127.0.0.1:5215/login?data=sample)에서 **관리자 테스트로 열기**를 누르면 돼요.

## API 연결

[요청 코드](src/api/) · [화면별 API 인계](../../docs/frontend/implementation/api.md#live-layout-api-handoff)

실제 API를 쓰려면 개발 서버 명령 앞에 `VITE_API_MODE=live`를 붙여요. `/api` 요청은 기본으로 로컬 8080에 전달돼요.
