import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { accents, colorToCss, compatibility, createResolver, cssPath, generateCss, snapshotPath, themes } from './sync-semantic-tokens.mjs'

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
const colorCollections = [
  { name: 'Color Semantic', defaultModeId: 'light', modes: [{ modeId: 'light' }, { modeId: 'dark' }, { modeId: 'sl' }, { modeId: 'sd' }] },
  { name: 'Color Brand', defaultModeId: 'sky', modes: [{ modeId: 'sky' }, { modeId: 'violet' }, { modeId: 'pink' }, { modeId: 'lime' }] },
  { name: 'Color Primitives', defaultModeId: 'value', modes: [{ modeId: 'value' }] },
]

describe('offline semantic token aliases', () => {
  it('resolves cross-collection aliases with independent theme and accent modes', () => {
    const fixture = { collections: colorCollections, variables: [
      ['semantic', 'surface/brand/base/default', 0, ['@brand', '@brand', '@brand', '@brand']],
      ['brand', 'base', 1, ['@sky', '@violet', '@pink', '@lime']],
      ...['sky', 'violet', 'pink', 'lime'].map((name, index) => [name, name, 2, [`#00000${index}`]]),
      ['theme', 'theme', 0, ['#111111', '#222222', '#333333', '#444444']],
    ] }
    for (const [themeIndex, theme] of themes.entries()) for (const [accentIndex, accent] of accents.entries()) {
      const resolve = createResolver(fixture, theme, accent)
      expect(resolve('semantic')).toBe(`#00000${accentIndex}`)
      expect(resolve('theme')).toBe(['#111111', '#222222', '#333333', '#444444'][themeIndex])
    }
  })

  it('rejects missing aliases, cycles, absent mode values and unknown appearances', () => {
    const fixture = { collections: colorCollections, variables: [
      ['missing', 'missing', 0, ['@unknown']],
      ['a', 'a', 0, ['@b']], ['b', 'b', 0, ['@a']],
    ] }
    const resolve = createResolver(fixture, 'light', 'sky')
    expect(() => resolve('missing')).toThrow('Missing alias target: unknown')
    expect(() => resolve('a')).toThrow('Alias cycle: a -> b -> a')
    expect(() => createResolver(fixture, 'dark', 'sky')('missing')).toThrow('Missing mode value')
    expect(() => createResolver(fixture, 'unknown', 'sky')).toThrow('Unknown appearance')
  })

  it('preserves source alpha rather than rounding to an opaque color', () => {
    expect(colorToCss('#1234ab/0.05')).toBe('rgb(18 52 171 / 0.05)')
    expect(colorToCss('#abcdef/0')).toBe('rgb(171 205 239 / 0)')
    expect(colorToCss('#abcdef/1')).toBe('rgb(171 205 239 / 1)')
    expect(colorToCss('#abcdef')).toBe('#abcdef')
    for (const invalid of ['#ffffff/1.1', '#ffff', '#ffffff/nope', 12, '@alias']) expect(() => colorToCss(invalid)).toThrow('Expected snapshot color')
  })

  it('exports every semantic color in all 16 scopes with deterministic cached output', async () => {
    const before = JSON.stringify(snapshot)
    const css = generateCss(snapshot)
    const semantic = snapshot.variables.filter(variable => snapshot.collections[variable[2]].name === 'Color Semantic')
    expect(semantic).toHaveLength(202)
    expect(css.match(/\[data-theme=/g)).toHaveLength(16)
    for (const theme of themes) for (const accent of accents) {
      expect(css).toContain(`[data-theme="${theme}"][data-accent="${accent}"]`)
      const block = css.split(`[data-theme="${theme}"][data-accent="${accent}"] {`)[1].split('}')[0]
      const resolve = createResolver(snapshot, theme, accent)
      for (const [id, name] of semantic) {
        expect(block).toContain(`--aml-semantic-${name.replaceAll('/', '-')}: ${colorToCss(resolve(id))};`)
      }
    }
    expect(css.match(/^  --aml-semantic-[a-z0-9-]+: /gm)).toHaveLength(202 * 16)
    expect(css).toContain(':root,\n[data-theme="light"][data-accent="sky"]')
    expect(generateCss(snapshot)).toBe(css)
    expect(await readFile(cssPath, 'utf8')).toBe(css)
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('keeps brand focus, opposite-theme selection and matching interaction states', () => {
    expect(compatibility['border-focus']).toBe('border/brand/base/default')
    expect(compatibility['focus-ring']).toBe('border/brand/base/default')
    expect(compatibility['selection-bg']).toBe('surface/neutral/strong/default')
    expect(compatibility['selection-fg']).toBe('contents/absolute/theme')
    expect(compatibility['text-muted']).toBe('contents/neutral/strong/default')
    for (const role of ['text-on-accent', 'icon-on-primary', 'icon-on-accent', 'text-on-selected', 'brand-selected-ink']) {
      expect(compatibility[role]).toBe('contents/absolute/theme')
    }
    expect(compatibility['surface-sidebar']).toBe('surface/background/secondary')
    expect(compatibility['surface-inset']).toBe('surface/background/primary')
    expect(compatibility['surface-selected']).toBe(compatibility['selection-bg'])
    expect(compatibility['surface-selected-hover']).toBe('surface/neutral/strong/hover')
    for (const kind of ['negative', 'danger']) for (const [suffix, state] of [['', 'default'], ['-hover', 'hover'], ['-pressed', 'pressed']]) {
      expect(compatibility[`action-${kind}${suffix}`]).toBe(`surface/status/danger/strong/${state}`)
    }
    // Node/edge encodings and composite shadows need a consumer-specific decision.
    for (const ambiguous of ['data-node', 'data-edge', 'shadow-raised']) expect(compatibility).not.toHaveProperty(ambiguous)
    for (const [role, state] of [['action-primary', 'default'], ['action-primary-hover', 'hover'], ['action-primary-pressed', 'pressed']]) {
      expect(compatibility[role]).toBe(`surface/brand/strong/${state}`)
    }
    for (const [name, target] of Object.entries(compatibility)) {
      if (!name.endsWith('-hover') && !name.endsWith('-pressed')) expect(target).not.toMatch(/\/(hover|pressed)$/)
    }
    const css = generateCss(snapshot)
    for (const [name, target] of Object.entries(compatibility)) {
      expect(css).toContain(`--aml-${name}: var(--aml-semantic-${target.replaceAll('/', '-')});`)
    }
  })
})

// Frozen primitive/source files are excluded; component CSS must use a bridge role or
// an explicitly inventoried primitive. This catches new color aliases left on v3.
it('covers consumed semantic color aliases across next styles and components', async () => {
  const { readdir } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  async function files(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat()
  }
  const unmapped = new Set()
  const primitives = new Set(['black-020', 'black-050', 'gray-020', 'white-100'])
  for (const path of await files(resolve(import.meta.dirname, '../src/next'))) {
    if (!/\.(css|tsx)$/.test(path) || /(?:tokens\.css|\.test\.tsx)$/.test(path)) continue
    for (const match of (await readFile(path, 'utf8')).matchAll(/var\(--aml-([\w-]+)/g)) {
      const name = match[1]
      if (!/^(semantic-|space-|size-|type-|font-|stroke-|radius-|layer-|duration-)/.test(name) && !primitives.has(name) && !compatibility[name]) unmapped.add(name)
    }
  }
  expect([...unmapped].sort()).toEqual([])
})

it('keeps Primary and Danger text contrast at least 4.5 across 48 appearance/state pairs each', () => {
  const ids = new Map(snapshot.variables.filter(variable => snapshot.collections[variable[2]].name === 'Color Semantic').map(([id, name]) => [name, id]))
  function luminance(hex) {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  }
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  for (const action of ['primary', 'danger']) {
    const ratios = []
    for (const theme of themes) for (const accent of accents) for (const suffix of ['', '-hover', '-pressed']) {
      const resolve = createResolver(snapshot, theme, accent)
      const background = resolve(ids.get(compatibility[`action-${action}${suffix}`]))
      const foreground = resolve(ids.get(compatibility['text-on-primary']))
      const ratio = contrast(background, foreground)
      expect(ratio, `${action}/${theme}/${accent}/${suffix || 'default'}`).toBeGreaterThanOrEqual(4.5)
      ratios.push(ratio)
    }
    expect(ratios).toHaveLength(48)
  }
  expect(compatibility['text-on-primary']).toBe('contents/absolute/theme')
  expect(compatibility['border-focus']).toBe('border/brand/base/default')
  expect(compatibility['focus-ring']).toBe('border/brand/base/default')
})
