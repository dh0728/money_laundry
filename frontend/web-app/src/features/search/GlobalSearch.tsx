// 헤더의 남는 너비를 채우는 전역 검색: 소유주·계좌·거래·Alert·Episode·알림·화면을 한 번에 찾는다.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { fetchAlerts, type AlertRow } from '@/api/alerts'
import { typeDisplay } from '@/api/codes'
import { fetchEpisodes, type EpisodeRow } from '@/api/episodes'
import { fetchTransactionExplorer } from '@/api/transactions'
import type { Page } from '@/app/navigation'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { buildTransactionIndex, searchTransactionIndex, type TransactionIndex, type TransactionTarget } from '@/features/transactions/transactionIndex'
import { live } from '@/lib/apiMode'
import { memorySnapshot, writeMemory } from '@/lib/memory'
import { allAlertsNormal } from '@/mocks/alerts'
import { loadMockEpisodes } from '@/mocks/episodes'
import { loadMockNotifications, type NotificationItem } from '@/mocks/notifications'
import { loadMockTransactionExplorer } from '@/mocks/transactions'
import { pageLinks, settingItems } from './searchItems'

type SearchData = { alerts: AlertRow[]; episodes: EpisodeRow[]; transactions: TransactionIndex; notifications: NotificationItem[] }
type ResultItem = { key: string; primary: ReactNode; secondary?: string; onSelect: () => void }
type ResultGroup = { id: string; label: string; items: ResultItem[] }

// 대소문자 구분 없이 일치한 부분만 <mark>로 강조한다
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query) : -1
  if (i === -1) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded-[3px] bg-accent px-0.5 text-accent-foreground">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>
}

async function loadSearchData(overrides: Parameters<typeof withOverride>[1]): Promise<SearchData> {
  if (live) {
    const [alerts, episodes, explorer] = await Promise.all([fetchAlerts({ size: 200 }), fetchEpisodes({ size: 200 }), fetchTransactionExplorer()])
    return { alerts: alerts.content, episodes: episodes.content, transactions: buildTransactionIndex(explorer), notifications: [] }
  }
  // mock은 Alert 화면에서 처리한 결과(연결·판정)를 반영한다
  const alerts = allAlertsNormal.content.map(row => withOverride(row, overrides))
  const [episodes, explorer, notifications] = await Promise.all([loadMockEpisodes(alerts, 'normal'), loadMockTransactionExplorer('normal'), loadMockNotifications()])
  return { alerts, episodes: episodes.content, transactions: buildTransactionIndex(explorer), notifications }
}

type Props = {
  onNavigate: (page: Page, id?: number) => void
  onOpenTransaction: (target: TransactionTarget) => void
}

export default function GlobalSearch({ onNavigate, onOpenTransaction }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [data, setData] = useState<SearchData | null>(null)
  const [overrides] = useAlertOverrides()
  const input = useRef<HTMLInputElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  // 처음 열 때와 처리 결과가 바뀔 때 검색 대상을 불러온다
  useEffect(() => {
    if (!open) return
    let current = true
    loadSearchData(overrides).then(next => { if (current) setData(next) }, () => { if (current) setData(null) })
    return () => { current = false }
  }, [open, overrides])

  // "/"로 검색창에 들어간다. 입력 중인 칸에서는 가로채지 않는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable=true]')) return
      event.preventDefault(); input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = () => { setOpen(false); setQuery(''); setActive(0); input.current?.blur() }
  const select = (fn: () => void) => () => { fn(); close() }

  const groups: ResultGroup[] = useMemo(() => {
    if (!q) return [{ id: 'quick', label: '바로가기', items: pageLinks.map(p => ({ key: `quick-${p.page}`, primary: p.label, onSelect: select(() => onNavigate(p.page)) })) }]
    const alerts: ResultItem[] = (data?.alerts ?? [])
      .filter(a => `A-${a.alertId} ${a.alertId} ${a.summary} ${typeDisplay(a.primaryType.code).key} ${typeDisplay(a.primaryType.code).label} ${a.assignee.name} ${a.subjectAccount.account}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(a => ({ key: `alert-${a.alertId}`, primary: <span className="font-mono text-xs"><Highlight text={`A-${a.alertId}`} query={q} /></span>, secondary: `${typeDisplay(a.primaryType.code).label} · ${a.assignee.name}`, onSelect: select(() => onNavigate('alerts', a.alertId)) }))
    const episodes: ResultItem[] = (data?.episodes ?? [])
      .filter(e => `E-${e.episodeId} ${e.episodeId} ${e.assignee.name} ${e.primaryTypes.flatMap(t => [typeDisplay(t.code).key, typeDisplay(t.code).label]).join(' ')}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(e => ({ key: `episode-${e.episodeId}`, primary: <span className="font-mono text-xs"><Highlight text={`E-${e.episodeId}`} query={q} /></span>, secondary: `Alert ${e.alertCount}건 · ${e.assignee.name}`, onSelect: select(() => onNavigate('episodes', e.episodeId)) }))
    const notifications: ResultItem[] = (data?.notifications ?? [])
      .filter(item => `${item.code} ${item.title} ${item.description} ${item.patternCode === undefined ? '' : `${typeDisplay(item.patternCode).key} ${typeDisplay(item.patternCode).label}`}`.toLocaleLowerCase('ko').includes(q))
      .slice(0, 5)
      .map(item => ({ key: `notification-${item.id}`, primary: <Highlight text={item.title} query={q} />, secondary: item.code,
        onSelect: select(() => {
          const read = memorySnapshot<string[]>('notifications:read', [])
          if (!read.includes(item.id)) writeMemory('notifications:read', [...read, item.id])
          onNavigate(item.target.page, item.target.id)
        }) }))
    const matches = data ? searchTransactionIndex(data.transactions, q) : []
    const targets = (type: TransactionTarget['type']): ResultItem[] => matches.filter(m => m.target.type === type).map(m => ({
      key: m.key, primary: <span className={type === 'owner' ? '' : 'font-mono text-xs'}><Highlight text={m.label} query={q} /></span>, secondary: m.detail, onSelect: select(() => onOpenTransaction(m.target)),
    }))
    const screens: ResultItem[] = [...pageLinks, ...settingItems]
      .filter(s => s.label.toLowerCase().includes(q))
      .slice(0, 6)
      .map((s, i) => ({ key: `screen-${s.label}-${i}`, primary: <Highlight text={s.label} query={q} />, onSelect: select(() => onNavigate(s.page)) }))
    return [
      { id: 'owner', label: '소유주', items: targets('owner') },
      { id: 'account', label: '계좌', items: targets('account') },
      { id: 'transaction', label: '거래', items: targets('transaction') },
      { id: 'alert', label: 'Alert', items: alerts },
      { id: 'episode', label: 'Episode', items: episodes },
      { id: 'notification', label: '알림', items: notifications },
      { id: 'screen', label: '화면·설정', items: screens },
    ].filter(g => g.items.length > 0)
    // select는 매 렌더 새로 만들지만 결과 목록은 검색어·데이터가 바뀔 때만 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data])

  const flat = groups.flatMap(g => g.items)
  const indexOf = new Map(flat.map((item, i) => [item, i]))

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setActive(0) }}>
      <PopoverAnchor asChild>
        <div ref={anchor} className="relative min-w-0 w-full">
          <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            ref={input}
            aria-label="전역 검색" role="combobox" aria-expanded={open} aria-controls="global-search-listbox" aria-autocomplete="list"
            aria-activedescendant={flat[active] ? `gs-item-${active}` : undefined}
            placeholder="소유주 · 계좌 · 거래 · Alert · Episode · 알림 검색" className="h-9 rounded-full bg-muted/40 pl-9 pr-10" value={query}
            onFocus={() => setOpen(true)}
            onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(flat.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); flat[active]?.onSelect() }
              else if (e.key === 'Escape') close()
            }}
          />
          <Kbd data-testid="global-search-shortcut" aria-hidden="true" className="pointer-events-none absolute right-2 top-2 z-10">/</Kbd>
        </div>
      </PopoverAnchor>
      <PopoverContent id="global-search-listbox" role="listbox" aria-label="검색 결과" className="w-(--radix-popper-anchor-width) max-w-[90vw] p-2"
        onOpenAutoFocus={e => e.preventDefault()}
        onInteractOutside={event => { if (anchor.current?.contains(event.target as Node)) event.preventDefault() }}>
        {flat.length === 0
          ? <p className="p-4 text-center text-xs text-muted-foreground">{q && !data ? '불러오는 중…' : '검색 결과가 없습니다.'}</p>
          : (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {groups.map(g => (
                <div key={g.id}>
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium text-muted-foreground">{g.label}</p>
                  {g.items.map(item => {
                    const i = indexOf.get(item)!
                    return (
                      <button key={item.key} id={`gs-item-${i}`} role="option" aria-selected={i === active} type="button"
                        onMouseEnter={() => setActive(i)} onClick={item.onSelect}
                        className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}>
                        <span className="truncate">{item.primary}</span>
                        {item.secondary && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{item.secondary}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
      </PopoverContent>
    </Popover>
  )
}
