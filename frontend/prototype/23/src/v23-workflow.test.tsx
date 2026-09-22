import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import Lists, { EpisodeLinkActionBar, episodeLinkReducer, type EpisodeLinkState } from './Lists'
import { linkAlertsToEpisode, records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(
  <NuqsTestingAdapter><TooltipProvider>{node}</TooltipProvider></NuqsTestingAdapter>,
)
const browse: EpisodeLinkState = { mode: 'browse', selected: new Set() }

describe('v23 Alert episode linking workflow', () => {
  it('enters multi-select mode, blocks empty completion, and cancel discards selection', () => {
    const linking = episodeLinkReducer(browse, { type: 'start' })
    expect(linking.mode).toBe('episode-link')
    const emptyBar = html(<EpisodeLinkActionBar state={linking} episodes={records.filter(record => record.kind === 'Episode')} target="new" onTargetChange={() => {}} onComplete={() => {}} onCancel={() => {}} />)
    expect(emptyBar).toContain('연결 완료')
    expect(emptyBar).toMatch(/<button[^>]*disabled=""[^>]*>연결 완료<\/button>/)

    const selected = episodeLinkReducer(linking, { type: 'toggle', id: 'ALT-2026-1842' })
    expect(selected.selected).toEqual(new Set(['ALT-2026-1842']))
    expect(episodeLinkReducer(selected, { type: 'cancel' })).toEqual(browse)
  })

  it('shows the mode entry only on Alert lists and keeps checkboxes out of browse mode', () => {
    const alerts = html(<Lists kind="Alert" records={records} user="오검토" onOpen={() => {}} state="normal" setState={() => {}} />)
    const episodes = html(<Lists kind="Episode" records={records} user="오검토" onOpen={() => {}} state="normal" setState={() => {}} />)
    expect(alerts).toContain('Episode로 묶기')
    expect(alerts).not.toContain('type="checkbox"')
    expect(episodes).not.toContain('Episode로 묶기')
  })

  it('mirrors the selection set into semantic table rows and clears both stores on exit', () => {
    const source = readFileSync(new URL('./Lists.tsx', import.meta.url), 'utf8')
    expect(source).toContain('row.toggleSelected()')
    expect(source).toContain('table.getRow(record.id)?.toggleSelected()')
    expect(source.match(/table\.resetRowSelection\(\)/g)).toHaveLength(2)
  })

  it('updates an existing Episode or creates a new mock Episode without an API', () => {
    const alertIds = records.filter(record => record.kind === 'Alert').slice(0, 2).map(record => record.id)
    const existing = records.find(record => record.kind === 'Episode')!
    const linked = linkAlertsToEpisode(records, alertIds, existing.id)
    expect(linked.filter(record => alertIds.includes(record.id)).every(record => record.episodeId === existing.id)).toBe(true)
    expect(linked.find(record => record.id === existing.id)?.alertIds).toEqual(expect.arrayContaining(alertIds))

    const created = linkAlertsToEpisode(records, alertIds, 'new')
    const newEpisode = created.find(record => record.kind === 'Episode' && !records.some(previous => previous.id === record.id))
    expect(newEpisode?.alertIds).toEqual(alertIds)
    expect(created.filter(record => alertIds.includes(record.id)).every(record => record.episodeId === newEpisode?.id)).toBe(true)
  })
})

describe('v23 shell action shape and feedback', () => {
  it('uses pill page actions and an inset full-width brand button with semantic active feedback', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/header-actions[\s\S]*?rounded-full[\s\S]*?rounded-full/)
    expect(source).toMatch(/SidebarHeader className="[^"]*p-0[^"]*"/)
    expect(source).toMatch(/group\/brand[^"]*absolute inset-0 m-2/)
    expect(source).toContain('active:bg-[var(--selection-background)]')
    expect(source).toContain('active:text-[var(--selection-foreground)]')
  })
})
