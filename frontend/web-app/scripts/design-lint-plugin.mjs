// AML RADAR 디자인 규칙 구현. 규칙 목록·수준은 scripts/design-rules.mjs, 예외는 scripts/design-exceptions.json 한 곳에만 둔다.
// eslint 플러그인(aml/*)과 stylelint 플러그인(aml/*)이 같은 규칙 이름을 쓴다.
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import stylelint from 'stylelint'
import { bannedIconPackage, designRules, pluginRuleName } from './design-rules.mjs'

export const appRoot = resolve(import.meta.dirname, '..')
export const rel = file => relative(appRoot, resolve(appRoot, file)).split(sep).join('/')
const NOT_APP = /^src\/(test|mocks)\/|\.(test|stories)\.[cm]?[jt]sx?$/
export const isAppSource = path => path.startsWith('src/') && !NOT_APP.test(path)
/** 토큰 정의 파일. 여기서는 사용자 정의 속성(--*) 값에 실제 값을 둘 수 있다. */
export const isTokenFile = path => /^src\/styles\/[^/]+\.css$/.test(path)
export const exceptionsPath = resolve(appRoot, 'scripts/design-exceptions.json')
export const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8'))
const excepted = (ruleId, path) => exceptions.some(entry => entry.rule === ruleId && entry.file === path)
const inside = (path, prefixes) => prefixes.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)

export const COLOR_RE = /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+]?[\d.]/g
const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'])
const ARBITRARY_CLASS = /^(?:\S*:)?!?-?[a-z][\w-]*-\[[^\]\s]+\]$/
const FONT_VALUE_OK = /^(inherit|initial|unset|var\(--[\w-]*font[\w-]*\))$/
const CHART_SOURCES = /^(recharts|d3(-[\w-]+)?|d3-sankey|react-force-graph(-[\w-]+)?|@xyflow\/react|elkjs(\/.*)?)$/
const TABLE_LIBRARIES = /^(antd\/(es|lib)\/table|@mui\/x-data-grid|ag-grid-[\w-]+|react-data-grid)/
const MOTION_SOURCES = /^(motion|motion\/react|framer-motion)$/
export const MOTION_HELPER = 'src/hooks/use-reduced-motion.ts'
// 패널 면(누르지 않는 패널 = 안쪽 빛)은 Panel·PanelHTML과 그 CSS에서만 만든다.
const PANEL_CLASS = /(?:^|[\s"'.`])(screen-panel|panel-material|panel-inset)(?=$|[\s"'.`:[>,)])/
const PANEL_HOME = ['src/components/', 'src/app/layout.css', 'src/styles/']
const PANEL_DEPTH_VAR = /var\(\s*--(panel-edge-depth|panel-glass-depth|panel-material-depth|information-panel-shadow)\b/
// 화면 파일은 공용 컴포넌트 인스턴스만 둔다. 맨 태그는 src/components(공용 UI)에서만 쓴다.
const RAW_TAGS = new Set(('a abbr address article aside b blockquote br button canvas caption circle clipPath code col colgroup dd defs details dialog div dl dt em ' +
  'fieldset figcaption figure footer form g h1 h2 h3 h4 h5 h6 header hr i iframe img input kbd label legend li line linearGradient main mark menu nav ' +
  'ol optgroup option output p path pattern polygon polyline pre progress radialGradient rect section select small span stop strong sub summary sup svg ' +
  'table tbody td text textarea tfoot th thead time tr tspan u ul use video').split(' '))
const RAW_TAG_IN_STRING = /<([a-zA-Z][\w]*)(?=[\s/>])/g

// ---------- eslint ----------
const stringValue = node => node.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node.type === 'TemplateElement' ? node.value.raw : undefined
const isModuleSource = node => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.parent?.type)
const jsxName = node => node.name?.type === 'JSXIdentifier' ? node.name.name : undefined
const jsxAttribute = (node, name) => node.attributes.find(attribute => attribute.type === 'JSXAttribute' && attribute.name?.name === name)

function eslintRule(id, build) {
  return {
    meta: { type: 'problem', docs: { description: designRules.find(rule => rule.id === id).title }, schema: [] },
    create(context) {
      const path = rel(context.filename)
      if (!isAppSource(path) || excepted(id, path)) return {}
      const report = (node, message) => context.report({ node, message: `[${id}] ${message}` })
      return build({ path, report, context })
    },
  }
}
/** 문자열·템플릿 조각마다 검사한다(import 경로 제외). */
const onStrings = check => ({
  Literal(node) { if (!isModuleSource(node)) { const value = stringValue(node); if (value !== undefined) check(node, value) } },
  TemplateElement(node) { check(node, node.value.raw) },
})

const eslintRules = {
  // 달력(ui/calendar.tsx)의 주 번호 칸은 react-day-picker 격자라 데이터 표가 아니다.
  'component-table-markup': eslintRule('component/table-markup', ({ path, report }) => ['src/components/ui/table.tsx', 'src/components/ui/calendar.tsx'].includes(path) ? {} : {
    JSXOpeningElement(node) { if (TABLE_TAGS.has(jsxName(node))) report(node, `<${jsxName(node)}> 대신 components/ui/table의 Table 부품을 쓴다.`) },
    ...onStrings((node, value) => { if (/<table\b(?![^>]*data-slot=["']table["'])/i.test(value)) report(node, '문자열 <table>에는 공용 표 규격 data-slot="table"을 붙인다.') }),
  }),
  'component-table-library': eslintRule('component/table-library', ({ report }) => ({
    ImportDeclaration(node) {
      const source = node.source.value
      const antdTable = source === 'antd' && node.specifiers.some(specifier => specifier.imported?.name === 'Table')
      if (antdTable || TABLE_LIBRARIES.test(source)) report(node, `${source}의 표 대신 공용 Table을 쓴다.`)
    },
  })),
  'component-dialog': eslintRule('component/dialog', ({ path, report }) => path.startsWith('src/components/') ? {} : {
    JSXOpeningElement(node) { if (jsxName(node) === 'dialog') report(node, 'components/dialog-parts의 DialogFrame을 쓴다.') },
    ...onStrings((node, value) => { if (/<dialog\b/i.test(value)) report(node, '문자열 <dialog> 대신 components의 GlassDialog를 쓴다.') }),
  }),
  'component-search-input': eslintRule('component/search-input', ({ path, report }) => inside(path, ['src/components/search-field.jsx', 'src/components/ui/']) ? {} : {
    JSXOpeningElement(node) {
      const type = jsxAttribute(node, 'type')
      if (/^(input|Input)$/.test(jsxName(node) ?? '') && type?.value?.value === 'search') report(node, 'components/search-field의 SearchField를 쓴다(목록은 compact).')
    },
    ...onStrings((node, value) => { if (/<input\b[^>]*type=["']search/i.test(value)) report(node, 'SearchField를 쓴다.') }),
  }),
  'component-button': eslintRule('component/button', ({ path, report }) => path.startsWith('src/components/') ? {} : {
    JSXOpeningElement(node) { if (jsxName(node) === 'button') report(node, '<button> 대신 components의 공용 버튼(PrimaryButton·ActionButton·ui/button)을 쓴다.') },
    ...onStrings((node, value) => { if (/<button\b/i.test(value)) report(node, '문자열 <button> 대신 components.js의 Button·IconButton을 쓴다.') }),
  }),
  'component-clickable-element': eslintRule('component/clickable-element', ({ report }) => ({
    JSXOpeningElement(node) {
      if (/^(div|span|li|p|section|article)$/.test(jsxName(node) ?? '') && (jsxAttribute(node, 'onClick') || jsxAttribute(node, 'onMouseDown')))
        report(node, `누르는 <${jsxName(node)}> 대신 button·a를 쓴다.`)
    },
  })),
  'component-panel': eslintRule('component/panel', ({ path, report }) => inside(path, PANEL_HOME) ? {} : {
    JSXOpeningElement(node) {
      if (jsxName(node) !== 'Panel') return
      const value = jsxAttribute(node, 'className')?.value
      const text = value?.type === 'Literal' ? value.value : value?.expression?.type === 'TemplateLiteral' ? value.expression.quasis.map(part => part.value.raw).join(' ') : ''
      if (/(^|\s)glass(\s|$)/.test(String(text))) report(node, 'Panel에 glass를 붙이지 않는다. 누르지 않는 패널은 안쪽 빛 면, 누르는 카드는 RecordCard를 쓴다.')
    },
    ...onStrings((node, value) => { const match = value.match(PANEL_CLASS); if (match) report(node, `${match[1]} 클래스를 직접 쓰지 말고 components/panel의 Panel(문자열 화면은 components.js의 PanelHTML)을 쓴다.`) }),
  }),
  'component-raw-element': eslintRule('component/raw-element', ({ path, report }) => path.startsWith('src/components/') ? {} : {
    JSXOpeningElement(node) {
      const name = node.name.type === 'JSXIdentifier' ? node.name.name : node.name.type === 'JSXMemberExpression' ? `${node.name.object.name}.${node.name.property.name}` : ''
      if (/^[a-z]/.test(name)) report(node, `맨 태그 <${name}> 대신 components의 공용 컴포넌트(Panel·Stack·Grid·Text·Heading 등)를 쓴다.`)
    },
    ...onStrings((node, value) => { for (const match of value.matchAll(RAW_TAG_IN_STRING)) if (RAW_TAGS.has(match[1])) report(node, `문자열 맨 태그 <${match[1]}> 대신 components.js의 공용 부품을 쓴다.`) }),
  }),
  'token-raw-color': eslintRule('token/raw-color', ({ report }) => onStrings((node, value) => {
    for (const match of value.matchAll(COLOR_RE)) report(node, `직접 색 값 ${match[0].trim()} 대신 색 토큰(var(--…))을 쓴다.`)
  })),
  'token-inline-style': eslintRule('token/inline-style', ({ report }) => ({
    JSXAttribute(node) {
      if (node.name?.name !== 'style' || node.parent.type !== 'JSXOpeningElement') return
      const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
      const onlyVariables = expression?.type === 'ObjectExpression' && expression.properties.every(property =>
        property.type === 'Property' && typeof property.key.value === 'string' && property.key.value.startsWith('--'))
      if (!onlyVariables) report(node, '인라인 스타일 대신 CSS 클래스와 토큰을 쓴다(값 전달은 CSS 변수 --*만).')
    },
    AssignmentExpression(node) {
      const target = node.left
      if (target.type === 'MemberExpression' && target.object.type === 'MemberExpression' && target.object.property?.name === 'style')
        report(node, `style.${target.property.name ?? ''} 대신 CSS 클래스·data 속성·CSS 변수(setProperty('--…'))를 쓴다.`)
    },
    CallExpression(node) {
      const callee = node.callee
      const argument = node.arguments[0]
      if (callee.type === 'MemberExpression' && callee.property?.name === 'setProperty' && callee.object.type === 'MemberExpression'
        && callee.object.property?.name === 'style' && !(argument?.type === 'Literal' && String(argument.value).startsWith('--')) && argument?.type !== 'TemplateLiteral')
        report(node, 'style.setProperty는 CSS 변수(--…)에만 쓴다.')
    },
    ...onStrings((node, value) => {
      for (const match of value.matchAll(/\sstyle=["']([^"']*)/g)) if (!/^\s*(--[\w-]+\s*:[^;]*;?\s*)*$/.test(match[1])) report(node, '문자열 style="…" 대신 CSS 클래스를 쓴다(CSS 변수 전달만 허용).')
    }),
  })),
  'token-arbitrary-class': eslintRule('token/arbitrary-class', ({ report }) => onStrings((node, value) => {
    for (const token of value.split(/\s+/)) if (ARBITRARY_CLASS.test(token)) report(node, `Tailwind 임의 값 ${token} 대신 토큰 클래스를 쓴다.`)
  })),
  'font-family': eslintRule('font/family', ({ report }) => ({
    Property(node) {
      const key = node.key.name ?? node.key.value
      if (key !== 'fontFamily' && key !== 'font-family') return
      const value = stringValue(node.value)
      // 계산된 값(getComputedStyle·상수 참조)은 정적으로 알 수 없으므로 글자 그대로 쓴 값만 검사한다.
      if (value !== undefined && !(FONT_VALUE_OK.test(value.trim()) || /^['"]?Pretendard['"]?$/.test(value.trim()))) report(node, '글꼴은 var(--aml-font-family)·inherit만 쓴다.')
    },
    AssignmentExpression(node) {
      if (node.left.type !== 'MemberExpression' || node.left.property?.name !== 'font') return
      const text = node.right.type === 'TemplateLiteral' ? node.right.quasis.map(part => part.value.raw).join('${}') : stringValue(node.right)
      // 캔버스 font 값의 마지막 낱말이 글꼴이다. 대체 글꼴(, sans-serif)·다른 글꼴이면 걸린다.
      const family = text?.trim().split(/\s+/).at(-1)
      if (family && !/^(['"]?Pretendard['"]?|\$\{\}|var\(--[\w-]*font[\w-]*\))$/.test(family)) report(node, `캔버스 글꼴 ${family} 대신 Pretendard 하나만 쓴다.`)
    },
    ...onStrings((node, value) => {
      for (const match of value.matchAll(/font-family\s*:\s*([^;"'`}]+)/g)) if (!FONT_VALUE_OK.test(match[1].trim())) report(node, `font-family: ${match[1].trim()} 대신 var(--aml-font-family)를 쓴다.`)
    }),
  })),
  'chart-library-import': eslintRule('chart/library-import', ({ path, report }) => inside(path, ['src/components/charts/', 'src/components/ui/chart.tsx', 'src/features/graph/']) ? {} : {
    ImportDeclaration(node) { if (CHART_SOURCES.test(node.source.value)) report(node, `${node.source.value}는 components/charts·features/graph의 공용 차트·그래프 부품을 거쳐 쓴다.`) },
    ImportExpression(node) { if (CHART_SOURCES.test(node.source.value ?? '')) report(node, `${node.source.value}는 공용 차트 부품을 거쳐 쓴다.`) },
  }),
  'icon-library': eslintRule('icon/library', ({ report }) => ({
    ImportDeclaration(node) { if (bannedIconPackage(node.source.value)) report(node, `${node.source.value} 대신 lucide-react 아이콘을 쓴다(아이콘 패키지는 lucide-react만).`) },
    ImportExpression(node) { if (typeof node.source.value === 'string' && bannedIconPackage(node.source.value)) report(node, `${node.source.value} 대신 lucide-react 아이콘을 쓴다.`) },
  })),
  'contrast-shape-motion-setting': eslintRule('contrast-shape/motion-setting', ({ path, report }) => path === MOTION_HELPER ? {} : {
    CallExpression(node) {
      const callee = node.callee
      const name = callee.type === 'Identifier' ? callee.name : callee.property?.name
      const argument = node.arguments[0] && (stringValue(node.arguments[0]) ?? node.arguments[0].quasis?.map(part => part.value.raw).join(''))
      if (name === 'matchMedia' && /prefers-reduced-motion/.test(argument ?? '')) report(node, 'prefers-reduced-motion을 직접 읽지 말고 hooks/use-reduced-motion(앱 설정 포함)을 쓴다.')
    },
    ImportDeclaration(node) {
      if (!MOTION_SOURCES.test(node.source.value)) return
      for (const specifier of node.specifiers) if (/^useReducedMotion(Config)?$/.test(specifier.imported?.name ?? ''))
        report(specifier, `motion의 ${specifier.imported.name}는 앱 설정을 모르므로 hooks/use-reduced-motion의 useAppReducedMotion을 쓴다.`)
    },
  }),
  'escape-hatch-disable-comment': eslintRule('escape-hatch/disable-comment', ({ report, context }) => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        const directive = comment.value.trim().match(/^eslint-disable(?:-next-line|-line)?(?:\s+(.*?))?(?:\s+--\s.*)?$/s)
        if (directive && (!directive[1]?.trim() || /\baml\//.test(directive[1]))) report(comment, '디자인 규칙을 끄거나 규칙 이름 없이 eslint-disable을 쓰지 않는다. 예외는 scripts/design-exceptions.json에 둔다.')
        if (/^eslint\s+[^\n]*\baml\//.test(comment.value.trim())) report(comment, '주석으로 디자인 규칙 설정을 바꾸지 않는다.')
      }
    },
  })),
}
export const eslintPlugin = { meta: { name: 'aml-design' }, rules: eslintRules }

// ---------- stylelint ----------
function cssRule(id, walk) {
  const ruleName = pluginRuleName(id)
  const rule = () => (root, result) => {
    const path = rel(root.source?.input?.file ?? '')
    if (!isAppSource(path) || excepted(id, path)) return
    walk({ root, path, report: (node, message) => stylelint.utils.report({ ruleName, result, node, message: `[${id}] ${message} (${ruleName})` }) })
  }
  rule.ruleName = ruleName
  rule.messages = stylelint.utils.ruleMessages(ruleName, {})
  rule.meta = { url: 'scripts/design-rules.mjs' }
  return stylelint.createPlugin(ruleName, rule)
}
const inFontFace = node => { for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === 'atrule' && parent.name === 'font-face') return true; return false }
const inKeyframes = node => { for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return true; return false }
const hasUnit = value => [...value.replace(/var\([^)]*\)/g, '').matchAll(/(?<![\w-])-?(\d*\.?\d+)(px|rem|em)\b/g)].some(match => Number(match[1]) !== 0)
const motionGuard = decl => /data-reduced-motion/.test(decl.parent?.selector ?? '') && /^(animation|transition|scroll-behavior)/.test(decl.prop)

export const stylelintPlugins = [
  cssRule('component/table-css', ({ root, path, report }) => {
    if (inside(path, ['src/components/ui/table.css', 'src/components/table-frame.css'])) return
    root.walkRules(rule => {
      if (inKeyframes(rule)) return
      const selector = rule.selector.replace(/"[^"]*"|'[^']*'/g, match => match.includes('table') ? 'table' : '')
      if (/(^|[\s>+~,(])(table|thead|tbody|tfoot|tr|th|td|caption|colgroup)(?=$|[\s.#:[>+~,)])/.test(selector) || /[.#[][\w="-]*table/i.test(rule.selector))
        report(rule, `표 모양(${rule.selector.slice(0, 60)})은 components/ui/table.css·table-frame.css에만 둔다.`)
    })
  }),
  cssRule('component/panel', ({ root, path, report }) => {
    if (inside(path, PANEL_HOME)) return
    root.walkDecls(decl => {
      if (decl.prop === '--panel-material-depth' || PANEL_DEPTH_VAR.test(decl.value)) report(decl, `${decl.prop}: 패널 깊이(안쪽 빛)는 app/layout.css의 Panel 면에서만 정한다.`)
      else if (/^(-webkit-)?(box-shadow|backdrop-filter)$/.test(decl.prop) && /(screen-panel|panel-material|panel-inset)/.test(decl.parent?.selector ?? ''))
        report(decl, `${decl.prop}: Panel 면의 그림자·유리를 화면 CSS에서 바꾸지 않는다.`)
    })
  }),
  cssRule('token/raw-color', ({ root, path, report }) => root.walkDecls(decl => {
    if (inFontFace(decl) || (isTokenFile(path) && decl.prop.startsWith('--'))) return
    for (const match of decl.value.matchAll(COLOR_RE)) report(decl, `직접 색 값 ${match[0].trim()} 대신 색 토큰을 쓴다.`)
  })),
  cssRule('token/spacing-unit', ({ root, report }) => root.walkDecls(/^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$|^inset(-|$)|^(top|right|bottom|left)$|^scroll-(margin|padding)/, decl => {
    if (hasUnit(decl.value)) report(decl, `${decl.prop}: ${decl.value} 대신 space 토큰을 쓴다.`)
  })),
  cssRule('token/radius-unit', ({ root, report }) => root.walkDecls(/^border(-[a-z]+)*-radius$/, decl => {
    if (hasUnit(decl.value)) report(decl, `${decl.prop}: ${decl.value} 대신 radius 토큰을 쓴다.`)
  })),
  cssRule('token/font-size-unit', ({ root, report }) => root.walkDecls(/^(font-size|font)$/, decl => {
    if (!inFontFace(decl) && hasUnit(decl.value.split('/')[0])) report(decl, `${decl.prop}: ${decl.value} 대신 type 토큰을 쓴다.`)
  })),
  cssRule('token/important', ({ root, report }) => root.walkDecls(decl => {
    if (decl.important && !motionGuard(decl)) report(decl, `${decl.prop}의 !important 대신 선택자 범위를 정리한다.`)
  })),
  cssRule('font/family', ({ root, path, report }) => {
    const fontFile = path === 'src/styles/fonts.css'
    root.walkAtRules('font-face', rule => rule.walkDecls('font-family', decl => {
      if (!fontFile || !/^['"]?Pretendard['"]?$/.test(decl.value.trim())) report(decl, `@font-face ${decl.value}: Pretendard 하나만 src/styles/fonts.css에 둔다.`)
    }))
    root.walkDecls(decl => {
      if (inFontFace(decl)) return
      const value = decl.value.trim()
      if (decl.prop === 'font-family' && !(FONT_VALUE_OK.test(value) || (fontFile && /^['"]?Pretendard['"]?$/.test(value))))
        report(decl, `font-family: ${value} 대신 var(--aml-font-family)·inherit를 쓴다(대체 글꼴 금지).`)
      if (decl.prop === 'font' && !/^(inherit|initial|unset|var\([^()]*\))$/.test(value) && !/\svar\(--[\w-]*font[\w-]*\)$/.test(value))
        report(decl, `font: ${value}의 글꼴은 var(--aml-font-family)로 쓴다.`)
      if (decl.prop.startsWith('--') && /font(-family)?$|^--(font|default)-[\w-]*$/.test(decl.prop) && /,/.test(value) && /pretendard/i.test(value))
        report(decl, `${decl.prop}: ${value} — Pretendard 뒤에 대체 글꼴을 두지 않는다.`)
    })
  }),
  cssRule('escape-hatch/disable-comment', ({ root, report }) => root.walkComments(comment => {
    const directive = comment.text.match(/^stylelint-disable(?:-next-line|-line)?(?:\s+(.*))?$/)
    if (directive && (!directive[1]?.trim() || /\baml\//.test(directive[1]))) report(comment, '디자인 규칙을 끄거나 규칙 이름 없이 stylelint-disable을 쓰지 않는다.')
  })),
]

// ---------- 설정 ----------
/** error 규칙은 늘 켜고, ratchet 규칙은 `pnpm lint:design`(AML_DESIGN_ALL=1)에서만 센다. */
const levelOf = rule => rule.level === 'error' ? 'error' : process.env.AML_DESIGN_ALL ? 'warn' : 'off'
const enginesOf = rule => rule.engine.split('+')
export const designEslintConfig = [{
  files: ['src/**/*.{js,jsx,ts,tsx}'],
  ignores: ['src/test/**', 'src/mocks/**', '**/*.test.*', '**/*.stories.*'],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { aml: eslintPlugin },
  rules: Object.fromEntries(designRules.filter(rule => enginesOf(rule).includes('eslint')).map(rule => [pluginRuleName(rule.id), levelOf(rule)])),
}, ...designRules.filter(rule => rule.errorIn && enginesOf(rule).includes('eslint')).map(rule => ({
  // ratchet 규칙이라도 0건이 된 폴더(errorIn)는 오류로 막는다.
  files: rule.errorIn.map(folder => `${folder}**/*.{js,jsx,ts,tsx}`),
  ignores: ['**/*.test.*', '**/*.stories.*'],
  rules: { [pluginRuleName(rule.id)]: 'error' },
}))]
export const designStylelintRules = Object.fromEntries(designRules.filter(rule => enginesOf(rule).includes('stylelint'))
  .map(rule => [pluginRuleName(rule.id), levelOf(rule) === 'off' ? null : [true, { severity: levelOf(rule) === 'warn' ? 'warning' : 'error' }]]))
