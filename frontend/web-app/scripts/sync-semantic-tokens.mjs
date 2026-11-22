import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const themes = ['light', 'dark', 'solarized-light', 'solarized-dark']
export const accents = ['sky', 'violet', 'pink', 'lime']
export const snapshotPath = resolve(import.meta.dirname, '../src/next/styles/figma-token-snapshot.json')
export const cssPath = resolve(import.meta.dirname, '../src/next/styles/semantic-tokens.css')
const property = name => `--aml-semantic-${name.replaceAll('/', '-')}`

// Resolve each alias in its own collection's mode, including cross-collection Brand aliases.
export function createResolver(snapshot, theme, accent) {
  const variables = new Map(snapshot.variables.map(variable => [variable[0], variable]))
  const mode = collection => {
    if (collection.name === 'Color Semantic') return themes.indexOf(theme)
    if (collection.name === 'Color Brand') return accents.indexOf(accent)
    return collection.modes.findIndex(item => item.modeId === collection.defaultModeId)
  }
  if (!themes.includes(theme) || !accents.includes(accent)) throw new Error(`Unknown appearance: ${theme}/${accent}`)
  function resolveValue(id, stack = []) {
    if (stack.includes(id)) throw new Error(`Alias cycle: ${[...stack, id].join(' -> ')}`)
    const variable = variables.get(id)
    if (!variable) throw new Error(`Missing alias target: ${id}`)
    const collection = snapshot.collections[variable[2]]
    if (!collection) throw new Error(`Missing collection for ${id}`)
    const value = variable[3][mode(collection)]
    if (value === undefined) throw new Error(`Missing mode value: ${variable[1]} (${theme}/${accent})`)
    return typeof value === 'string' && value.startsWith('@') ? resolveValue(value.slice(1), [...stack, id]) : value
  }
  return resolveValue
}

export function colorToCss(value) {
  const match = typeof value === 'string' && value.match(/^(#[0-9a-f]{6})(?:\/(0(?:\.\d+)?|1(?:\.0+)?))?$/i)
  if (!match) throw new Error(`Expected snapshot color, received ${value}`)
  if (match[2] === undefined) return match[1]
  const channels = match[1].slice(1).match(/../g).map(channel => parseInt(channel, 16))
  return `rgb(${channels.join(' ')} / ${match[2]})`
}

// Compatibility names consume exact semantic roles; defaults never borrow hover colors.
export const compatibility = {
  'surface-canvas': 'surface/background/primary',
  'surface-panel': 'surface/background/secondary',
  'surface-raised': 'surface/background/secondary',
  'surface-muted': 'surface/neutral/subtle/default',
  'border-default': 'border/background/secondary',
  'border-subtle': 'border/background/secondary',
  'border-control': 'border/neutral/subtle/default',
  'border-strong': 'border/neutral/base/default',
  'border-focus': 'border/brand/base/default',
  'focus-ring': 'border/brand/base/default',
  'text-primary': 'contents/absolute/inverse',
  'text-secondary': 'contents/neutral/strong/default',
  'text-muted': 'contents/neutral/strong/default',
  'text-disabled': 'contents/disabled',
  'text-inverse': 'contents/absolute/theme',
  'text-on-primary': 'contents/absolute/theme',
  'text-link': 'contents/brand/strong/default',
  'selection-bg': 'surface/neutral/strong/default',
  'selection-fg': 'contents/absolute/theme',
  'action-primary': 'surface/brand/strong/default',
  'action-primary-hover': 'surface/brand/strong/hover',
  'action-primary-pressed': 'surface/brand/strong/pressed',
  'action-secondary': 'surface/neutral/strong/default',
  'action-secondary-hover': 'surface/neutral/strong/hover',
  'action-secondary-pressed': 'surface/neutral/strong/pressed',
  'action-ghost-hover': 'surface/neutral/subtle/hover',
  'action-ghost-pressed': 'surface/neutral/subtle/pressed',
  'action-disabled': 'surface/disabled',
  'data-reference': 'contents/neutral/strong/default',
  // Sidebar shares the panel role; inset areas share the underlying canvas role.
  'surface-sidebar': 'surface/background/secondary',
  'surface-inset': 'surface/background/primary',
  'surface-selected': 'surface/neutral/strong/default',
  'surface-selected-hover': 'surface/neutral/strong/hover',
  'text-on-selected': 'contents/absolute/theme',
  'text-on-accent': 'contents/absolute/theme',
  'text-assistive': 'contents/neutral/strong/default',
  'text-link-hover': 'contents/brand/strong/hover',
  'icon-default': 'contents/absolute/inverse',
  'icon-primary': 'contents/absolute/inverse',
  'icon-muted': 'contents/neutral/strong/default',
  'icon-on-primary': 'contents/absolute/theme',
  'icon-on-accent': 'contents/absolute/theme',
  'icon-on-selected': 'contents/absolute/theme',
  'action-primary-border': 'border/brand/base/default',
  'action-negative': 'surface/status/danger/strong/default',
  'action-negative-hover': 'surface/status/danger/strong/hover',
  'action-negative-pressed': 'surface/status/danger/strong/pressed',
  'action-negative-border': 'border/status/danger/base/default',
  'action-danger': 'surface/status/danger/strong/default',
  'action-danger-hover': 'surface/status/danger/strong/hover',
  'action-danger-pressed': 'surface/status/danger/strong/pressed',
  'action-danger-border': 'border/status/danger/base/default',
  'overlay-scrim': 'surface/scrim',
  'data-grid': 'border/background/secondary',
  // Retained v3 bridge names use current roles, including persistent neutral selection.
  'brand-rest': 'surface/brand/strong/default',
  'brand-hover': 'surface/brand/strong/hover',
  'brand-pressed': 'surface/brand/strong/pressed',
  'brand-border': 'border/brand/base/default',
  'brand-ink': 'contents/absolute/theme',
  'brand-selected': 'surface/neutral/strong/default',
  'brand-selected-hover': 'surface/neutral/strong/hover',
  'brand-selected-ink': 'contents/absolute/theme',
}
for (const [status, role] of Object.entries({ negative: 'danger', caution: 'caution', positive: 'positive', info: 'info', pending: 'pending' })) {
  compatibility[`status-${status}-surface`] = `surface/status/${role}/subtle/default`
  compatibility[`status-${status}-solid`] = `surface/status/${role}/base/default`
  compatibility[`status-${status}-text`] = `contents/status/${role}/strong/default`
  compatibility[`status-${status}-border`] = `border/status/${role}/subtle/default`
}

export function generateCss(snapshot) {
  const semantic = snapshot.variables.filter(variable => snapshot.collections[variable[2]]?.name === 'Color Semantic')
    .sort((a, b) => a[1].localeCompare(b[1], 'en'))
  if (!semantic.length) throw new Error('Color Semantic collection has no variables')
  const names = new Set(semantic.map(variable => variable[1]))
  if (names.size !== semantic.length) throw new Error('Duplicate semantic token names')
  for (const name of Object.values(compatibility)) if (!names.has(name)) throw new Error(`Missing semantic role: ${name}`)
  const blocks = []
  for (const theme of themes) for (const accent of accents) {
    const resolver = createResolver(snapshot, theme, accent)
    const selector = `[data-theme="${theme}"][data-accent="${accent}"]`
    const declarations = semantic.map(([id, name]) => `  ${property(name)}: ${colorToCss(resolver(id))};`)
    declarations.push(...Object.entries(compatibility).map(([name, target]) => `  --aml-${name}: var(${property(target)});`))
    blocks.push(`${theme === 'light' && accent === 'sky' ? ':root,\n' : ''}${selector} {\n${declarations.join('\n')}\n}`)
  }
  return `/* Generated by node scripts/sync-semantic-tokens.mjs; do not edit.
 * Read-only cached source: figma-token-snapshot.json (component-audit-2026-11-17).
 * Figma file: eHgUPAyr9bZ2UC7oTZNmwh. No Figma access or variable mutation.
 * Light/Sky defaults; all 16 theme/accent combinations resolve collection-specific aliases.
 * Legacy tokens.css retains non-color foundations. Default role/state values are preserved.
 * Primary/Danger action fills use strong roles with matching default/hover/pressed states.
 * Base token definitions remain unchanged; no forced white/black compensation is applied.
 */\n${blocks.join('\n\n')}\n`
}

export async function syncSemanticTokens(check = false) {
  const css = generateCss(JSON.parse(await readFile(snapshotPath, 'utf8')))
  if (check) {
    if (await readFile(cssPath, 'utf8') !== css) throw new Error('semantic-tokens.css is stale; run node scripts/sync-semantic-tokens.mjs')
  } else await writeFile(cssPath, css)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncSemanticTokens(process.argv.includes('--check'))
  console.log(process.argv.includes('--check') ? 'Semantic CSS matches the cached snapshot.' : 'Generated semantic CSS from the cached snapshot (offline).')
}
