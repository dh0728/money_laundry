# AML RADAR 웹앱

기존 UI는 2026-09-30 `fe/work`에서 제거했다. 현재 앱은 재설계 전 최소 실행 골격이다. 시연용 `dev` 브랜치는 이 변경의 대상이 아니다.

새 UI를 만들기 전에 사용자와 화면 기준을 확정하고, `backend/api-server/API.md` 및 실제 Swagger와 화면별 필드·행동을 대조한다.

제거 직전 web-app 소스는 별도로 보관했다. 이 보관본은 작업 중이던 화면의 복구용이며 승인된 디자인 정본은 아니다.

```sh
pnpm install
pnpm dev
pnpm lint
pnpm build
```
