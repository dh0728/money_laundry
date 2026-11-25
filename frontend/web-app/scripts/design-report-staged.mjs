import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const application = 'frontend/web-app'
const appRoot = resolve(import.meta.dirname, '..')
const repository = resolve(appRoot, '../..')
// Resolve the existing dependencies from the snapshot's parent without copying them.
const temporaryRoot = realpathSync(join(appRoot, 'node_modules'))
const snapshot = mkdtempSync(join(temporaryRoot, 'aml-design-'))

try {
  const entries = execFileSync('git', ['ls-files', '-z', '--',
    `${application}/src`, `${application}/scripts`, `${application}/package.json`,
    `${application}/eslint.config.js`, `${application}/stylelint.config.mjs`, `${application}/*.html`,
  ], { cwd: repository })
  execFileSync('git', ['checkout-index', '-z', '--stdin', `--prefix=${snapshot.replaceAll('\\', '/')}/`], {
    cwd: repository, input: entries,
  })
  const stagedApp = join(snapshot, application)
  const result = spawnSync(process.execPath, ['scripts/design-report.mjs'], { cwd: stagedApp, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  if (dirname(realpathSync(snapshot)) === temporaryRoot) rmSync(snapshot, { recursive: true, force: true })
}
