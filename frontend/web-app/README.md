# AML RADAR 웹앱

## 실행

Node.js 22.12 이상, pnpm 11.24 사용.

```sh
pnpm install
pnpm dev
```

기본값은 로그인 없이 동작하는 시연용 mock. `?mock=empty`와 `?mock=error`로 빈 화면과 오류 화면 확인.

로컬 Backend 서버가 실행 중일 때 실제 API 모드:

```sh
VITE_API_MODE=live pnpm dev
```

기본 프록시 주소는 `http://127.0.0.1:8080`. 서버 주소가 다르면 `VITE_API_PROXY_TARGET` 지정. 브라우저에서는 같은 출처 `/api/...`로 요청하며 로그인 세션 쿠키와 CSRF 토큰 사용. 실제 모드의 대시보드·거래 내역·Alert/Episode 조사 사건은 `backend/api-server/API.md` §6.5·§7.1·§9.8 경로 기준. 알림과 RDR 9000은 실제 모드에서도 `mock` 표시.

실제 로그인·권한·데이터 왕복 확인에는 Backend 테스트 서버와 STAFF/ADMIN 계정 필요.

## 검사

```sh
pnpm lint
pnpm test
pnpm build
```
