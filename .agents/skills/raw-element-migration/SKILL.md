---
name: raw-element-migration
description: 화면 파일의 맨 DOM 태그를 공용 부품(Box·Text·Heading·Stack·Grid·Panel·버튼 부품)으로 바꾸고, 고치기 전·후 화면이 같은지 DOM·픽셀로 확인할 때 쓴다. component/raw-element 규칙(JPM-15·MONEY17-151) 작업용.
---

# 맨 태그 교체와 화면 동일성 검사

인계 문서: `frontend/web-app/qa/raw-element/PLAN.md` (남은 파일·교체 규칙·순서·금지 사항). 먼저 읽는다.

## 준비 (한 번)

```bash
cd frontend/web-app
pnpm install
pnpm exec playwright install chromium   # 설치된 Chrome을 쓰려면 대신 CHROME_PATH=/path/to/chrome
pnpm dev --port 5173 --strictPort &     # 화면 검사용 dev 서버
```

모든 명령은 `frontend/web-app`에서 실행한다. `S=../../.agents/skills/raw-element-migration/scripts`

## 한 화면 교체

1. 남은 위치: `pnpm lint:design --rule component/raw-element --full`
2. 고치기 전 찍기(화면마다 이름 하나):
   `node $S/parity.mjs capture before dash-all "/dashboard/all?data=sample"`
   - 라이트도 보려면 `THEME=light`. 기본 주소는 `BASE=http://127.0.0.1:5173`.
   - 주요 경로: `/dashboard/all` · `/dashboard/mine` · `/rules` · `/rules/backtest` · `/investigate/alerts`(`&view=table`) ·
     `/investigate/episodes` · `/alerts/A-261111-000006`(`&tab=related`) · `/episodes/E-261111-000001` · `/investigate/ledger` ·
     `/report`(`&view=card`) · `/components.html` — 모두 `?data=sample`을 붙인다.
3. 교체: 상자·글자 태그는 코드모드 `node $S/codemod.mjs <파일...>`, 나머지는 PLAN.md 규칙대로 손으로.
4. 고친 뒤 찍고 비교: `node $S/parity.mjs capture after dash-all "/dashboard/all?data=sample"` → `node $S/parity.mjs compare dash-all`
   - `dom-changed-lines=0`이어야 한다(아니면 종료 코드 1). 픽셀 수는 움직이는 로고·버튼 광택·현재 시각 글자만큼은 남는다.
   - 대화상자처럼 눌러야 보이는 부분은 해당 테스트(`pnpm test <폴더>`)로 확인한다.
5. 검사 다섯 가지를 실제로 돌리고 결과를 그대로 적는다: `pnpm lint` · `pnpm lint:design` · `pnpm exec tsc -b` · `pnpm test` · `pnpm build`.
   통과·실패를 나눠 적고, 돌리지 않은 검사는 "안 돌림"으로 적는다. 결과를 보기 전에 "통과"라고 쓰지 않는다.
6. 상한을 실제 수로 내리고(`scripts/design-baseline.json`의 `component/raw-element`만), 0건 폴더는 `scripts/design-rules.mjs`의 `errorIn`에 더한다.
7. 화면 하나에 커밋 하나: `MONEY17-151 [refactor] 명사형 요약`, 작성자 `kmg200164 <kmg200164@gmail.com>`. `scripts/` 파일은 `git add -f`.

## 부품

- `Box({ as })`: 배치 없는 상자. `Text({ as, tone })`: 글자(`tone="muted"`만 공용 글자색). `Heading({ level })`: 제목.
  세 부품은 className·속성·ref를 그대로 넘겨 같은 DOM을 그린다.
- `Stack`·`Grid`: 부품이 배치(flex·grid·간격 토큰)를 정한다. 겉모습이 바뀔 수 있으니 동일성 검사로 확인한 곳에서만 쓴다.
- 누르지 않는 면은 `Panel`, 누르는 카드는 `RecordCard`(`opensRecord`), 버튼은 `src/components`의 버튼 부품.
- 새 부품은 꼭 필요할 때만 `src/components` 안 기존 파일에 최소로 더한다. 아이콘은 lucide-react만.
