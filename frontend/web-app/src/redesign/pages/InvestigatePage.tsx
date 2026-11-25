import { useState, type ReactNode } from 'react'
import { ArrowDownUp, Calendar, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CaseCard } from '../components/CaseCard'
import { DataTable, type Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { Button, SegmentedSwitch } from '../components/primitives'
import { AssigneeTag, ElapsedTag, FilterTag, PatternTag, ScoreTag, StatusTag, Tag, VerdictTag } from '../components/tags'
import { accounts, alertCards, alertRows, episodeCards, episodeRows, linkedCases, owners, transactions, type AlertRow, type CaseCardData, type EpisodeRow } from '../data'
import { Shell } from '../layout/Shell'
import { caseHref, hrefFor, type InvestigateTab, type ListView, type Route } from '../route'

// Figma "AddTab" 섹션: 조사 대상을 찾아 사이드바 탭으로 추가하는 화면

function ListToolbar({ count, filter, dateLabel }: { count: string; filter: string; dateLabel: string }) {
  const [filtered, setFiltered] = useState(true)
  return (
    <div className="flex h-8 w-full shrink-0 items-center gap-2">
      <Tag tone="count">{count}</Tag>
      {filtered && <FilterTag label={filter} onDismiss={() => setFiltered(false)} />}
      <div className="h-px min-w-px flex-1" />
      <Button aria-label="필터" iconStart={<ListFilter />} />
      <Button aria-label="정렬" iconStart={<ArrowDownUp />} />
      <Button iconStart={<Calendar />}>{dateLabel}</Button>
    </div>
  )
}

function CardGrid({ cards, selectable = false, dense = false }: { cards: CaseCardData[]; selectable?: boolean; dense?: boolean }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string, next: boolean) => setSelected(current => { const copy = new Set(current); if (next) copy.add(id); else copy.delete(id); return copy })
  return (
    <div className={cn('grid w-full gap-3', dense ? 'grid-cols-[repeat(auto-fill,minmax(300px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(380px,1fr))]')}>
      {cards.map(card => <CaseCard key={card.id} card={card} selected={selected.has(card.id)} onSelect={selectable ? next => toggle(card.id, next) : undefined} />)}
    </div>
  )
}

const patternCells = (patterns: string[]) => patterns.map(pattern => <PatternTag key={pattern} code="FAN-OUT" detail={pattern} />)
const sharedColumns = <Row extends AlertRow | EpisodeRow>(): Column<Row>[] => [
  { key: 'id', header: 'ID', minWidth: 150, cell: row => row.id },
  { key: 'pattern', header: '패턴', width: 363, cell: row => patternCells(row.patterns) },
  { key: 'score', header: '점수', width: 108, sortable: true, cell: row => <ScoreTag level={row.score} solid /> },
  { key: 'assignee', header: '담당자', width: 148, cell: row => <AssigneeTag name={row.assignee} /> },
  { key: 'status', header: '상태', width: 112, cell: row => row.status && <StatusTag status={row.status} tone={row.status === 'inProgress' ? 'brand' : undefined} /> },
  { key: 'elapsed', header: '경과일', width: 128, sortable: true, cell: row => row.elapsed && <ElapsedTag days={row.elapsed.days} level={row.elapsed.level} /> },
  { key: 'accounts', header: '계좌', minWidth: 250, cell: row => row.accounts },
  { key: 'period', header: '기간', width: 268, cell: row => row.period },
]
const alertColumns: Column<AlertRow>[] = [
  ...sharedColumns<AlertRow>(),
  { key: 'tx', header: '거래', width: 80, cell: row => row.tx },
  { key: 'amount', header: '금액', width: 161, sortable: true, cell: row => row.amount },
]
const episodeColumns: Column<EpisodeRow>[] = [
  ...sharedColumns<EpisodeRow>().map(column => (column.key === 'period' ? { ...column, width: 240 } : column)),
  { key: 'alerts', header: 'Alert', width: 64, cell: row => row.alerts },
  { key: 'related', header: '관련 계좌', width: 90, cell: row => row.relatedAccounts },
  { key: 'tx', header: '거래', width: 64, cell: row => row.tx },
  { key: 'amount', header: '금액', width: 140, cell: row => row.amount },
]

function CaseList({ tab, view }: { tab: 'alerts' | 'episodes'; view: ListView }) {
  const alerts = tab === 'alerts'
  const title = alerts ? 'Alert 목록' : 'Episode 목록'
  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3">
      <ListToolbar count={alerts ? '24건' : '6건'} filter={alerts ? '내 담당' : '사람 판정 이상만'} dateLabel={alerts && view === 'table' ? '기간' : '최근 7일'} />
      <Panel title={title} className="w-full flex-1">
        {view === 'cards'
          ? <CardGrid cards={alerts ? alertCards : episodeCards} />
          : alerts
            ? <DataTable label={title} columns={alertColumns} rows={alertRows} rowKey={row => row.id} rowHref={row => caseHref(row.id)} />
            : <DataTable label={title} columns={episodeColumns} rows={episodeRows} rowKey={row => row.id} rowHref={row => caseHref(row.id)} />}
      </Panel>
    </div>
  )
}

// ── 소유주·계좌·거래 ─────────────────────────────────────────────────────
function PickItem({ selected, onPick, children }: { selected: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick}
      className={cn('flex h-[46px] w-full shrink-0 cursor-pointer items-center gap-2 rounded-[6px] border px-3 text-left text-[14px] font-medium', selected ? 'border-(--rd-accent) bg-(--rd-accent) text-(--rd-inv)' : 'border-(--rd-mute) bg-(--rd-bg) text-(--rd-strong) hover:bg-(--rd-hover)')}>
      {children}
    </button>
  )
}

/** 고른 항목을 맨 위에 두고 선으로 나눈 뒤 나머지를 잇는 시안의 목록 */
function PickList({ items, picked, onPick, role }: { items: string[]; picked: string; onPick: (item: string) => void; role: string }) {
  const row = (item: string) => (
    <PickItem key={item} selected={item === picked} onPick={() => onPick(item)}>
      <span>{item}</span>
      {item === picked && <VerdictTag verdict="abnormal" />}
      <Tag tone={item === picked ? 'neutral' : 'black'}>{role}</Tag>
    </PickItem>
  )
  return (
    <div className="flex w-full flex-col gap-2">
      {row(picked)}
      <div className="h-px w-full bg-(--rd-line)" />
      {items.filter(item => item !== picked).map(row)}
    </div>
  )
}

function TransactionItem({ id, selected, onPick }: { id: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick}
      className={cn('flex w-full shrink-0 cursor-pointer flex-col gap-2 rounded-[8px] border p-2 text-left', selected ? 'border-(--rd-accent) bg-(--rd-accent) text-(--rd-inv)' : 'border-(--rd-line) bg-(--rd-subtle) text-(--rd-strong) hover:bg-(--rd-hover)')}>
      <div className="flex items-center gap-2 px-1 text-[14px] font-medium">
        <span>{id}</span>
        <VerdictTag verdict="abnormal" />
        <Tag tone={selected ? 'neutral' : 'black'}>송금</Tag>
      </div>
      <div className="flex w-full items-center">
        <div className="rd-mono flex w-[104px] shrink-0 flex-col items-center rounded-[6px] bg-(--rd-danger) px-3 py-2 text-[14px] leading-[1.5] text-(--rd-inv)"><span>소유주-001</span><span>ACC-1001</span></div>
        <div className="relative flex min-w-0 flex-1 flex-col items-end gap-2 py-1 pl-4">
          <i className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-(--rd-negative-solid)" />
          <span className="rd-mono text-[12px]">2026-09-24 10:20</span>
          <span className="rd-mono text-[12px]">Wire · 61,300 USD</span>
        </div>
      </div>
    </button>
  )
}

function Entities() {
  const [owner, setOwner] = useState(owners[0])
  const [account, setAccount] = useState(accounts[0])
  const [transaction, setTransaction] = useState(transactions[0])
  return (
    <div className="flex h-full min-h-[640px] w-full gap-4 p-4">
      <Panel title="소유주" headerLeft={<Tag tone="muted">5명</Tag>} className="h-full w-[372px] shrink-0" contentClassName="overflow-y-auto rd-scroll-thin">
        <PickList items={owners} picked={owner} onPick={setOwner} role="수취" />
      </Panel>
      <Panel title="계좌" headerLeft={<Tag tone="muted">3개</Tag>} className="h-full w-[372px] shrink-0" contentClassName="overflow-y-auto rd-scroll-thin">
        <PickList items={accounts} picked={account} onPick={setAccount} role="수취" />
      </Panel>
      <Panel title="거래" headerLeft={<Tag tone="muted">5건</Tag>} className="h-full w-[372px] shrink-0" contentClassName="overflow-y-auto rd-scroll-thin">
        {transactions.map(id => <TransactionItem key={id} id={id} selected={id === transaction} onPick={() => setTransaction(id)} />)}
      </Panel>
      <Panel title="선택 거래와 연결된 Alert·Episode" className="h-full min-w-[420px] flex-1" contentClassName="overflow-y-auto rd-scroll-thin"
        headerRight={<><Button size="sm" aria-label="필터" iconStart={<ListFilter />} className="[&_svg]:size-4" /><Button size="sm" aria-label="정렬" iconStart={<ArrowDownUp />} className="[&_svg]:size-4" /></>}>
        <CardGrid cards={linkedCases} selectable dense />
      </Panel>
    </div>
  )
}

export function InvestigatePage({ route, tab, view }: { route: Route; tab: InvestigateTab; view: ListView }) {
  return (
    <Shell route={route} headerLeft={
      <>
        <SegmentedSwitch label="조사 대상" value={tab} items={[
          { key: 'entities', label: '소유주·계좌·거래', href: hrefFor({ page: 'investigate', tab: 'entities', view }) },
          { key: 'alerts', label: 'Alert 목록', href: hrefFor({ page: 'investigate', tab: 'alerts', view }) },
          { key: 'episodes', label: 'Episode 목록', href: hrefFor({ page: 'investigate', tab: 'episodes', view }) },
        ]} />
        {tab !== 'entities' && (
          <SegmentedSwitch label="보기 방식" value={view} items={[
            { key: 'cards', label: '카드 보기', href: hrefFor({ page: 'investigate', tab, view: 'cards' }) },
            { key: 'table', label: '표 보기', href: hrefFor({ page: 'investigate', tab, view: 'table' }) },
          ]} />
        )}
      </>
    }>
      {tab === 'entities' ? <Entities /> : <CaseList key={`${tab}-${view}`} tab={tab} view={view} />}
    </Shell>
  )
}
