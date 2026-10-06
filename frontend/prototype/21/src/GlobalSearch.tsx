import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { graphFor, type RecordItem } from './domain'
import { buildNotifications } from './UtilityPages'
import { buildTransactionIndex, searchTransactionIndex, type TransactionTarget } from './transactionIndex'

// 화면·설정 바로가기: 실제 라우팅 id와 사람이 읽는 라벨을 함께 둔다.
// (v16-shell.test.tsx가 검색 색인을 직접 단위 테스트할 수 있도록 export한다)
export const pageLinks = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'transactions', label: 'Transactions' },
  { page: 'alerts', label: 'Alerts' },
  { page: 'episodes', label: 'Episodes' },
  { page: 'notifications', label: '알림' },
  { page: 'settings', label: '설정' },
  { page: 'account', label: '계정' },
] as const

// Settings·Account 화면에 실제로 있는 항목 라벨(읽어서 옮김: 시간대·날짜 형식·페이지당 행·기본 정렬·테마 3종·세션·로그아웃 등)
export const settingItems = [
  { label: '테마', page: 'settings' },
  { label: '시스템 설정', page: 'settings' },
  { label: '라이트 모드', page: 'settings' },
  { label: '다크 모드', page: 'settings' },
  { label: '시간대', page: 'settings' },
  { label: '날짜 형식', page: 'settings' },
  { label: '페이지당 행', page: 'settings' },
  { label: '기본 정렬', page: 'settings' },
  { label: '알림', page: 'settings' },
  { label: '설정 초기화', page: 'settings' },
  { label: '계정', page: 'account' },
  { label: '프로필', page: 'account' },
  { label: '세션 관리', page: 'account' },
  { label: '로그아웃', page: 'account' },
] as const

type ResultItem = { key: string; primary: ReactNode; secondary?: string; onSelect: () => void }
type ResultGroup = { id: string; label: string; items: ResultItem[] }

// 대소문자 구분 없이 일치한 부분만 <mark>로 강조한다.
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (i === -1) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="bg-accent text-accent-foreground rounded-[3px] px-0.5">{text.slice(i, i + query.trim().length)}</mark>{text.slice(i + query.trim().length)}</>
}

// 계좌 번호 → 그 계좌가 등장하는 업무 id들의 색인. graphFor가 계산해 주는 계좌/은행/명의를 그대로 쓴다.
export type AccountEntry = { account: string; bank: string; entity: string; recordIds: string[] }
export function buildAccountIndex(records: RecordItem[]): AccountEntry[] {
  const map = new Map<string, AccountEntry>()
  for (const r of records) {
    const model = graphFor(r, records)
    for (const n of model.nodes) {
      let e = map.get(n.account)
      if (!e) { e = { account: n.account, bank: n.bank, entity: n.entity, recordIds: [] }; map.set(n.account, e) }
      if (!e.recordIds.includes(r.id)) e.recordIds.push(r.id)
    }
  }
  return [...map.values()]
}

export default function GlobalSearch({ records, onOpenRecord, onOpenTransaction, onNavigate }: { records: RecordItem[]; onOpenRecord: (r: RecordItem) => void; onOpenTransaction: (target: TransactionTarget) => void; onNavigate: (page: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const transactionIndex = useMemo(() => buildTransactionIndex(records), [records])
  // buildNotifications는 알림 화면과 같은 RecordItem[]을 돌려준다. 알림 문구는 Notifications 화면과 동일하게 만든다.
  const notifications = useMemo(() => buildNotifications(records).map(r => ({ id: r.id, record: r, text: `${r.owner}님에게 ${r.kind}가 배정되었습니다. ${r.title}` })), [records])
  const q = query.trim().toLowerCase()

  const close = () => { setOpen(false); setQuery(''); setActive(0) }
  const select = (fn: () => void) => { fn(); close() }

  const groups: ResultGroup[] = useMemo(() => {
    if (!q) {
      // 빈 검색어: 최근 대신 화면 바로가기를 quick link로 보여준다.
      return [{
        id: 'quick', label: '바로가기',
        items: pageLinks.map(p => ({ key: `quick-${p.page}`, primary: p.label, onSelect: () => select(() => onNavigate(p.page)) })),
      }]
    }
    const recordItems = (kind: 'Alert' | 'Episode'): ResultItem[] => records
      .filter(r => r.kind === kind && `${r.id} ${r.title} ${r.pattern} ${r.owner}`.toLowerCase().includes(q))
      .slice(0, 5)
      .map(r => ({
        key: `record-${r.id}`,
        primary: <span className="font-mono text-xs"><Highlight text={r.id} query={q} /></span>,
        secondary: r.title,
        onSelect: () => select(() => onOpenRecord(r)),
      }))
    const transactionMatches = searchTransactionIndex(transactionIndex, q)
    const targetItems = (type: TransactionTarget['type']): ResultItem[] => transactionMatches.filter(item => item.target.type === type).map(item => ({
      key: item.key,
      primary: <span className={type === 'owner' ? '' : 'font-mono text-xs'}><Highlight text={item.label} query={q} /></span>,
      secondary: item.detail,
      onSelect: () => select(() => onOpenTransaction(item.target)),
    }))
    const notificationItems: ResultItem[] = notifications
      .filter(n => n.text.toLowerCase().includes(q))
      .slice(0, 5)
      .map(n => ({ key: `noti-${n.id}`, primary: <Highlight text={n.text} query={q} />, secondary: n.record.date, onSelect: () => select(() => onNavigate('notifications')) }))
    const settingsItems: ResultItem[] = [...pageLinks, ...settingItems]
      .filter(s => s.label.toLowerCase().includes(q))
      .slice(0, 6)
      .map((s, i) => ({ key: `screen-${s.label}-${i}`, primary: <Highlight text={s.label} query={q} />, onSelect: () => select(() => onNavigate(s.page)) }))

    return [
      { id: 'owner', label: '소유주', items: targetItems('owner') },
      { id: 'account', label: '계좌', items: targetItems('account') },
      { id: 'transaction', label: '거래', items: targetItems('transaction') },
      { id: 'alert', label: 'Alert', items: recordItems('Alert') },
      { id: 'episode', label: 'Episode', items: recordItems('Episode') },
      { id: 'noti', label: '알림', items: notificationItems },
      { id: 'screen', label: '화면·설정', items: settingsItems },
    ].filter(g => g.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, records, transactionIndex, notifications])

  const flat = groups.flatMap(g => g.items)
  const indexOf = new Map(flat.map((it, i) => [it, i]))

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setActive(0) }}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label="전역 검색" role="combobox" aria-expanded={open} aria-controls="global-search-listbox" aria-autocomplete="list"
            aria-activedescendant={flat[active] ? `gs-item-${active}` : undefined}
            placeholder="소유주 · 계좌 · 거래 · Alert · Episode 검색" className="h-9 rounded-full pl-9 pr-10 bg-muted/40" value={query}
            onFocus={() => setOpen(true)}
            onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(flat.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); flat[active]?.onSelect() }
              else if (e.key === 'Escape') { setOpen(false) }
            }}
          />
          <Kbd className="absolute right-2 top-2">/</Kbd>
        </div>
      </PopoverTrigger>
      <PopoverContent id="global-search-listbox" role="listbox" aria-label="검색 결과" className="w-(--radix-popper-anchor-width) max-w-[90vw] p-2" onOpenAutoFocus={e => e.preventDefault()}>
        {flat.length === 0
          ? <p className="text-xs text-muted-foreground p-4 text-center">{q ? '검색 결과가 없습니다.' : '검색어를 입력하세요.'}</p>
          : <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {groups.map(g => (
              <div key={g.id}>
                <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground">{g.label}</p>
                {g.items.map(item => {
                  const i = indexOf.get(item)!
                  return (
                    <button key={item.key} id={`gs-item-${i}`} role="option" aria-selected={i === active} type="button"
                      onMouseEnter={() => setActive(i)} onClick={item.onSelect}
                      className={`w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}>
                      <span className="truncate">{item.primary}</span>
                      {item.secondary && <span className="text-xs text-muted-foreground truncate shrink-0 max-w-[45%]">{item.secondary}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>}
      </PopoverContent>
    </Popover>
  )
}
