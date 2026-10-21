# AML RADAR 웹앱

## 합성 데이터로 화면 확인

Node.js 22.12 이상과 pnpm 11.24를 사용한다.

```sh
pnpm install --frozen-lockfile
VITE_API_MODE=fixture pnpm dev --host 127.0.0.1
```

`#dashboard`, `#transactions`, `#alerts/1`, `#episodes/50`에서 조사 흐름을 확인한다. 모든 값은 가상 데이터이며 화면 위에 합성 표시가 나온다. 서버 저장과 판정은 차단된다.

운영 API 없이 정적 검수본을 만들 때 다음 명령을 실행한다.

```sh
VITE_API_MODE=fixture VITE_STATIC_DEMO=true pnpm build
```

이 빌드에는 실제 로그인이나 서버 저장 기능이 없다. 기본 `pnpm dev`는 별도의 mock 시연 화면을 연다.

## 테스트 Backend에 연결

```sh
VITE_API_MODE=live VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm dev --host 127.0.0.1
```

브라우저는 같은 출처의 `/api/...`로 요청한다. 직원 세션 쿠키와 CSRF 토큰을 사용한다. 데이터 계약은 `backend/api-server/API.md`를 따른다.

이진 점수와 유형 점수의 출처는 구분한다. 현재 Backend 계약은 이진 GNN과 시연용 유형 모델을 사용하며, 사건 응답만으로 개별 사건의 모델 버전을 확정할 수 없다. 룰 결과 API가 연결되지 않은 상태는 미적중 0건과 다르다. RDR 문장은 mock으로 표시한다.

## 배포용 검사

```sh
pnpm test
pnpm lint
VITE_API_MODE=live pnpm build
```

`frontend` 브랜치 반영과 공용 서버 배포는 별개다. Backend와 합의하지 않은 API나 권한을 화면에서 우회하지 않는다.
