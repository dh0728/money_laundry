import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { App } from './App'

const themes = ['light', 'dark', 'solarized-light', 'solarized-dark']
const accents = ['sky', 'violet', 'pink', 'lime']
const combinations = themes.flatMap(theme => accents.map(accent => ({ theme, accent })))
beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/#/login')
})
afterEach(cleanup)

describe('appearance matrix: behavior, not visual approval', () => {
  it.each(combinations)('keeps $theme / $accent through login and app remount', async ({ theme, accent }) => {
    const first = render(<App />)
    fireEvent.change(screen.getByLabelText('테마'), { target: { value: theme } })
    fireEvent.change(screen.getByLabelText('브랜드'), { target: { value: accent } })
    fireEvent.click(screen.getByRole('button', { name: '샘플 계정으로 입장' }))
    await screen.findByRole('heading', { name: '내 담당 업무' })
    expect(document.querySelector('[data-ui="aml-app"]')).toHaveAttribute('data-theme', theme)
    expect(document.querySelector('[data-ui="aml-app"]')).toHaveAttribute('data-accent', accent)
    first.unmount()
    render(<App />)
    expect(screen.getByLabelText('테마')).toHaveValue(theme)
    expect(screen.getByLabelText('브랜드')).toHaveValue(accent)
    expect(screen.getByRole('heading', { name: '내 담당 업무' })).toBeInTheDocument()
  })
})

const css = readFileSync('src/next/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.trim().split(',').map(s => s.trim()),
  entries: [...body.matchAll(/(--aml-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value] as const),
}))
describe('v3 token matrix integrity', () => {
  it.each(combinations)('resolves all token references for $theme / $accent', ({ theme, accent }) => {
    const root = document.createElement('div')
    root.dataset.theme = theme
    root.dataset.accent = accent
    expect(rules.some(rule => rule.selectors.includes('[data-theme="' + theme + '"]'))).toBe(true)
    expect(rules.some(rule => rule.selectors.includes('[data-theme="' + theme + '"][data-accent="' + accent + '"]'))).toBe(true)
    const tokens = new Map<string, string>()
    // Inherited :root defaults precede the element's own theme/brand overrides.
    for (const rule of rules) if (rule.selectors.includes(':root')) for (const [name, value] of rule.entries) tokens.set(name, value)
    for (const rule of rules) if (rule.selectors.some(s => s !== ':root' && root.matches(s))) for (const [name, value] of rule.entries) tokens.set(name, value)
    const resolve = (name: string, chain: string[] = []): string => {
      expect(chain, 'cyclic token: ' + [...chain, name].join(' -> ')).not.toContain(name)
      const value = tokens.get(name)
      expect(value, 'missing token: ' + name).toBeDefined()
      return value!.replace(/var\((--aml-[\w-]+)\)/g, (_, next: string) => resolve(next, [...chain, name]))
    }
    expect(tokens.size).toBeGreaterThan(200)
    for (const name of tokens.keys()) expect(resolve(name)).not.toContain('var(')
    expect(resolve('--aml-accent-050')).toBe(resolve('--aml-' + accent + '-050'))
    for (const name of ['--aml-surface-canvas', '--aml-text-primary', '--aml-brand-rest', '--aml-brand-ink']) expect(resolve(name)).toMatch(/^(#[0-9a-f]{6}|rgb\([\d. /]+\))$/i)
  })
})
