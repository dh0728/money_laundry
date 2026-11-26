import { statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ESLint } from 'eslint'
import type Stylelint from 'stylelint'
import type { Plugin } from 'vite'

type Diagnostic = { line?: number; column?: number; message: string }
type LintEngines = {
  eslint: ESLint
  stylelint: typeof Stylelint
  design: {
    stylelintPlugins: Stylelint.Plugin[]
    designStylelintRules: NonNullable<Stylelint.Config['rules']>
    invalidateDesignVariableIndex(): void
  }
}

export function designDevGate(): Plugin {
  const checked = new Map<string, { code: string; result: Promise<Diagnostic[]> }>()
  const variableSources = new Map<string, string>()
  const updated = new Set<string>()
  let root: string
  let engines: Promise<LintEngines> | undefined

  const sourcePath = (file: string) => relative(root, file).replaceAll('\\', '/')
  const isDashboard = (file: string) => sourcePath(file).startsWith('src/features/dashboard/')
  const isGuarded = (file: string) => {
    const path = sourcePath(file)
    return /^src\/.+\.(?:[jt]sx?|css)$/.test(path) &&
      !/^src\/(?:test|mocks)\/|\.(?:test|stories)\.[jt]sx?$/.test(path)
  }
  const format = (file: string, diagnostics: Diagnostic[]) => diagnostics.map(({ line, column, message }) =>
    `${sourcePath(file)}:${line ?? 1}:${column ?? 1} ${message}`).join('\n')

  const designModuleUrl = () => {
    const file = join(root, 'scripts/design-lint-plugin.mjs')
    const url = pathToFileURL(file)
    url.searchParams.set('version', String(statSync(file).mtimeMs))
    return url.href
  }

  const load = () => engines ??= Promise.all([
    import('eslint'),
    import('stylelint'),
    import(designModuleUrl()),
  ]).then(([{ ESLint }, { default: stylelint }, design]) => ({
    eslint: new ESLint({ cwd: root, allowInlineConfig: false }), stylelint, design,
  }))

  const check = (file: string, code: string) => {
    const last = checked.get(file)
    if (last?.code === code) return last.result
    const result = load().then(async ({ eslint, stylelint, design }) => {
      if (!file.endsWith('.css')) {
        const [output] = await eslint.lintText(code, { filePath: file })
        return output.messages.filter(item => item.fatal || item.ruleId?.startsWith('aml/'))
      }
      const lintCss = async () => {
        const output = await stylelint.lint({ code, codeFilename: file, cwd: root, ignoreDisables: true,
          config: { plugins: design.stylelintPlugins, rules: design.designStylelintRules } })
        return output.results.flatMap(item => item.warnings)
      }
      let warnings = await lintCss()
      if (warnings.some(warning => warning.rule === 'aml/token-undefined-var')) {
        // A stylesheet can be requested before the token file's save event is handled.
        design.invalidateDesignVariableIndex()
        warnings = await lintCss()
      }
      return warnings.map(({ line, column, text }) => ({ line, column, message: text }))
    })
    checked.set(file, { code, result })
    return result
  }

  const variableSignature = (code: string) => [...code.matchAll(/--[\w-]+\s*['"`]?\s*:|['"`]--[\w-]+['"`]|(?:from\s*|import\s*\(?\s*|@import\s+(?:url\()?)["'][^"']+["']/g)]
    .map(match => match[0]).join('\n')

  return {
    name: 'aml-design-dev-gate',
    apply: (_, { command, mode }) => command === 'serve' && mode !== 'test',
    enforce: 'pre',
    configResolved(config) { root = config.root },
    async transform(code, id) {
      if (id.includes('?') || !isGuarded(id)) return
      if (!variableSources.has(id)) variableSources.set(id, variableSignature(code))
      if (!isDashboard(id) && !updated.has(id)) return
      const diagnostics = await check(id, code)
      if (diagnostics.length) this.error(format(id, diagnostics))
    },
    hotUpdate: {
      order: 'pre',
      async handler({ type, file, read }) {
        if (this.environment.name !== 'client' || !isGuarded(file)) return
        try {
          updated.add(file)
          const code = type === 'delete' ? undefined : await read()
          const signature = code === undefined ? undefined : variableSignature(code)
          if (type !== 'update' || variableSources.get(file) !== signature) {
            if (signature === undefined) variableSources.delete(file)
            else variableSources.set(file, signature)
            checked.clear()
            const { design } = await load()
            design.invalidateDesignVariableIndex()
          }
          if (code === undefined) return
          const diagnostics = await check(file, code)
          if (diagnostics.length === 0) return
          this.warn(format(file, diagnostics))
          return []
        } catch (error) {
          engines = undefined
          checked.delete(file)
          variableSources.delete(file)
          this.warn(`${sourcePath(file)}: 디자인 검사를 마치지 못해 이전 화면을 유지합니다. ${String(error)}`)
          return []
        }
      },
    },
  }
}
