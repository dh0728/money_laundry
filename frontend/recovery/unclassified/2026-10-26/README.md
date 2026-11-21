# 1.x 미배정 회수 원본 — 2026-10-26

이 영역은 실제 디자인 minor가 아직 정해지지 않은 회수 원본이다. 후속 자료를1.0.0으로 합치지 않고 날짜·갈래·source-id로 분리한다. 더 오래된 scroll proof도 당시 참고 계보를 유지하며 1.x 제품 릴리스로 재분류하지 않는다.

검토된 원본HTML5개와 CSS1·JSON1·PNG2, 총9개를 원본파일명·동일bytes로 보존했다. Mac 원본은 원래 위치에 그대로 남아 있다. 10/23 검토HTML도 최신 세탁기형 설계 완료본이나 사용자 최종수용본이 아니다. minor 부여·원본 수정·새 UI 제작은 없다.

## 파일

- [aml-team-review-20261023.html](mac-overview-review-20261023/aml-team-review-20261023.html) — 10489 bytes · d211b797cab013ffdc939e10956d8c8e2a235ba65f0d79a829110390deb64599
- [aml-api-wiring-3d-2026-10-15-snapshot.html](mac-css3d-reference-20261015/aml-api-wiring-3d-2026-10-15-snapshot.html) — 294200 bytes · a62e893860b4374259fe8c7ff82814eb5448980df906ba3dc7b0ce6a3a56e030
- [aml-overview-responsive-states-20261014.html](../../../implementation/1.5.0/overview-1.5.0.html) — 24232 bytes · 35d8a10d7ed23f985f3dae2d9b66fde37a73e8120de9f9c89fc1fac35bb984c6
- [scroll-proof-old-worktree.html](mac-scroll-proof-reference/scroll-proof-old-worktree.html) — 5500 bytes · 4f927833546287c97f3dea4f60aab4430d5b6a304f489a96ed8ac48434a3f1a1
- [aml-evolution-review.html](mac-pairview-history-20261022/aml-evolution-review.html) — 104400 bytes · b9a5924b78da0b0306342c15be7f9aaaa7e609476f142272c8b81b88918e1fdf
- [aml-current.css](mac-pairview-history-20261022/review-assets/aml-current.css) — 152486 bytes · 65a39918d9a9af0313711c610d1fe5d1d80a1e32af3b9c054b4bcf25a83a9670
- [html-review-inventory.json](mac-pairview-history-20261022/data/html-review-inventory.json) — 56692 bytes · 40b540c107211869db9707ee90e74c26e3e2b9f2224de00f576c6f1f9018406c
- [overview-before-evidence-flow-20261022.png](mac-pairview-history-20261022/review-assets/overview-before-evidence-flow-20261022.png) — 63631 bytes · 9dcba5e2265e26fb23d683e35b2e5682974404f58af692283bbc1acf8b50afc7
- [overview-after-evidence-flow-20261022.png](mac-pairview-history-20261022/review-assets/overview-after-evidence-flow-20261022.png) — 69220 bytes · cbeccd7b5e3850b96ba3f91b1daf6132a6a57865276fbbbe363318cc445128eb

## 의존성과 열람 경계

PairView 이력HTML의 review-assets·data 상대경로는 그대로 보존했다. 고유 로컬 자산 4개는 연결 대상과 SHA를 확인했다. 원래 PairView 앱으로 돌아가는 디렉터리 링크2개는 승인9파일에 앱index가 없어 미해결로 기록했다. 원본HTML을 수정하거나 새 열람HTML을 만들어 원본처럼 표시하지 않았다.

외부 runtime 의존성은 0개이며 별도로 내려받지 않았다. 외부 탐색/참고링크도 manifest에 분리했다. 전체앱의오프라인실행·현재브라우저검수·실제서버정상동작은 보장하지 않는다. [manifest.json](manifest.json)에 각 참조와 미해결 범위를 명시한다.

## 원본과 팀 대응

manifest의 original_repository_path·source관찰시각·bytes·SHA로 Mac 원본을 식별하고, future_team_path는 팀저장소 root를 기준으로 같은frontend 상대구조에 적용할 수 있게 기록했다. 현재 팀에는 추가하지 않았고403 push를 재시도하지 않았다. 회의원문·old.md·비밀값·프로필·캐시·압축원본은 포함하지 않았다.

숫자 버전 정리 이후 최초 개요HTML은 implementation/1.5.0/overview-1.5.0.html에 내용 유지 이동했다. 나머지 회수 원본은 이 미분류 묶음에서 보존한다. 회수 시점의 minor 미배정 설명은 원래 관측 기록이며 현재 번호는 단일표와manifest를 따른다.
