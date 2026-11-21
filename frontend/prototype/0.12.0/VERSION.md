# AML RADAR 0.12.0 버전 기록

기존 v12의 `0.12.0` 표기다. 중간발표 이전 역사 시안이며 현재 구현·새 디자인·사용자 수용을 뜻하지 않는다.

## 원본과 HTML

- 당시 원본 HTML 없음. 원본은 SVG이며 오늘 만든 보존 열람 HTML과 구분한다.

## 현재 생성한 보존 문서

- [보존 열람 HTML](preservation/2026-10-26/index.html) — 2026-10-26 생성, 원본 UI 변경 없음

## 실행·재현

원본 SVG를 직접 열거나 `preservation/2026-10-26/index.html`을 브라우저에서 연다. Backend·DB·Node 설치가 필요 없다.

## 관련 설계와 검증

원본 SVG/HTML·src와 이 폴더의 기존 README·design-qa·검토 인벤토리가 해당 시점의 자료다. 누적 파일은 파일 자체의 기존 버전을 유지한다. 상세 파일은 [전체 버전 매트릭스](../../versions.json), 검증은 [VERIFICATION.json](VERIFICATION.json)에 있다.

## 출처와 보존 관계

팀 원격의 기존 기준 `35cec7a36942133ecee5cdaada491cc1b0718943` → 경로 정리 로컬 `71c29033e7eee1cc3fc1e7628d088a43874dbd46`의 실제 파일을 보존한다. 원래 Git 경로·SHA-256은 [이동 매핑](../../artifact-paths.json)에 있고, 현재 묶음의 모든 파일 해시는 [보존 manifest](../../preservation-manifest.json)에 있다. Archive에도 `frontend/prototype/0.12.0`와 같은 상대 구조·같은 bytes로 보존한다. 이전 Archive 전용 원문은 이 공통 묶음으로 합치거나 팀으로 복사하지 않는다.

Mac 고유 자료와 최신 설계 원문은 아직 이 묶음에 미통합이다. 전체 로컬 수집 완료로 해석하지 않는다.
