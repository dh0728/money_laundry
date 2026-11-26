// AML RADAR 디자인 규칙 구현. 규칙 목록·수준은 scripts/design-rules.mjs, 예외는 scripts/design-exceptions.json 한 곳에만 둔다.
// eslint 플러그인(aml/*)과 stylelint 플러그인(aml/*)이 같은 규칙 이름을 쓴다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, relative, resolve, sep } from 'node:path'
import stylelint from 'stylelint'
import { bannedIconPackage, designRules, pluginRuleName } from './design-rules.mjs'
import { dashboardUiCatalog, legacyDashboardUiImports } from '../dashboard-ui-catalog.mjs'

export const appRoot = resolve(import.meta.dirname, '..')
export const rel = file => relative(appRoot, resolve(appRoot, file)).split(sep).join('/')
const NOT_APP = /^src\/(test|mocks)\/|\.(test|stories)\.[cm]?[jt]sx?$/
export const isAppSource = path => path.startsWith('src/') && !NOT_APP.test(path)
/** 토큰 정의 파일. 여기서는 사용자 정의 속성(--*) 값에 실제 값을 둘 수 있다. */
export const isTokenFile = path => /^src\/styles\/[^/]+\.css$/.test(path)
export const exceptionsPath = resolve(appRoot, 'scripts/design-exceptions.json')
export const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8'))
export const baselinePath = resolve(appRoot, 'scripts/design-baseline.json')
export const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const excepted = (ruleId, path) => exceptions.some(entry => entry.rule === ruleId && entry.file === path)
const inside = (path, prefixes) => prefixes.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)
const isDashboard = path => path.startsWith('src/features/dashboard/')
const dashboardDependencies = new Set(['react', 'date-fns', 'lucide-react'])
const nativeControls = new Set(['button', 'input', 'select', 'textarea'])
const nativeControlOwners = new Set([
  'data-table/data-table-column-header.tsx', 'query-controls.jsx', 'search-field.jsx',
  'react-bits/BellToggle.jsx', 'react-bits/BranchedMenu.tsx', 'react-bits/GlideSelect.tsx',
  'react-bits/RubberSegment.tsx', 'react-bits/SpringCheck.tsx', 'react-bits/Stepper.tsx',
  'ui/checkbox.tsx', 'ui/input.tsx', 'ui/radio-group.tsx', 'ui/select.tsx', 'ui/sidebar.tsx', 'ui/textarea.tsx',
].map(file => `src/components/${file}`))
const designTokenName = /^--(?:aml-|palette-)/
const dashboardPaintProperty = /^(?:color|background(?:-color)?|fill|stroke|outline-color|border(?:-[a-z-]+)?-color)$/
const dashboardTokenReference = /var\(\s*--/
const dashboardPaintValue = value => dashboardTokenReference.test(value) || /^(?:inherit|currentcolor|transparent|none)$/i.test(value)

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
/** layout-primitives의 같은 DOM 부품과 기본 태그 */
const PRIMITIVE_TAG = { Box: 'div', Text: 'p', Heading: 'h2' }
/** Box·Text·Stack·Grid의 as로 쓸 수 있는 상자·글자 태그. 누르는 것·입력·표·그림 태그는 각자의 공용 부품을 쓴다. */
const PRIMITIVE_AS = new Set(('div section header footer nav main article aside ul ol li dl dt dd figure figcaption form fieldset legend details ' +
  'summary blockquote label menu address span p strong b i small code time em mark abbr sub sup kbd u pre output').split(' '))
const RAW_TAG_IN_STRING = /<([a-zA-Z][\w]*)(?=[\s/>])/g


// ---------- 숫자·색·변수 공통 ----------
const isScreen = path => !path.startsWith('src/components/') && !path.startsWith('src/styles/')
/** 원시 색 변수: --palette-*, --aml-<색이름>-<숫자> */
const PALETTE_VAR = /var\(\s*--(palette-[\w-]+|aml-(?:gray|sky|pink|lime|red|green|amber|violet|blue|teal|orange|black|white)-\d[\w-]*)/
const TEMPLATE_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[^)]*$/
const VAR_REF = /var\(\s*(--[\w-]+)\s*\)/g
// 런타임·라이브러리가 넣는 변수(Tailwind·Radix·react-day-picker·sonner 등)
const RUNTIME_VAR = /^--(tw-|radix-|rdp-|spacing$|color-|font-|text-|radius-|shadow-|inset-shadow-|drop-shadow-|ease-|animate-|breakpoint-|container-|default-|blur-|perspective-|aspect-|leading-|tracking-|width-|normal-|offset$|initial-|front-|gap$|toast-|sidebar-width|swipe-)/
// 화면 묶음(진입 HTML)마다 불러오는 CSS가 다르다(index·components = preview-design-system, ant-review = theme.css).
// 파일이 속한 모든 묶음에서 정의된 변수만 정의된 것으로 본다. 어느 묶음에도 안 닿는 파일(테스트·main.tsx 쪽)은 src 전체 정의로 본다.
const ENTRY_HTML = ['index.html', 'components.html', 'ant-review.html']
const MODULE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']
const varDefinitions = text => [...text.matchAll(/(--[\w-]+)\s*['"`]?\s*:/g), ...text.matchAll(/['"`](--[\w-]+)['"`]/g)].map(match => match[1])
function resolveModule(from, spec) {
  const clean = spec.replace(/\?.*$/, '')
  const base = clean.startsWith('@/') ? resolve(appRoot, 'src', clean.slice(2)) : clean.startsWith('.') ? resolve(from, '..', clean) : null
  if (!base) return null
  for (const ext of MODULE_EXT) try { if (statSync(base + ext).isFile()) return base + ext } catch { /* 다음 확장자 */ }
  return null
}
let varWorlds
export const invalidateDesignVariableIndex = () => { varWorlds = undefined }
function varWorldSets() {
  if (varWorlds) return varWorlds
  // runtime = JS가 style·setProperty로 넣는 변수('--x' 문자열). 어느 컴포넌트가 넣을지 모르므로 묶음과 상관없이 정의로 본다.
  const all = new Set(), runtime = new Set(), worlds = []
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.(css|[cm]?[jt]sx?)$/.test(entry.name)) {
      const source = readFileSync(file, 'utf8')
      for (const name of varDefinitions(source)) all.add(name)
      if (!entry.name.endsWith('.css')) for (const match of source.matchAll(/['"`](--[\w-]+)['"`]/g)) runtime.add(match[1])
    }
  } }
  walk(resolve(appRoot, 'src'))
  for (const html of ENTRY_HTML) {
    const files = new Set(), defined = new Set()
    let page = ''
    try { page = readFileSync(resolve(appRoot, html), 'utf8') } catch { continue }
    for (const name of varDefinitions(page)) { defined.add(name); all.add(name) }
    const visit = file => {
      if (!file || files.has(file)) return
      files.add(file)
      const source = readFileSync(file, 'utf8')
      for (const name of varDefinitions(source)) defined.add(name)
      const specs = file.endsWith('.css')
        ? [...source.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)].map(match => match[1])
        : [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map(match => match[1])
      for (const spec of specs) visit(resolveModule(file, spec))
    }
    for (const match of page.matchAll(/(?:src|href)="\/(src\/[^"]+)"/g)) visit(resolveModule(resolve(appRoot, 'index.html'), `./${match[1]}`))
    worlds.push({ files, defined })
  }
  varWorlds = { all, runtime, worlds }
  return varWorlds
}
const undefinedVars = (text, path) => {
  const { all, runtime, worlds } = varWorldSets()
  const file = resolve(appRoot, path)
  const mine = worlds.filter(world => world.files.has(file))
  const defined = name => runtime.has(name) || (mine.length ? mine.every(world => world.defined.has(name)) : all.has(name))
  return [...new Set([...text.matchAll(VAR_REF)].map(match => match[1]))].filter(name => !RUNTIME_VAR.test(name) && !defined(name))
}

/** 채우기·맞추기 값(0·100%·50%·100vh 등)과 배치 숫자를 뺀 고정 숫자 목록 */
const LAYOUT_PROP = /^(flex|flex-grow|flex-shrink|order|grid-(column|row|area)(-start|-end)?|-webkit-line-clamp|line-clamp|font-variant[\w-]*|font-feature-settings|content|counter-(reset|increment|set)|will-change|tab-size)$/
const UNIT_NUMBER = /(?<![\w#.-])(-?(?:\d*\.\d+|\d+))(px|rem|em|ms|s|%|vh|vw|vmin|vmax|dvh|svh|lvh|dvw|svw|deg|turn|rad|cqi|cqw|cqh|cqb|ch|ex|lh|fr)?(?![\w.(])/g
function fixedNumbers(prop, value) {
  if (LAYOUT_PROP.test(prop)) return []
  let text = value
  for (let before; before !== text;) { before = text; text = text.replace(/var\(\s*--[\w-]+\s*\)/g, 'V') }
  text = text.replace(/var\(\s*--[\w-]+\s*,/g, '(').replace(/url\([^)]*\)/g, '').replace(/(['"])[^'"]*\1/g, '')
    .replace(/#[\da-fA-F]{3,8}\b/g, '').replace(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)/g, '')
  return [...text.matchAll(UNIT_NUMBER)].filter(match => {
    const [whole, number, unit = ''] = match
    const before = text.slice(0, match.index)
    if (Number(number) === 0 || unit === 'fr') return false
    if (/^(100|50|-50)$/.test(number) && /^(%|vh|vw|dvh|svh|lvh|dvw|svw)$/.test(unit)) return false
    if (!unit && /repeat\(\s*$/.test(before)) return false
    // calc 안의 배수(2 * var(--…))는 토큰에서 나온 값이다.
    if (!unit && (/[*/]\s*$/.test(before) || /^\)?\s*[*/]/.test(text.slice(match.index + whole.length)))) return false
    if (!unit && /^-?1$/.test(number) && /^(opacity|fill-opacity|stroke-opacity|scale|line-height|flex|aspect-ratio|animation-iteration-count)$/.test(prop)) return false
    if (!unit && /^-?1$/.test(number) && /(scale[XYZ3d]*|matrix|invert|brightness|saturate|contrast|grayscale|sepia|opacity)\(\s*$/.test(before)) return false
    return Boolean(whole)
  }).map(match => match[0])
}
// JSX 크기·모양 prop과 객체 속성(차트·도형·style)
const VISUAL_PROP = /^(width|height|minWidth|maxWidth|minHeight|maxHeight|size|iconSize|dotSize|strokeWidth|fontSize|fontWeight|lineHeight|letterSpacing|opacity|fillOpacity|strokeOpacity|zIndex|radius|cornerRadius|barRadius|barSize|maxBarSize|barGap|barCategoryGap|tickMargin|tickSize|innerRadius|outerRadius|paddingAngle|r|rx|ry|strokeDasharray|duration|delay|animationDuration|animationBegin|gap|rowGap|columnGap|margin|marginTop|marginBottom|marginLeft|marginRight|padding|paddingTop|paddingBottom|paddingLeft|paddingRight|top|left|right|bottom|inset|borderRadius|borderWidth|plotHeight|lineWidth|nodeWidth|nodePadding|blur|shadowBlur)$/
const OBJECT_SKIP = /^(size|top|left|right|bottom|duration|delay)$/
const numericLiteral = node => node && ((node.type === 'Literal' && typeof node.value === 'number') ||
  (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number'))
const literalNumber = node => node.type === 'UnaryExpression' ? -node.argument.value : node.value
const numericString = value => typeof value === 'string' && /^\s*-?(\d*\.\d+|\d+)(px|rem|em|ms|s|%|vh|vw|deg)?\s*$/.test(value)
const fillValue = (value, key = '') => /^\s*(0+(\.0+)?|100%|-?50%)\s*$/.test(String(value)) || (/^\s*1\s*$/.test(String(value)) && /opacity|Opacity/.test(key))
const STRING_UNIT = /(?<![\w#.[-])-?(?:\d*\.\d+|\d+)(px|rem|em|ms|vh|vw|deg)\b/g
const hasStringUnit = value => [...String(value).matchAll(STRING_UNIT)].some(match => Number.parseFloat(match[0]) !== 0)
// 데이터 계열 색
const GRAY_COLOR = /var\(\s*--(muted-foreground|muted-text|muted|chart-total|chart-neutral|chart-[12]|palette-neutral[\w-]*|aml-gray-[\w-]+|neutral[\w-]*|gray[\w-]*)\s*\)/
const STATUS_COLOR = /var\(\s*--(status-[\w-]+|aml-status-[\w-]+|risk-[\w-]+|review-status-[\w-]+|chart-(suspect|completion|arrival|risk)[\w-]*|destructive)\s*\)/
const STATUS_WORDS = /대기|진행|완료|종결|세탁|패턴|지연|위험|주의|정상|이상|오류|실패|성공|미확인|확인|처리|판정|경고|의심|높음|중간|낮음|pending|progress|working|done|closed|danger|caution|positive|negative|info|high|medium|low|risk|warn|error|fail|success|unread|abnormal|normal|suspect/i

// ---------- eslint ----------
const stringValue = node => node.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node.type === 'TemplateElement' ? node.value.raw : undefined
const isModuleSource = node => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.parent?.type)
const jsxName = node => node.name?.type === 'JSXIdentifier' ? node.name.name : undefined
const jsxAttribute = (node, name) => node.attributes.find(attribute => attribute.type === 'JSXAttribute' && attribute.name?.name === name)

const typeOnlyExpressions = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'])

function isCssVariableStyle(node, sourceCode) {
  while (typeOnlyExpressions.has(node?.type)) node = node.expression
  if (node?.type === 'ConditionalExpression') {
    return isCssVariableStyle(node.consequent, sourceCode) && isCssVariableStyle(node.alternate, sourceCode)
  }
  if (node?.type === 'Literal' && node.value === null) return true
  if (node?.type === 'Identifier' && node.name === 'undefined') {
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
      const binding = scope.set.get(node.name)
      if (binding) return binding.defs.length === 0
    }
    return true
  }
  return node?.type === 'ObjectExpression' && node.properties.every(property =>
    property.type === 'Property' && typeof property.key.value === 'string' && property.key.value.startsWith('--'))
}

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
      // Box·Text·Heading은 as 태그를 그대로 그리므로 그 태그로 본다.
      const primitive = PRIMITIVE_TAG[jsxName(node)]
      const as = jsxAttribute(node, 'as')?.value
      const tag = primitive ? (as?.type === 'Literal' ? as.value : primitive) : jsxName(node)
      if (/^(div|span|li|p|section|article|h[1-6])$/.test(tag ?? '') && (jsxAttribute(node, 'onClick') || jsxAttribute(node, 'onMouseDown')))
        report(node, `누르는 <${tag}> 대신 button·a를 쓴다.`)
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
      const as = /^(Box|Text|Stack|Grid)$/.test(name) ? jsxAttribute(node, 'as')?.value : undefined
      if (as && !(as.type === 'Literal' && PRIMITIVE_AS.has(as.value)))
        report(node, `<${name} as=…>는 상자·글자 태그만 받는다. 버튼·입력·표·그림은 각자의 공용 부품을 쓴다.`)
    },
    ...onStrings((node, value) => { for (const match of value.matchAll(RAW_TAG_IN_STRING)) if (RAW_TAGS.has(match[1])) report(node, `문자열 맨 태그 <${match[1]}> 대신 components.js의 공용 부품을 쓴다.`) }),
  }),
  'component-dashboard-ui-source': eslintRule('component/dashboard-ui-source', ({ path, report }) => {
    if (!isDashboard(path)) return {}
    const checkModule = node => {
      if (node.importKind === 'type' || node.exportKind === 'type' ||
        (node.specifiers?.length && node.specifiers.every(specifier => specifier.importKind === 'type' || specifier.exportKind === 'type'))) return
      const source = node.source?.value
      if (typeof source === 'string') {
        if (dashboardDependencies.has(source)) return
        const clean = source.replace(/\?.*$/, '')
        const local = clean.startsWith('@/') ? posix.normalize(`src/${clean.slice(2)}`) :
          /^\.\.?\//.test(clean) ? posix.join(posix.dirname(path), clean) : null
        if (local?.startsWith('src/')) {
          if (!local.startsWith('src/components/')) return
          const module = local.slice('src/components/'.length).replace(/\.[cm]?[jt]sx?$/, '')
          if (module === 'ui/table' && (node.type !== 'ImportDeclaration' || node.specifiers.some(specifier =>
            specifier.type !== 'ImportSpecifier' || (specifier.imported.name ?? specifier.imported.value) === 'Table'))) {
            report(node, '화면에 보이는 표는 WorkflowTable, 스크린 리더용 차트 표는 AccessibleChartTable을 쓴다.')
            return
          }
          if (dashboardUiCatalog.has(module) || legacyDashboardUiImports.get(path) === module) return
          report(node, '승인된 공용 컴포넌트만 사용한다. 선택은 GlideSelect, 버튼은 ActionButton을 먼저 확인한다.')
          return
        }
      }
      report(node, '대시보드의 UI는 저장소의 공용 컴포넌트에서 가져온다(동적 import도 정해진 경로만 허용).')
    }
    return {
      ImportDeclaration: checkModule,
      ImportExpression: checkModule,
      ExportAllDeclaration: checkModule,
      ExportNamedDeclaration(node) { if (node.source) checkModule(node) },
      JSXAttribute(node) { if (node.name.name === 'dangerouslySetInnerHTML') report(node, '원시 HTML 대신 공용 컴포넌트를 쓴다.') },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') report(node, '대시보드는 검사 가능한 import로 의존성을 불러온다.')
      },
    }
  }),
  'component-control-owner': eslintRule('component/control-owner', ({ path, report }) => {
    if (!path.startsWith('src/components/') || nativeControlOwners.has(path)) return {}
    return {
      JSXOpeningElement(node) {
        if (nativeControls.has(node.name.name))
          report(node, '공용 폴더에서도 새 기본 컨트롤을 복제하지 않는다. ActionButton, SearchField, GlideSelect 등 기존 부품을 사용한다.')
      },
    }
  }),
  'token-dashboard-usage': eslintRule('token/dashboard-usage', ({ path, report }) => !isDashboard(path) ? {} : {
    Property(node) {
      const name = node.key.value ?? node.key.name
      if (designTokenName.test(name)) report(node, `${name}은 공용 토큰이므로 대시보드에서 다시 정의하지 않는다.`)
    },
    CallExpression(node) {
      const member = node.callee
      const name = node.arguments[0]?.value
      if (member.type === 'MemberExpression' && /^(setProperty|removeProperty)$/.test(member.property.name ?? member.property.value) && designTokenName.test(name))
        report(node, `${name}은 공용 토큰이므로 대시보드에서 변경하지 않는다.`)
    },
    JSXAttribute(node) {
      const value = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
      if (dashboardPaintProperty.test(node.name.name) && value?.type === 'Literal' && typeof value.value === 'string' && !dashboardPaintValue(value.value.trim()))
        report(node, `${node.name.name}에 직접 색상 대신 디자인 토큰을 쓴다.`)
    },
  }),
  'token-raw-color': eslintRule('token/raw-color', ({ report }) => onStrings((node, value) => {
    for (const match of value.matchAll(COLOR_RE)) report(node, `직접 색 값 ${match[0].trim()} 대신 색 토큰(var(--…))을 쓴다.`)
    // 템플릿으로 계산한 색: `hsl(${…} 65% 55%)`
    if (node.type === 'TemplateElement' && !node.tail && TEMPLATE_COLOR.test(value)) report(node, `계산한 색 ${value.match(TEMPLATE_COLOR)[0].trim()}… 대신 색 토큰을 쓴다.`)
  })),
  'token-inline-style': eslintRule('token/inline-style', ({ report, context }) => ({
    JSXAttribute(node) {
      if (node.name?.name !== 'style' || node.parent.type !== 'JSXOpeningElement') return
      const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
      if (!isCssVariableStyle(expression, context.sourceCode)) report(node, '인라인 스타일 대신 CSS 클래스와 토큰을 쓴다(값 전달은 CSS 변수 --*만).')
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

  'token-fixed-number': eslintRule('token/fixed-number', ({ report }) => ({
    JSXAttribute(node) {
      const name = node.name?.name
      if (typeof name !== 'string' || !VISUAL_PROP.test(name)) return
      const value = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
      if (numericLiteral(value) && !fillValue(literalNumber(value), name)) report(node, `${name}={${literalNumber(value)}} 대신 크기·모양 토큰을 쓴다.`)
      else if (value?.type === 'Literal' && numericString(value.value) && !fillValue(value.value, name)) report(node, `${name}="${value.value}" 대신 크기·모양 토큰을 쓴다.`)
    },
    Property(node) {
      const key = node.key?.name ?? node.key?.value
      if (typeof key !== 'string' || !VISUAL_PROP.test(key) || OBJECT_SKIP.test(key) && node.parent.parent?.type !== 'JSXExpressionContainer') return
      if (numericLiteral(node.value) && !fillValue(literalNumber(node.value), key)) report(node, `${key}: ${literalNumber(node.value)} 대신 크기·모양 토큰을 쓴다.`)
      else if (node.value.type === 'Literal' && numericString(node.value.value) && !fillValue(node.value.value, key)) report(node, `${key}: '${node.value.value}' 대신 크기·모양 토큰을 쓴다.`)
    },
    ...onStrings((node, value) => {
      if (/\[/.test(value) || node.parent?.type === 'Property' && numericString(value) || node.parent?.type === 'JSXAttribute') return
      for (const match of value.matchAll(STRING_UNIT)) if (Number.parseFloat(match[0]) !== 0) { report(node, `문자열 고정 숫자 ${match[0]} 대신 토큰(var(--…))을 쓴다.`); break }
    }),
  })),
  'token-inline-var-number': eslintRule('token/inline-var-number', ({ report }) => ({
    JSXAttribute(node) {
      if (node.name?.name !== 'style' || node.value?.type !== 'JSXExpressionContainer' || node.value.expression.type !== 'ObjectExpression') return
      for (const property of node.value.expression.properties) {
        const key = property.key?.value
        if (property.type !== 'Property' || typeof key !== 'string' || !key.startsWith('--')) continue
        const value = property.value
        if (numericLiteral(value) || value.type === 'Literal' && (numericString(value.value) || hasStringUnit(value.value)))
          report(property, `${key}에 숫자 대신 토큰(var(--…))을 넘긴다.`)
      }
    },
    CallExpression(node) {
      const callee = node.callee
      const [name, value] = node.arguments
      if (callee.type === 'MemberExpression' && callee.property?.name === 'setProperty' && name?.type === 'Literal' && String(name.value).startsWith('--')
        && (numericLiteral(value) || value?.type === 'Literal' && numericString(value.value) && !fillValue(value.value)))
        report(node, `setProperty('${name.value}')에 숫자 대신 토큰을 넘긴다.`)
    },
  })),
  'token-palette-direct': eslintRule('token/palette-direct', ({ path, report }) => !isScreen(path) ? {} : onStrings((node, value) => {
    const match = value.match(PALETTE_VAR)
    if (match) report(node, `원시 색 --${match[1]} 대신 의미 토큰이나 공용 계열 색(components/charts의 dataSeriesColors)을 쓴다.`)
  })),
  'token-series-color': eslintRule('token/series-color', ({ report }) => {
    const text = node => !node ? undefined : stringValue(node) ?? (node.type === 'TemplateLiteral' ? node.quasis.map(part => part.value.raw).join('…') : undefined)
    const namedSeries = new Map([
      ['전체 거래', 'transactionTotalColor'],
      ['새 계좌', 'dataSeriesColors.teal'],
      ['새 소유주', 'dataSeriesColors.pink'],
      ['생성 Alert', 'caseCreatedSeriesColor'],
      ['생성 Episode', 'caseCreatedSeriesColor'],
    ])
    const reference = node => {
      if (node.type === 'Identifier') return node.name
      if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier') {
        return `${node.object.name}.${node.property.name}`
      }
    }
    return {
      ObjectExpression(node) {
        const props = new Map(node.properties.filter(property => property.type === 'Property').map(property => [property.key?.name ?? property.key?.value, property]))
        const label = ['label', 'name', 'key', 'dataKey'].map(key => props.get(key)).find(Boolean)
        if (!label) return
        const labelName = text(label.value)
        const expectedColor = namedSeries.get(labelName)
        for (const key of ['color', 'fill', 'stroke']) {
          const property = props.get(key)
          if (property && expectedColor) {
            if (reference(property.value) !== expectedColor) report(property, `${labelName} 계열에는 ${expectedColor}를 쓴다.`)
            continue
          }
          const color = property && text(property.value)
          if (!color) continue
          if (GRAY_COLOR.test(color)) report(property, `데이터 계열 ${text(label.value) ?? ''}에 회색(${color.match(GRAY_COLOR)[0]}) 대신 계열 색을 쓴다.`)
          else if (STATUS_COLOR.test(color)) {
            const labelText = ['label', 'name', 'key'].map(name => text(props.get(name)?.value)).filter(Boolean).join(' ')
            if (labelText && !STATUS_WORDS.test(labelText)) report(property, `상태가 아닌 계열 ${labelText}에 상태 색(${color.match(STATUS_COLOR)[0]})을 쓰지 않는다.`)
          }
        }
      },
      JSXOpeningElement(node) {
        if (!/^(Bar|Line|Area|Cell|Pie|Scatter|Radar|Sparkline|AreaChart|BarChart|LineChart)$/.test(jsxName(node) ?? '')) return
        for (const key of ['color', 'fill', 'stroke']) {
          const attribute = jsxAttribute(node, key)
          const value = attribute?.value?.type === 'Literal' ? attribute.value.value : attribute?.value?.expression ? text(attribute.value.expression) : undefined
          if (value && GRAY_COLOR.test(value)) report(attribute, `차트 계열에 회색(${value.match(GRAY_COLOR)[0]}) 대신 계열 색을 쓴다.`)
        }
      },
    }
  }),
  'token-undefined-var': eslintRule('token/undefined-var', ({ path, report }) => onStrings((node, value) => {
    for (const name of undefinedVars(value, path)) report(node, `정의 없는 변수 ${name}. 이 화면 묶음(진입점)이 불러오는 토큰·CSS에 있는 변수를 쓴다.`)
  })),
  'component-dom-api': eslintRule('component/dom-api', ({ path, report }) => path.startsWith('src/components/') ? {} : {
    CallExpression(node) {
      const callee = node.callee
      const name = callee.type === 'Identifier' ? callee.name : callee.property?.name
      const tag = node.arguments[0]
      if (/^(createElement|createElementNS)$/.test(name ?? '') && tag?.type === 'Literal' && typeof tag.value === 'string' && /^[a-z]/.test(tag.value))
        report(node, `${name}('${tag.value}') 대신 공용 컴포넌트를 쓴다.`)
      if (name === 'insertAdjacentHTML') report(node, 'insertAdjacentHTML 대신 공용 컴포넌트를 쓴다.')
    },
    AssignmentExpression(node) {
      if (node.left.type === 'MemberExpression' && /^(innerHTML|outerHTML)$/.test(node.left.property?.name ?? '')) report(node, `${node.left.property.name} 대신 공용 컴포넌트를 쓴다.`)
    },
  }),
  'component-form-control': eslintRule('component/form-control', ({ path, report }) => path.startsWith('src/components/') ? {} : {
    JSXOpeningElement(node) { if (/^(input|select|textarea)$/.test(jsxName(node) ?? '')) report(node, `<${jsxName(node)}> 대신 공용 입력 부품(components/ui·query-controls·search-field)을 쓴다.`) },
    ...onStrings((node, value) => { const match = value.match(/<(input|select|textarea)\b/); if (match) report(node, `문자열 <${match[1]}> 대신 공용 입력 부품을 쓴다.`) }),
  }),
  'icon-local-svg': eslintRule('icon/local-svg', ({ report }) => ({
    ImportDeclaration(node) { if (/\.svg(\?.*)?$/.test(node.source.value)) report(node, `${node.source.value} 대신 lucide-react 아이콘을 쓴다.`) },
    ImportExpression(node) { if (/\.svg(\?.*)?$/.test(node.source.value ?? '')) report(node, 'SVG 파일 대신 lucide-react 아이콘을 쓴다.') },
    ...onStrings((node, value) => { if (/url\([^)]*\.svg|^[./@\w-]*\/[\w-]+\.svg$/.test(value)) report(node, 'SVG 파일 대신 lucide-react 아이콘을 쓴다.') }),
  })),
  'escape-hatch-any-disable': eslintRule('escape-hatch/any-disable', ({ report, context }) => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments())
        if (/^eslint-disable(-next-line|-line)?\b/.test(comment.value.trim())) report(comment, 'eslint-disable 대신 코드를 고친다.')
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
const tableElementSelector = /(^|[\s>+~,(])(table|thead|tbody|tfoot|tr|th|td|caption|colgroup)(?=$|[\s.#:[>+~,)])/
const tableName = /(?:^|[-_])(?:data)?tables?(?:[-_]|$)/i
const camelCaseTableName = /(?:^|[a-z\d])Tables?(?:[A-Z_-]|$)/

export const stylelintPlugins = [
  cssRule('component/table-css', ({ root, path, report }) => {
    if (inside(path, ['src/components/ui/table.css', 'src/components/table-frame.css'])) return
    root.walkRules(rule => {
      if (inKeyframes(rule)) return
      const elementSelector = rule.selector.replace(/"[^"]*"|'[^']*'/g, '')
      const names = rule.selector.match(/[\w-]+/g) ?? []
      if (tableElementSelector.test(elementSelector) || names.some(name => tableName.test(name) || camelCaseTableName.test(name)))
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
  cssRule('token/fixed-number', ({ root, path, report }) => root.walkDecls(decl => {
    if (inFontFace(decl) || (isTokenFile(path) && decl.prop.startsWith('--'))) return
    // 간격·모서리·글자 크기의 px·rem·em은 각자의 규칙이 센다.
    if (/^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$|^inset(-|$)|^(top|right|bottom|left)$|^scroll-(margin|padding)|^border(-[a-z]+)*-radius$|^(font-size|font)$/.test(decl.prop) && hasUnit(decl.value)) return
    const numbers = fixedNumbers(decl.prop, decl.value)
    if (numbers.length) report(decl, `${decl.prop}: ${numbers.slice(0, 3).join(' ')} 고정 숫자 대신 토큰(var(--…))을 쓴다.`)
  })),
  cssRule('token/palette-direct', ({ root, path, report }) => isScreen(path) ? root.walkDecls(decl => {
    const match = decl.value.match(PALETTE_VAR)
    if (match) report(decl, `${decl.prop}: 원시 색 --${match[1]} 대신 의미 토큰을 쓴다.`)
  }) : undefined),
  cssRule('token/undefined-var', ({ root, path, report }) => {
    const localDefinitions = new Set()
    root.walkDecls(/^--/, declaration => { localDefinitions.add(declaration.prop) })
    root.walkDecls(decl => {
      for (const name of undefinedVars(decl.value, path)) {
        if (!localDefinitions.has(name)) report(decl, `${decl.prop}: 정의 없는 변수 ${name}`)
      }
    })
  }),
  cssRule('token/dashboard-usage', ({ root, path, report }) => {
    if (!isDashboard(path)) return
    root.walkAtRules('property', rule => {
      if (designTokenName.test(rule.params.trim())) report(rule, `${rule.params}은 공용 토큰이므로 대시보드에서 다시 정의하지 않는다.`)
    })
    root.walkDecls(decl => {
      const value = decl.value.trim()
      if (designTokenName.test(decl.prop)) report(decl, `${decl.prop}은 공용 토큰이므로 대시보드에서 다시 정의하지 않는다.`)
      else if (decl.prop === 'font-size' && value !== 'inherit' && !dashboardTokenReference.test(value)) report(decl, '대시보드 글자 크기는 타입 토큰을 쓴다.')
      else if (dashboardPaintProperty.test(decl.prop) && !dashboardPaintValue(value)) report(decl, `${decl.prop}에 직접 색상 대신 디자인 토큰을 쓴다.`)
    })
  }),
  cssRule('icon/local-svg', ({ root, report }) => root.walkDecls(decl => {
    if (/url\([^)]*\.svg/.test(decl.value)) report(decl, `${decl.prop}: SVG 파일 대신 lucide-react 아이콘을 쓴다.`)
  })),
  cssRule('escape-hatch/disable-comment', ({ root, report }) => root.walkComments(comment => {
    const directive = comment.text.match(/^stylelint-disable(?:-next-line|-line)?(?:\s+(.*))?$/)
    if (directive && (!directive[1]?.trim() || /\baml\//.test(directive[1]))) report(comment, '디자인 규칙을 끄거나 규칙 이름 없이 stylelint-disable을 쓰지 않는다.')
  })),
]

// ---------- 설정 ----------
/** 일반 편집기 검사에서도 위반을 표시하고, 0건에 도달한 규칙은 오류로 막는다. */
const levelOf = rule => rule.level === 'error' || baseline[rule.id] === 0 ? 'error' : 'warn'
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
  .map(rule => [pluginRuleName(rule.id), [true, { severity: levelOf(rule) === 'warn' ? 'warning' : 'error' }]]))
