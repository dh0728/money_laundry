// `pnpm lint:design` — 디자인 규칙 트리 보고서: 분류 → 규칙 → 파일:줄.
//   --full         규칙마다 모든 위치를 보인다(기본 5곳)
//   --rule <id>    한 규칙만 (예: token/raw-color)
//   --update       위반이 줄어든 ratchet 규칙의 상한을 현재 개수로 내린다(올리지는 않는다)
//   --json         기계용 출력
// 실패 조건: error 규칙 위반 1건 이상, ratchet 규칙이 상한 초과, 예외 파일 형식 오류·만료.
process.env.AML_DESIGN_ALL = '1'
const { readFileSync, writeFileSync } = await import('node:fs')
const { resolve } = await import('node:path')
const { ESLint } = await import('eslint')
const { default: stylelint } = await import('stylelint')
const { designRuleTree, designRules, pluginRuleName } = await import('./design-rules.mjs')
const { appRoot, rel, exceptions, stylelintPlugins, designStylelintRules } = await import('./design-lint-plugin.mjs')

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const only = args.includes('--rule') ? args[args.indexOf('--rule') + 1] : undefined
const baselinePath = resolve(appRoot, 'scripts/design-baseline.json')
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const byPlugin = new Map(designRules.map(rule => [pluginRuleName(rule.id), rule.id]))
const hits = new Map(designRules.map(rule => [rule.id, []]))

// 주석으로 규칙을 꺼도 세도록 인라인 설정(eslint-disable·stylelint-disable)을 무시한다.
const eslint = new ESLint({ cwd: appRoot, allowInlineConfig: false })
for (const file of await eslint.lintFiles(['src'])) for (const message of file.messages) {
  const id = byPlugin.get(message.ruleId)
  if (id) hits.get(id).push({ file: rel(file.filePath), line: message.line, message: message.message.replace(/^\[[^\]]+\] /, '') })
}
const css = await stylelint.lint({ files: 'src/**/*.css', cwd: appRoot, ignoreDisables: true, config: { plugins: stylelintPlugins, rules: designStylelintRules } })
for (const file of css.results) for (const warning of file.warnings) {
  const id = byPlugin.get(warning.rule)
  if (id) hits.get(id).push({ file: rel(file.source), line: warning.line, message: warning.text.replace(/^\[[^\]]+\] /, '').replace(/ \(aml\/[\w-]+\)$/, '') })
}

const today = new Date().toISOString().slice(0, 10)
const exceptionProblems = exceptions.flatMap((entry, index) => {
  const problems = []
  if (!designRules.some(rule => rule.id === entry.rule)) problems.push(`#${index} 없는 규칙 ${entry.rule}`)
  if (!entry.file || !entry.reason?.trim()) problems.push(`#${index} 파일·이유 누락`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? '')) problems.push(`#${index} 만료일 형식(YYYY-MM-DD) 누락`)
  else if (entry.expires < today) problems.push(`#${index} ${entry.rule} ${entry.file} 만료(${entry.expires})`)
  return problems
})

let failed = exceptionProblems.length > 0
const lowered = []
const tree = designRuleTree.map(category => ({ ...category, rules: category.rules.filter(rule => !only || rule.id === only).map(rule => {
  const list = hits.get(rule.id)
  const counted = !rule.engine.split('+').every(engine => engine === 'test' || engine === 'ci')
  const cap = rule.level === 'ratchet' ? baseline[rule.id] ?? 0 : 0
  const cleared = list.filter(hit => rule.errorIn?.some(folder => hit.file.startsWith(folder)))
  const status = !counted ? 'test' : list.length > cap || cleared.length ? 'fail' : list.length < cap ? 'lower' : 'ok'
  if (status === 'fail') failed = true
  if (status === 'lower') lowered.push(rule.id)
  return { ...rule, count: list.length, cap, status, hits: list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) }
}) })).filter(category => category.rules.length)

if (flag('--update')) {
  const next = { ...baseline }
  for (const category of tree) for (const rule of category.rules) if (rule.level === 'ratchet' && rule.status === 'lower') next[rule.id] = rule.count
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n')
}

if (flag('--json')) console.log(JSON.stringify({ tree, exceptionProblems }, null, 2))
else {
  const mark = { ok: '✓', lower: '↓', fail: '✗', test: '·' }
  let errors = 0, ratcheted = 0
  for (const category of tree) {
    console.log(`\n${category.id} — ${category.title}  (${category.source})`)
    category.rules.forEach((rule, index) => {
      const last = index === category.rules.length - 1
      const branch = last ? '└─' : '├─'
      const count = rule.status === 'test' ? `pnpm test${rule.test ? ` · ${rule.test}` : ''}` : rule.level === 'error' ? `${rule.count}건 (오류)` : `${rule.count}/${rule.cap}건 (상한)`
      if (rule.status !== 'test') rule.level === 'error' ? errors += rule.count : ratcheted += rule.count
      console.log(`${branch} ${mark[rule.status]} ${rule.id}  ${count}  ${rule.title}`)
      const shown = flag('--full') || only ? rule.hits : rule.hits.slice(0, 5)
      for (const hit of shown) console.log(`${last ? '  ' : '│ '}    ${hit.file}:${hit.line}  ${hit.message}`)
      if (shown.length < rule.hits.length) console.log(`${last ? '  ' : '│ '}    … ${rule.hits.length - shown.length}곳 더 (--rule ${rule.id})`)
    })
  }
  for (const problem of exceptionProblems) console.log(`✗ 예외 파일: ${problem}`)
  console.log(`\n오류 규칙 위반 ${errors}건 · 상한 관리 위반 ${ratcheted}건 · 예외 ${exceptions.length}건`)
  if (lowered.length && !flag('--update')) console.log(`↓ 줄어든 규칙: ${lowered.join(', ')} → pnpm lint:design --update로 상한을 내린다.`)
}
process.exitCode = failed ? 1 : 0
