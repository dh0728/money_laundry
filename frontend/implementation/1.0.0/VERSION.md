# AML RADAR 1.0.0 구현 보존 기록

9/26 이후 구현 계열의 최초 관리 기준이다. 이 버전 폴더가 같은 날 완성된 단일 시안이라는 뜻은 아니다. 원본 소스는 [web-app](web-app/README.md)에 있고 이번 보존 작업에서 소스 기능을 변경하지 않았다.

## HTML 구분

`web-app/index.html`과 `ant-review.html`은 Vite 진입 템플릿으로 src·개발 서버가 필요하다. [보존용 index.html](preservation/2026-10-26/index.html)은 2026-10-26에 현재 보존 소스 `71c29033e7eee1cc3fc1e7628d088a43874dbd46`를 **mock 모드로 새로 빌드한 정적 스냅샷**이다. 당시 작성한 역사 원본 HTML이 아니며 기존 파일을 덮어쓰지 않았다. assets·favicon.svg·icons.svg를 포함한 전체 폴더를 함께 보존한다. ant-review.html은 production에서 fixture 전용 안내가 나올 수 있으므로 그 페이지를 수용된 동작 화면으로 설명하지 않는다.

## 실행

mock source: VITE_API_MODE=mock pnpm exec vite --host 127.0.0.1 --port 5210 --strictPort; #alerts/3001 then graph tab. Static bundle: serve preservation/2026-10-26 over loopback HTTP; index.html#alerts/3001 then graph tab. No Backend, DB, or credentials.

새 기기는 web-app의 lockfile로 `pnpm install --frozen-lockfile`한다. 포트 사용을 먼저 확인하고 기존 프로세스를 임의 종료하지 않는다. 스냅샷 HTTP 서버는 해당 preservation 폴더에서 `python -m http.server 5211 --bind 127.0.0.1`, 주소 `http://127.0.0.1:5211/index.html#alerts/3001`이다. 서버를 이 작업에서 새로 시작하거나 공개 배포하지 않았다.

## 설계·검증·미통합

[DESIGN.md](DESIGN.md), [VERIFICATION.json](VERIFICATION.json), [전체 버전 매트릭스](../../versions.json)를 따른다. TimeGraph/PatternGraph는 10/12 계열이고 fixture/live 분기나 SDS 초기 그래프로 바꾸지 않았다. Sites SDS 외부 보존본, Mac 고유 HTML 5개·설계 원문·QA·소스 조사는 아직 이 묶음에 없다. 파일 이름이 비슷하다고 중복으로 판정하지 않는다.
