// AML RADAR 디자인 규칙 트리. eslint·stylelint 설정과 `pnpm lint:design` 보고서가 모두 이 파일을 읽는다.
// level: 'error' = 위반 0을 지켜야 한다(pnpm lint에서 바로 실패).
//        'ratchet' = scripts/design-baseline.json의 개수 상한을 넘으면 실패하고, 줄면 `pnpm lint:design --update`로 상한을 내린다.
// engine: 'eslint' | 'stylelint' | 'test'(vitest 구조 검사) | 'ci'
// 원칙 출처: second-brain archive/aml-radar/docs/design-principles.md (DP:줄)
export const designRuleTree = [
  {
    id: 'component', title: '공용 컴포넌트만', source: 'DP:27·181·204, README 공용 UI 수정, 명기 2026-11-24 t3149u~t3154u',
    rules: [
      { id: 'component/table-markup', title: '표는 공용 Table(components/ui/table.tsx)로만 그린다', engine: 'eslint', level: 'error' },
      { id: 'component/table-library', title: '다른 표 라이브러리(antd Table 등)를 쓰지 않는다', engine: 'eslint', level: 'ratchet' },
      { id: 'component/table-css', title: '표 모양 CSS는 components/ui/table.css·table-frame.css에만 둔다', engine: 'stylelint', level: 'ratchet' },
      { id: 'component/table-style', title: '표 줄 규격: 가로선 없음 · 세로선 테두리 토큰 30% · 머리글=1행, 홀수 행 반대색 3%', engine: 'test', level: 'error', test: 'src/test/design-rules.test.js' },
      { id: 'component/dialog', title: '팝업은 components의 DialogFrame·GlassDialog로만 만든다', engine: 'eslint', level: 'error' },
      { id: 'component/search-input', title: '검색 입력은 SearchField로만 만든다', engine: 'eslint', level: 'error' },
      { id: 'component/button', title: '버튼은 components의 공용 버튼으로만 만든다', engine: 'eslint', level: 'ratchet' },
      { id: 'component/clickable-element', title: '누르는 div·span을 만들지 않는다(button·a를 쓴다)', engine: 'eslint', level: 'ratchet' },
      { id: 'component/panel', title: '패널은 공용 Panel로만: 패널 클래스(screen-panel·panel-material·panel-inset) 직접 사용·Panel에 glass·패널 깊이 CSS 복제 금지', engine: 'eslint+stylelint', level: 'error' },
      { id: 'component/raw-element', title: '화면 파일(src/components 밖)에는 맨 DOM 태그 없이 공용 컴포넌트 인스턴스만 둔다', engine: 'eslint', level: 'ratchet',
        // 0건이 된 폴더는 여기 더해 바로 오류로 막는다(pnpm lint·커밋 전 검사).
        errorIn: ['src/features/dashboard/', 'src/features/investigation/', 'src/features/notifications/', 'src/lib/'] },
      { id: 'component/dom-api', title: '화면 파일에서 createElement·innerHTML로 태그를 만들지 않는다', engine: 'eslint', level: 'ratchet' },
      { id: 'component/form-control', title: '화면 파일에 맨 input·select·textarea 금지, 공용 입력 부품 사용', engine: 'eslint', level: 'ratchet' },
    ],
  },
  {
    id: 'token', title: '색·간격·크기는 토큰만', source: 'DP:28',
    rules: [
      { id: 'token/raw-color', title: '직접 색 값(hex·rgb·hsl·oklch, 계산한 hsl(${…}) 포함) 금지, 색 토큰 사용', engine: 'eslint+stylelint', level: 'ratchet' },
      { id: 'token/spacing-unit', title: '간격(padding·margin·gap·inset)에 px·rem 숫자 금지, space 토큰 사용', engine: 'stylelint', level: 'ratchet' },
      { id: 'token/radius-unit', title: '모서리에 px·rem 숫자 금지, radius 토큰 사용', engine: 'stylelint', level: 'ratchet' },
      { id: 'token/font-size-unit', title: '글자 크기에 px·rem 숫자 금지, type 토큰 사용', engine: 'stylelint', level: 'ratchet' },
      { id: 'token/inline-style', title: '인라인 스타일 금지(CSS 변수 전달만 허용)', engine: 'eslint', level: 'ratchet' },
      { id: 'token/arbitrary-class', title: 'Tailwind 임의 값(w-[13px] 등) 금지', engine: 'eslint', level: 'ratchet' },
      { id: 'token/important', title: '!important 금지(움직임 끄기 장치만 허용)', engine: 'stylelint', level: 'ratchet' },
      { id: 'token/fixed-number', title: '고정 숫자 금지(크기·선·그림자·투명도·z-index·시간·변형·JSX 크기 prop·문자열 단위). 0·100%·50%·fr·flex·auto 등 채우기·맞추기 값만 허용', engine: 'eslint+stylelint', level: 'ratchet' },
      { id: 'token/inline-var-number', title: '인라인 style·setProperty로 넘기는 CSS 변수 값에 숫자 금지(토큰 var만)', engine: 'eslint', level: 'error' },
      { id: 'token/palette-direct', title: '화면 파일(src/components·src/styles 밖)에서 원시 색(--palette-*·--aml-색이름-숫자) 직접 사용 금지', engine: 'eslint+stylelint', level: 'ratchet' },
      { id: 'token/series-color', title: '전체 거래는 회색, 새 계좌는 청록, 새 소유주는 분홍. 회색과 상태 색은 해당 의미에만 사용', engine: 'eslint', level: 'error' },
      { id: 'token/undefined-var', title: '정의 없는 CSS 변수 참조 금지(대체값 없는 var)', engine: 'eslint+stylelint', level: 'error' },
    ],
  },
  {
    id: 'font', title: '글꼴은 Pretendard 하나', source: '명기 2026-11-23 t3131u~t3134u',
    rules: [
      { id: 'font/family', title: '글꼴은 글꼴 토큰(var)·inherit만, Pretendard 외 글꼴과 대체 글꼴 금지', engine: 'eslint+stylelint', level: 'error' },
      { id: 'font/tokens', title: '글꼴 토큰 값은 Pretendard 단독, Pretendard 외 글꼴 파일 없음', engine: 'test', level: 'error', test: 'src/test/design-rules.test.js' },
    ],
  },
  {
    id: 'chart', title: '차트·그래프는 라이브러리를 한 곳에서', source: 'DP:40',
    rules: [
      { id: 'chart/library-import', title: '차트·그래프 라이브러리는 components/charts·features/graph에서만 불러온다', engine: 'eslint', level: 'ratchet' },
    ],
  },
  {
    id: 'icon', title: '아이콘은 lucide 하나', source: 'DP:164, 명기 2026-11-24',
    rules: [
      { id: 'icon/library', title: '아이콘 패키지는 lucide-react만(허용 목록, 다른 아이콘 패키지 import·의존성 금지)', engine: 'eslint+test', level: 'error', test: 'src/test/design-rules.test.js' },
      { id: 'icon/local-svg', title: '로컬 SVG 아이콘 파일(import·CSS url) 금지, lucide-react 사용', engine: 'eslint+stylelint', level: 'ratchet' },
    ],
  },
  {
    id: 'contrast-shape', title: '대비·모양·확대·움직임', source: 'DP:68·196·205',
    rules: [
      { id: 'contrast-shape/text-contrast', title: 'Primary·Danger 글자 대비 4.5 이상', engine: 'test', level: 'error', test: 'scripts/sync-semantic-tokens.test.mjs' },
      { id: 'contrast-shape/button-shape', title: '버튼 상태(hover·focus)에서 크기·모양 불변', engine: 'test', level: 'error', test: 'src/test/button-shape.test.jsx' },
      { id: 'contrast-shape/zoom', title: '브라우저 확대를 막지 않는다(user-scalable=no·maximum-scale 금지)', engine: 'test', level: 'error', test: 'src/test/design-rules.test.js' },
      { id: 'contrast-shape/motion-setting', title: '움직임은 앱 설정(움직임 줄이기)·prefers-reduced-motion을 따른다', engine: 'eslint+test', level: 'error', test: 'src/test/design-rules.test.js' },
    ],
  },
  {
    id: 'escape-hatch', title: '규칙을 피할 길 막기', source: '명기 2026-11-23 t3134u',
    rules: [
      { id: 'escape-hatch/disable-comment', title: 'eslint-disable·stylelint-disable로 디자인 규칙을 끄지 않는다(규칙 없는 disable 포함)', engine: 'eslint+stylelint', level: 'error' },
      { id: 'escape-hatch/any-disable', title: 'eslint-disable 주석은 규칙과 상관없이 쓰지 않는다(코드를 고친다)', engine: 'eslint', level: 'error' },
      { id: 'escape-hatch/exceptions', title: '예외는 scripts/design-exceptions.json 한 곳에 이유·만료일과 함께', engine: 'test', level: 'error', test: 'src/test/design-rules.test.js' },
      { id: 'escape-hatch/ratchet', title: '상한(scripts/design-baseline.json)을 넘는 새 위반 금지, 상한에 여유가 남아도 실패(pnpm lint:design --update로 내린다)', engine: 'test', level: 'error', test: 'src/test/design-rules.test.js' },
    ],
  },
  {
    id: 'automation', title: 'AI·사람 모두 자동으로 걸리게', source: '명기 2026-11-23 t3134u',
    rules: [
      { id: 'automation/ci', title: 'CI가 fe/work·frontend·dev 푸시와 병합 요청에서 디자인 위반 0건·테스트·서비스 빌드 검사', engine: 'ci', level: 'error', test: 'src/test/design-rules.test.js' },
      { id: 'automation/git-hooks', title: 'lefthook: 커밋 전 eslint·stylelint·lint:design, push 전 lint:design', engine: 'ci', level: 'error', test: 'src/test/design-rules.test.js' },
    ],
  },
]

export const designRules = designRuleTree.flatMap(category => category.rules.map(rule => ({ ...rule, category: category.id })))
export const ruleById = new Map(designRules.map(rule => [rule.id, rule]))
/** eslint·stylelint 플러그인 안 규칙 이름. 'token/raw-color' → 'aml/token-raw-color' */
export const pluginRuleName = id => `aml/${id.replace('/', '-')}`

// 아이콘은 lucide-react만 허용한다(허용 목록). 패키지 이름에 icon이 들어가거나 이름에 icon이 없는 알려진 아이콘 패키지면 막는다.
export const ICON_ALLOWED = 'lucide-react'
export const ICON_PACKAGE = /icon|^react-feather$|^feather-icons|^@mdi\/|octicons|^remixicon|^boxicons|^@iconify|^lucide$|^@lucide\//i
export const packageName = source => source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0]
export const bannedIconPackage = source => {
  if (/^(\.|\/|@\/)/.test(source)) return false
  const name = packageName(source)
  return name !== ICON_ALLOWED && ICON_PACKAGE.test(name)
}
