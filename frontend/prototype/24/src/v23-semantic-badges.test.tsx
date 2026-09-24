import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DetailHeading, PatternBadge, StatusBadge } from './shared'
import { records } from './domain'

describe('semantic badges', () => {
  it.each([
    ['검토 전', 'pending'], ['조사 전', 'pending'], ['검토 중', 'working'], ['조사 중', 'working'], ['종결', 'closed'],
  ])('%s has a distinct workflow tone', (label, tone) => {
    expect(renderToStaticMarkup(<StatusBadge status={label} />)).toContain(`data-tone="${tone}"`)
  })

  it('uses the same eight unique tones as the dashboard patterns', () => {
    const patterns = ['FAN_OUT', 'FAN_IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK']
    const markup = patterns.map(pattern => renderToStaticMarkup(<PatternBadge pattern={pattern} probability={80} />))
    const tones = markup.map(item => item.match(/--badge-tone:([^;" ]+)/)?.[1])
    expect(new Set(tones).size).toBe(8)
    expect(tones).toEqual([4, 5, 6, 7, 8, 9, 1, 2].map(number => `var(--dashboard-category-${number})`))
    markup.forEach(item => expect(item).toContain('data-slot="pattern-dot"'))
  })

  it('keeps all eight pattern colors in a distinguishable warm anomaly palette in both themes', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const indices = [4, 5, 6, 7, 8, 9, 1, 2]
    const themes = indices.map(index => [...css.matchAll(new RegExp(`--dashboard-category-${index}:\\s*oklch\\(([^)]+)\\)`, 'g'))])
    expect(themes.every(matches => matches.length === 2)).toBe(true)
    for (const themeIndex of [0, 1]) {
      const hues = themes.map(matches => Number(matches[themeIndex][1].trim().split(/\s+/)[2]))
      expect(hues.every(hue => hue < 100 || hue >= 340)).toBe(true)
      expect(hues.every((hue, index) => hues.slice(index + 1).every(other => Math.min(Math.abs(hue - other), 360 - Math.abs(hue - other)) >= 10))).toBe(true)
    }
  })

  it('gives owner, detection date, and elapsed time the same neutral filled badge', () => {
    const markup = renderToStaticMarkup(<DetailHeading record={records[0]} linkedRecords={[]} onOpen={() => {}} />)
    for (const id of ['owner-pill', 'detected-pill', 'age-pill']) {
      expect(markup.match(new RegExp(`<span[^>]*data-testid="${id}"[^>]*>`))?.[0]).toContain('semantic-metadata-badge')
    }
  })
})
