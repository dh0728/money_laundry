# AML RADAR Frontend 단계별 인덱스

 정리 기준일: 2026-10-26. 이 파일은 경로·계보 인덱스이며 디자인 수용·기능 완성을 뜻하지 않는다.

 | 단계 | 실제 위치 | 상태와 근거 |
 | --- | --- | --- |
 | 중간발표 이전 프로토타입 | `prototype/0.1.0`~`prototype/0.24.0` | 기존 vN→0.N.0. 보존 시안이며 현재 구현과 분리 |
 | 이후 구현 기준 | [implementation/1.0.0/web-app](implementation/1.0.0/web-app/README.md) | 9/26 이후 v24 이식 계보. 10/26 최초 관리 기준 1.0.0, 사용자 수용·실서버 검증과 별개 |
 | 새 디자인 시작 | [design/2.0.0](design/2.0.0/README.md) | 2026-10-26 시작 기준. 새 디자인 산출물·승인·완료 없음 |

 각 기존 파일→새 파일·버전·근거·상태·전후 SHA-256은 [artifact-paths.json](artifact-paths.json)에 있다. 표준 package.json·index.html·설정 파일명은 버전 폴더 안에서 유지한다. 누적 테스트/모듈은 원래 버전 번호를 보존하며 같은 내용도 삭제하지 않는다.

 ## 프로토타입 바로 가기

 - [0.1.0](prototype/0.1.0/) — 기존 v1
- [0.2.0](prototype/0.2.0/) — 기존 v2
- [0.3.0](prototype/0.3.0/) — 기존 v3
- [0.4.0](prototype/0.4.0/) — 기존 v4
- [0.5.0](prototype/0.5.0/) — 기존 v5
- [0.6.0](prototype/0.6.0/) — 기존 v6
- [0.7.0](prototype/0.7.0/) — 기존 v7
- [0.8.0](prototype/0.8.0/) — 기존 v8
- [0.9.0](prototype/0.9.0/) — 기존 v9
- [0.10.0](prototype/0.10.0/) — 기존 v10
- [0.11.0](prototype/0.11.0/) — 기존 v11
- [0.12.0](prototype/0.12.0/) — 기존 v12
- [0.13.0](prototype/0.13.0/README.md) — 기존 v13
- [0.14.0](prototype/0.14.0/README.md) — 기존 v14
- [0.15.0](prototype/0.15.0/README.md) — 기존 v15
- [0.16.0](prototype/0.16.0/README.md) — 기존 v16
- [0.17.0](prototype/0.17.0/README.md) — 기존 v17
- [0.18.0](prototype/0.18.0/README.md) — 기존 v18
- [0.19.0](prototype/0.19.0/README.md) — 기존 v19
- [0.20.0](prototype/0.20.0/README.md) — 기존 v20
- [0.21.0](prototype/0.21.0/README.md) — 기존 v21 · 9/21 v20 파생
- [0.22.0](prototype/0.22.0/README.md) — 기존 v22 · 9/22
- [0.23.0](prototype/0.23.0/README.md) — 기존 v23 · 9/22
- [0.24.0](prototype/0.24.0/README.md) — 기존 v24 · 9/25 v23 파생

 ## 구현·원격 경계

 이 정리는 `fe/work`의 `35cec7a`를 기준으로 한다. 원래 `master` `7740fa9`, `dev` `0ab8429`, `frontend` `4525d35`는 서로 다른 web-app 구현이다. prototype tree는 동일했지만 구현 차이는 합치지 않는다. dev/master push는 자동 배포를 실행할 수 있으므로 이번에 변경하지 않는다. fe/work의 경로 정리를 다른 브랜치나 개인 기기 동기화 완료로 보지 않는다.

 `src/features/graph/0.24.0`은 구현에 이식한 이전 그래프다. `timeline/TimeGraph.tsx`·`PatternGraph.tsx`와 별도이며 이번에 선택 로직을 바꾸지 않는다. Sites 저장 버전 6은 디자인 버전이 아니고 Sites SDS 코드는 이 팀 브랜치에 없다. 공개 배포·rollback·Figma 변경은 수행하지 않는다.

 ## 실행

 저장소 루트에서 `cd frontend/implementation/1.0.0/web-app`, `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm lint`, `pnpm build`. 개별 역사 prototype은 해당 `prototype/0.N.0`에서 package-lock으로 `npm ci` 후 test/build한다. 현재 실행 여부는 각 환경에서 재확인한다.


## 원격 반영 차단 — 2026-10-26

이 환경의 인증 사용자 `kmg200164`로 `dh0728/money_laundry`의 `fe/work`를 정상 push하는 사전 확인이 GitHub403(Permission denied)으로 거부됐다. 실제 원격 쓰기는 실행되지 않았다. 이 작업의 새 경로는 현재 클라우드 로컬 commit 대상이며, 원격 fe/work/dev/master/frontend에는 아직 적용되지 않았다. 권한/사용자 작업 없이 다른 계정·도구·branch로 우회하지 않는다.


## 동일 구조 포트폴리오 보존 묶음

[PRESERVATION.md](PRESERVATION.md)에서 버전별 원본/HTML/기록/실행/설계/검증/출처를 확인한다. [versions.json](versions.json)과 [preservation-manifest.json](preservation-manifest.json)에 팀 frontend와 Archive frontend의 정확한 상대 경로·파일 해시가 있다. 0.21.0~0.24.0과 구현 1.0.0 소스/오늘 정적 스냅샷,2.0.0 시작 기록을 포함한다. Mac 고유 HTML 5개·설계·QA·연구는 미통합이며 현재 원격에서 확보한 자료의 보존으로 범위를 한정한다. 기존 Archive 원본을 덮어쓰거나 개인 문서를 팀으로 복사하지 않았다.
