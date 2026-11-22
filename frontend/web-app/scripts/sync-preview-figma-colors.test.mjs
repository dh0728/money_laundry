import { describe, expect, it } from 'vitest'
import { generatePreviewColorCss, normalizePreviewColors, snapshotFromFigmaVariables } from './sync-preview-figma-colors.mjs'

const snapshot = {
  collection: 'Color Semantic',
  modes: ['Dark', 'Light'],
  colors: [
    ['surface/status/warning', '#AB12CD/0.6500', '#FFAA00'],
    ['contents/text', '#FFFFFF', '#000000/1'],
  ],
}

describe('5215 Figma colors', () => {
  it('normalizes snapshot order and preserves opacity in mode-specific and dynamic CSS', () => {
    const normalized = normalizePreviewColors(snapshot)
    expect(normalized.modes).toEqual(['Light', 'Dark'])
    expect(normalized.colors).toEqual([
      ['contents/text', '#000000', '#ffffff'],
      ['surface/status/warning', '#ffaa00', '#ab12cd/0.65'],
    ])
    const css = generatePreviewColorCss(snapshot)
    expect(css).toContain('--aml-figma-light-surface-status-warning: #ffaa00;')
    expect(css).toContain('--aml-figma-dark-surface-status-warning: rgb(171 18 205 / 0.65);')
    expect(css).toContain('--aml-figma-surface-status-warning: light-dark(var(--aml-figma-light-surface-status-warning), var(--aml-figma-dark-surface-status-warning));')
    expect(css).toBe(generatePreviewColorCss(normalized))
  })

  it('rejects ambiguous CSS names and invalid colors before generating a file', () => {
    expect(() => normalizePreviewColors({
      ...snapshot, colors: [['a/b', '#000000', '#000000'], ['a-b', '#ffffff', '#ffffff']],
    })).toThrow('Duplicate CSS property')
    expect(() => normalizePreviewColors({ ...snapshot, colors: [['a', '#123456/1.25', '#000000']] })).toThrow('Invalid color')
    expect(() => normalizePreviewColors({ ...snapshot, colors: [['a; color', '#123456', '#000000']] })).toThrow('Invalid color name')
  })

  it('resolves REST aliases in Light and Dark, with the dependency collection default when needed', () => {
    const figma = {
      meta: {
        variableCollections: {
          semantic: {
            id: 'semantic', name: 'Color Semantic', defaultModeId: 'light',
            modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }], variableIds: ['role'],
          },
          base: {
            id: 'base', name: 'Foundation', defaultModeId: 'default',
            modes: [{ modeId: 'default', name: 'Default' }],
          },
        },
        variables: {
          role: {
            id: 'role', name: 'border/brand', resolvedType: 'COLOR', variableCollectionId: 'semantic',
            valuesByMode: {
              light: { type: 'VARIABLE_ALIAS', id: 'blue' },
              dark: { color: { type: 'VARIABLE_ALIAS', id: 'blue' }, opacity: 25 },
            },
          },
          blue: {
            id: 'blue', name: 'blue', resolvedType: 'COLOR', variableCollectionId: 'base',
            valuesByMode: { default: { r: 0, g: 0.5, b: 1, a: 1 } },
          },
        },
      },
    }
    expect(snapshotFromFigmaVariables(figma).colors).toEqual([['border/brand', '#0080ff', '#0080ff/0.25']])
    figma.meta.variables.blue.valuesByMode.default = { type: 'VARIABLE_ALIAS', id: 'role' }
    expect(() => snapshotFromFigmaVariables(figma)).toThrow('Alias cycle')
  })
})
