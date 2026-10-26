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

  it('renders every pattern tag in the inverse theme color without a color dot', () => {
    const patterns = ['FAN_OUT', 'FAN_IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK', 'NON_PATTERN']
    const markup = patterns.map(pattern => renderToStaticMarkup(<PatternBadge pattern={pattern} probability={80} />))
    markup.forEach(item => {
      expect(item).toContain('semantic-pattern-badge')
      expect(item).not.toContain('pattern-dot')
      expect(item).not.toContain('--badge-tone')
    })
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(css).toContain('.semantic-pattern-badge { color: var(--background); border-color: var(--foreground); background: var(--foreground); }')
  })

  it('removes chart color tokens left unused by the single inverse color', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    for (const token of ['--dashboard-category-', '--dashboard-composition-', '--dashboard-label-on-']) expect(css).not.toContain(token)
  })

  it('gives owner, detection date, and elapsed time the same neutral filled badge', () => {
    const markup = renderToStaticMarkup(<DetailHeading record={records[0]} linkedRecords={[]} onOpen={() => {}} />)
    for (const id of ['owner-pill', 'detected-pill', 'age-pill']) {
      expect(markup.match(new RegExp(`<span[^>]*data-testid="${id}"[^>]*>`))?.[0]).toContain('semantic-metadata-badge')
    }
  })
})
