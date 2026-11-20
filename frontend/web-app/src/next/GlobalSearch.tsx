import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog } from 'radix-ui'
import { Compass, LayoutDashboard, List, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { caseHref, useWorkspace } from './workspace-store'
import { patternName, workStates } from './dashboard-data'
import './styles/global-search.css'

const categories = ['전체', '대시보드', '룰 엔진', '거래', 'Alert', 'Episode'] as const
type Category = typeof categories[number]
type Result = { id: string; title: string; meta: string; category: Exclude<Category, '전체'>; href: string; caseId?: number }

export function GlobalSearch() {
  const workspace = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('전체')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => {
    const pages: Result[] = [
      { id: 'dashboard-mine', title: '내 담당 대시보드', meta: '내 담당 업무', category: '대시보드', href: '#/dashboard/mine' },
      { id: 'dashboard-all', title: '전체 대시보드', meta: '전체 업무', category: '대시보드', href: '#/dashboard/all' },
    ]
    const cases: Result[] = workspace.records.map(item => ({ id: `case-${item.caseId}`, title: item.displayId,
      meta: `${item.assignee} · ${workStates.find(state => state.key === item.workState)?.label ?? ''} · ${patternName(item.typeCode)}`,
      category: item.kind === 'ALERT' ? 'Alert' : 'Episode', href: caseHref(item), caseId: item.caseId }))
    const recent = new Set(workspace.openedCaseIds ?? [])
    const source: Result[] = [...cases.filter(item => recent.has(item.caseId!)), ...pages,
      ...workspace.rules.map(rule => ({ id: `rule-${rule.id}`, title: rule.name, meta: `${rule.id} · v${rule.version}`, category: '룰 엔진' as const, href: `#/rules?selected=${encodeURIComponent(rule.id)}` })),
      ...cases.filter(item => !recent.has(item.caseId!)),
      ...workspace.transactions.map(tx => ({ id: `transaction-${tx.id}`, title: tx.displayId, meta: `${tx.fromAccountId} → ${tx.toAccountId} · ${tx.amountUsd.toLocaleString('ko-KR')} USD`, category: '거래' as const, href: `#/investigate/ledger?transaction=${tx.id}` }))]
    const term = query.trim().toLocaleLowerCase()
    return source.filter(item => (category === '전체' || item.category === category) && `${item.title} ${item.meta} ${item.category}`.toLocaleLowerCase().includes(term)).slice(0, 50)
  }, [workspace.records, workspace.rules, workspace.transactions, workspace.openedCaseIds, query, category])
  const active = Math.min(selected, Math.max(0, results.length - 1))
  function changeCategory(value: Category) { setCategory(value); setSelected(0) }
  function activate(item: Result) {
    if (item.caseId !== undefined) workspace.openCase(item.caseId)
    window.location.hash = item.href.slice(1)
    setOpen(false)
  }
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) { const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; setSelected(next); document.getElementById(`global-search-result-${next}`)?.scrollIntoView?.({ block: 'nearest' }) }
    } else if (event.key === 'Enter' && results[active]) { event.preventDefault(); activate(results[active]) }
  }
  const container = document.querySelector<HTMLElement>('[data-ui="aml-app"]') ?? undefined
  return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); if (value) { setQuery(''); setCategory('전체'); setSelected(0) } }}>
    <Dialog.Trigger asChild><Button variant="ghost" data-search="trigger" aria-label="전역 검색"><Search aria-hidden="true" />검색</Button></Dialog.Trigger>
    <Dialog.Portal container={container}><Dialog.Overlay data-ws="dialog-overlay" />
      <Dialog.Content data-ws="dialog" data-search="dialog" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }}>
        <header><Dialog.Title>검색</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="검색 닫기"><X /></Button></Dialog.Close></header>
        <Dialog.Description data-ws="sr-only">대시보드, 룰, 거래, Alert와 Episode를 검색합니다.</Dialog.Description>
        <label data-search="input"><Search aria-hidden="true" /><input ref={input} role="combobox" aria-label="전역 검색어" aria-expanded="true" aria-autocomplete="list" aria-controls="global-search-results" aria-activedescendant={results[active] ? `global-search-result-${active}` : undefined} placeholder="검색어 입력" value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={keys} /></label>
        <div role="tablist" aria-label="검색 분류" data-search="categories">{categories.map((item, index) => <Button key={item} variant="ghost" role="tab" id={`global-search-category-${index}`} aria-selected={category === item} aria-controls="global-search-results" tabIndex={category === item ? 0 : -1} onClick={() => changeCategory(item)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length; changeCategory(categories[next]); document.getElementById(`global-search-category-${next}`)?.focus() } }}>{item}</Button>)}</div>
        <div role="listbox" id="global-search-results" aria-label="검색 결과" data-search="results" onKeyDown={keys}>
          {results.map((item, index) => <a key={item.id} id={`global-search-result-${index}`} role="option" aria-selected={active === index} tabIndex={-1} href={item.href} data-search="result" onClick={event => { event.preventDefault(); activate(item) }}>
            {item.category === '대시보드' ? <LayoutDashboard aria-hidden="true" /> : item.category === '룰 엔진' ? <List aria-hidden="true" /> : <Compass aria-hidden="true" />}<span><strong>{item.title}</strong><small>{item.category} · {item.meta}</small></span>
          </a>)}
        </div>
        {!results.length && <div data-search="empty" role="status"><strong>맞는 항목이 없습니다.</strong><p>검색어를 바꿔 보세요.</p></div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
