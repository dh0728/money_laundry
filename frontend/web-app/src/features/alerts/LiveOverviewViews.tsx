import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { ReviewKind } from '@/api/liveReview'

export type OverviewSection = { id: string; name: string; content: ReactNode; focusContent?: ReactNode }

export function FocusPanel({ number, title, question, visual, children, after }: { number: number; title: string; question: string; visual: ReactNode; children: ReactNode; after?: ReactNode }) {
  return <section className="grid min-w-0 overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-label={`${title} 시각화`}>
    <div className="flex min-h-72 min-w-0 flex-col justify-center gap-4 border-b bg-muted/50 p-4 sm:p-6 lg:border-b-0 lg:border-r" data-testid="focus-visual">{visual}</div>
    <aside className="min-w-0 space-y-4 p-4 sm:p-6" data-testid="focus-copy">
      <h2 className="text-lg font-semibold" tabIndex={-1} data-focus-heading>{number} {title}</h2>
      <p className="font-medium">{question}</p>
      <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
    </aside>
    {after && <div className="min-w-0 border-t p-4 sm:p-6 lg:col-span-2">{after}</div>}
  </section>
}

/** The same live panels in both reading modes. IDs are stable FE anchors for API wiring review. */
export default function LiveOverviewViews({ kind, sections }: { kind: ReviewKind; sections: OverviewSection[] }) {
  const [mode, setMode] = useState<'all' | 'focus'>('all')
  const focusRef = useRef<HTMLDivElement>(null)
  const focusHeadingAfterRender = useRef(false)
  useEffect(() => {
    const showSelectedPanel = (event: Event) => {
      if ((event as CustomEvent<string>).detail?.startsWith('case.overview')) setMode('all')
    }
    window.addEventListener('aml-wiring-focus', showSelectedPanel)
    return () => window.removeEventListener('aml-wiring-focus', showSelectedPanel)
  }, [])
  const [selected, setSelected] = useState(0)
  useEffect(() => {
    if (!focusHeadingAfterRender.current || mode !== 'focus') return
    focusHeadingAfterRender.current = false
    focusRef.current?.querySelector<HTMLElement>('[data-focus-heading]')?.focus({ preventScroll: true })
  }, [mode, selected])
  const move = (next: number, focusHeading = false) => {
    const bounded = Math.max(0, Math.min(sections.length - 1, next))
    if (bounded === selected) return
    focusHeadingAfterRender.current = focusHeading
    setSelected(bounded)
  }
  const onFocusKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!direction) return
    const target = event.target as HTMLElement
    const arrowControl = 'input,textarea,select,[contenteditable],[role="slider"],[role="tab"],[role="tablist"],[role="radio"],[role="radiogroup"],[role="spinbutton"],[role="combobox"],[role="listbox"],[role="tree"],[role="grid"],[role="menu"],[role="menubar"]'
    if (target.isContentEditable || target.closest(arrowControl)) return
    const next = selected + direction
    if (next < 0 || next >= sections.length) return
    event.preventDefault()
    const inPanel = !!target.closest('[data-focus-panel]')
    const navButtonWillDisable = target.matches('[data-focus-jump="prev"],[data-focus-jump="first"]') && next === 0
      || target.matches('[data-focus-jump="next"],[data-focus-jump="last"]') && next === sections.length - 1
    move(next, inPanel || navButtonWillDisable)
  }
  return <section aria-label={`${kind === 'ALERT' ? 'Alert' : 'Episode'} 개요`} data-wiring-id="case.overview" className="min-w-0">
    <div className="mb-4 inline-flex max-w-full rounded-lg border bg-muted p-1" role="group" aria-label="개요 보기 방식">
      <Button size="sm" variant={mode === 'all' ? 'secondary' : 'ghost'} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>전체 보기</Button>
      <Button size="sm" variant={mode === 'focus' ? 'secondary' : 'ghost'} aria-pressed={mode === 'focus'} onClick={() => { focusHeadingAfterRender.current = true; setMode('focus') }}>패널별 보기</Button>
    </div>
    {mode === 'all' ? <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12" data-testid="overview-all">
      {sections.map((section, index) => <div key={section.id} data-wiring-id={`case.overview.${section.id}`} className={`min-w-0 ${kind === 'EPISODE' ? index < 3 ? 'xl:col-span-12' : 'xl:col-span-6' : index < 2 ? 'xl:col-span-12' : 'xl:col-span-4'}`}>{section.content}</div>)}
    </div> : <div ref={focusRef} className="min-w-0" data-testid="overview-focus" tabIndex={0} onKeyDown={onFocusKeyDown}>
      <div data-focus-panel data-wiring-id={`case.overview.${sections[selected].id}`} className="min-w-0">{sections[selected].focusContent ?? sections[selected].content}</div>
      <nav aria-label="개요 패널 이동" className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
        <Button size="sm" variant="outline" data-focus-jump="first" disabled={selected === 0} onClick={() => move(0, true)}>처음 패널</Button>
        <Button size="sm" variant="outline" data-focus-jump="prev" aria-keyshortcuts="ArrowLeft" disabled={selected === 0} onClick={() => move(selected - 1, selected === 1)}>이전 패널</Button>
        <strong className="px-2" aria-live="polite">{selected + 1}/{sections.length} · {sections[selected].name}</strong>
        <Button size="sm" variant="outline" data-focus-jump="next" aria-keyshortcuts="ArrowRight" disabled={selected === sections.length - 1} onClick={() => move(selected + 1, selected === sections.length - 2)}>다음 패널</Button>
        <Button size="sm" variant="outline" data-focus-jump="last" disabled={selected === sections.length - 1} onClick={() => move(sections.length - 1, true)}>마지막 패널</Button>
      </nav>
    </div>}
  </section>
}
