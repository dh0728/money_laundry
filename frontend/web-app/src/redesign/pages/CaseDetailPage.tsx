import { useState, type ReactNode } from 'react'
import { ArrowDownUp, ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, Calendar, ChevronDown, Download, Info, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CaseCard } from '../components/CaseCard'
import { DataTable, type Column } from '../components/DataTable'
import { GraphCanvas, GraphDetail, GraphSettings } from '../components/GraphBlock'
import { JudgeDialog, type JudgeDialogSpec } from '../components/JudgeDialog'
import { Panel } from '../components/Panel'
import { Button, SegmentedSwitch } from '../components/primitives'
import { ScoreTag, Tag } from '../components/tags'
import { accountRows, linkEvidence, relatedCandidates, txRows, type AccountRow, type TxRow } from '../data'
import { Shell } from '../layout/Shell'
import { hrefFor, type CaseKind, type CaseTab, type GraphView, type Route } from '../route'
import { Overview } from './Overview'
import { overviewTitles } from './overviewTitles'

// Alert·Episode 상세. 머리줄의 개요 / 분석 / 관련으로 화면을 바꾼다.
const episodeAlerts = ['A-261111-000003', 'A-261111-000001', 'A-261111-000007']

/** 위아래 패널 사이의 크기 조절 손잡이(시안의 resizeHandle). 지금은 모양만 있다. */
const ResizeHandle = () => <div aria-hidden className="flex h-3 w-full items-center"><i className="h-px w-full bg-(--rd-line)" /></div>
const downloadButton = (name: string) => <Button size="sm" aria-label={`${name} 내려받기`} iconStart={<Download />} className="[&_svg]:size-4" />

const amountCell = ([amount, count]: [string, string]) => <span className="flex w-full items-center justify-end gap-1">{amount}<Tag tone="black">{count}</Tag></span>
const txColumns = (kind: CaseKind): Column<TxRow>[] => [
  { key: 'id', header: '거래', minWidth: 200, grouped: true, sortable: true, cell: row => row.id },
  ...(kind === 'episode' ? [{ key: 'alert', header: 'Alert', minWidth: 200, grouped: true, sortable: true, cell: (row: TxRow) => row.alert }] : []),
  { key: 'time', header: '시각', width: 112, grouped: true, sortable: true, cell: row => row.time },
  { key: 'from', header: '송금 계좌', width: 176, grouped: true, sortable: true, cell: row => row.from },
  { key: 'to', header: '수취 계좌', width: 176, grouped: true, sortable: true, cell: row => row.to },
  { key: 'amount', header: '금액', width: 136, grouped: true, sortable: true, cell: row => row.amount },
  { key: 'method', header: '결제 수단', width: 136, grouped: true, sortable: true, cell: row => row.method },
  { key: 'score', header: '이상 점수', width: 136, grouped: true, sortable: true, cell: row => <ScoreTag level={row.score} solid /> },
  { key: 'reason', header: '편입 사유', width: 160, grouped: true, sortable: true, cell: row => <Tag tone={row.reasonTone === 'danger' ? 'negative' : 'unread'}>{row.reason}</Tag> },
  { key: 'other', header: '다른 사건', width: 136, grouped: true, sortable: true, cell: () => '—' },
  { key: 'state', header: '조사 상태', width: 168, grouped: true, sortable: true, cell: () => '조사 대상 · 미판정' },
]
const accountColumns: Column<AccountRow>[] = [
  { key: 'name', header: '계좌 · 소유주 · 은행', minWidth: 300, grouped: true, sortable: true, cell: row => <>{row.core && <Tag tone="negative">중심</Tag>}{row.name}</> },
  { key: 'role', header: '역할', width: 104, grouped: true, sortable: true, cell: row => <Tag tone="black">{row.role}</Tag> },
  { key: 'in', header: '유입', width: 160, grouped: true, sortable: true, cell: row => amountCell(row.inflow) },
  { key: 'out', header: '유출', width: 160, grouped: true, sortable: true, cell: row => amountCell(row.outflow) },
  { key: 'net', header: '순유입', width: 128, grouped: true, sortable: true, cell: row => row.net },
  { key: 'concentration', header: '집중도', width: 112, grouped: true, sortable: true, cell: row => row.concentration },
  { key: 'fast', header: '단시간 유출', width: 144, grouped: true, sortable: true, cell: row => row.fastOut },
  { key: 'baseline', header: '평소 대비', width: 184, grouped: true, sortable: true, cell: row => row.baseline },
  { key: 'peers', header: '새 상대방', width: 144, grouped: true, sortable: true, cell: row => (row.newPeers ? <Tag tone="black">{row.newPeers}</Tag> : '—') },
  { key: 'outside', header: '사건 밖 거래', minWidth: 160, grouped: true, sortable: true, cell: row => (row.outside ? <Tag tone="black">{row.outside}</Tag> : '—') },
  { key: 'past', header: '과거 사건', width: 136, grouped: true, sortable: true, cell: row => (row.past ? <Tag tone="black">{row.past}</Tag> : '—') },
]

function Analysis({ kind, id }: { kind: CaseKind; id: string }) {
  const alert = kind === 'alert'
  return (
    <div className="flex w-full flex-col gap-3 p-3">
      <Panel title="그래프" className="w-full">
        <div className="flex w-full items-stretch gap-2">
          <GraphSettings ids={alert ? [id] : episodeAlerts} withTools={!alert} />
          <GraphCanvas start={alert ? '09-24 12:00' : '09-01 08:40'} end={alert ? '09-24 18:00' : '09-05 14:20'} progress={alert ? '4 / 4건' : '29 / 29건'} />
          <GraphDetail />
        </div>
      </Panel>
      <ResizeHandle />
      <Panel title="거래" headerLeft={<Tag tone="muted">{alert ? '8건' : '29건'}</Tag>} headerRight={downloadButton('거래')} className="w-full">
        <DataTable label="거래" columns={txColumns(kind)} rows={txRows} rowKey={row => row.id} />
      </Panel>
      <Panel title="계좌" headerLeft={<Tag tone="muted">8개</Tag>} headerRight={downloadButton('계좌')} className="w-full">
        <DataTable label="계좌" columns={accountColumns} rows={accountRows} rowKey={row => row.name} />
      </Panel>
    </div>
  )
}

const dropdown = (label: string, icon: ReactNode) => (
  <Button size="sm" aria-label={label} iconStart={icon} iconEnd={<ChevronDown className="size-4" />} className="gap-2 [&_svg]:size-4" />
)

function Related({ kind, id, onBundle }: { kind: CaseKind; id: string; onBundle: (ids: string[]) => void }) {
  const alert = kind === 'alert'
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (card: string, next: boolean) => setSelected(current => { const copy = new Set(current); if (next) copy.add(card); else copy.delete(card); return copy })
  const candidates = relatedCandidates(id)
  const notice = alert
    ? '진행 중인 Episode 2개(E-261111-000008, E-261111-000009)와 이어집니다. Alert는 한 Episode에만 속할 수 있어 편입 대상은 하나만 고를 수 있습니다. Episode 병합은 지원하지 않습니다.'
    : `이 Episode에 묶인 Alert 3개(${episodeAlerts.join(', ')})와 이어지는 후보 Alert입니다. 이미 다른 Episode에 속한 Alert는 편입할 수 없고, Episode 병합은 지원하지 않습니다.`
  return (
    <div className="flex h-full min-h-[760px] w-full gap-4 p-3">
      <Panel title={alert ? '연관 후보' : '추가 후보 Alert'} className="h-full w-[520px] shrink-0" contentClassName="gap-3"
        headerLeft={alert ? <Tag tone="muted">후보 {candidates.length + 1}</Tag> : undefined}
        headerRight={<>{dropdown('필터', <ListFilter />)}{dropdown('정렬', <ArrowDownUp />)}{dropdown('기간', <Calendar />)}</>}>
        <div className="flex w-full items-center gap-3 px-2">
          <Info className="size-4 shrink-0 text-(--rd-strong)" />
          <p className="text-[14px] leading-[1.4] text-(--rd-caution-text)">{notice}</p>
        </div>
        {selected.size > 0 && (
          <div className="flex w-full items-center justify-between">
            <p className="text-[12px] text-(--rd-strong)">{selected.size}건 선택</p>
            <Button tone="brand" onClick={() => onBundle([...selected])}>판정</Button>
          </div>
        )}
        <div className="rd-scroll-thin flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {candidates.map(card => <CaseCard key={card.id} card={card} selected={selected.has(card.id)} onSelect={next => toggle(card.id, next)} />)}
        </div>
      </Panel>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Panel title="합친 그래프" className="w-full flex-1">
          <div className="flex w-full flex-1 items-stretch gap-2">
            <GraphSettings ids={alert ? [id, 'A-261111-001051'] : ['A-261111-001051']} />
            <GraphCanvas start={alert ? '09-24 12:00' : '09-01 08:40'} end={alert ? '09-24 18:00' : '09-09 18:00'} progress={alert ? '4 / 4건' : '34 / 34건'}
              chips={<><Tag tone={alert ? 'black' : 'brand'}>{id} (지금 보는 {alert ? 'Alert' : 'Episode'})</Tag><Tag tone={alert ? 'black' : 'brand'}>A-261111-001051{alert ? '' : ' (추가 후보)'}</Tag></>} />
          </div>
        </Panel>
        <ResizeHandle />
        <Panel title="연결 근거" className="w-full" headerLeft={<><span className="whitespace-nowrap text-[12px] text-(--rd-danger)">돈으로 이어짐 · 강</span><Tag tone="muted">관측</Tag></>}>
          <div role="table" aria-label="연결 근거" className="flex w-full flex-col text-[12px] leading-[1.4] text-(--rd-strong)">
            <div role="row" className="grid grid-cols-[64px_240px_1fr_48px] gap-x-3 px-2 py-2 font-semibold"><span role="columnheader">종류</span><span role="columnheader">대상</span><span role="columnheader">내용</span><span role="columnheader">강도</span></div>
            {linkEvidence(id).map(row => (
              <div key={row.target} role="row" className="grid grid-cols-[64px_240px_1fr_48px] items-center gap-x-3 px-2 py-2">
                <span role="cell">{row.kind}</span><span role="cell">{row.target}</span><span role="cell">{row.detail}</span><span role="cell">{row.strength}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

/** 패널 하나씩 보기의 쪽 넘김 (시안 panelPager) */
function PanelPager({ titles, index, onIndex }: { titles: readonly string[]; index: number; onIndex: (next: number) => void }) {
  const last = titles.length - 1
  return (
    <div className="w-full shrink-0 bg-(--rd-bg) px-3 pb-3">
      <div className="flex h-[50px] w-full items-center justify-between rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) px-2">
        <div className="flex items-center gap-2">
          <Button aria-label="첫 패널" disabled={index === 0} onClick={() => onIndex(0)} iconStart={<ArrowLeftToLine />} />
          <Button aria-label="이전 패널" disabled={index === 0} onClick={() => onIndex(index - 1)} iconStart={<ArrowLeft />} />
        </div>
        <p className={cn('text-[14px] font-medium text-(--rd-ink)')}>{index + 1} / {titles.length} · {titles[index]}</p>
        <div className="flex items-center gap-2">
          <Button aria-label="다음 패널" disabled={index === last} onClick={() => onIndex(index + 1)} iconStart={<ArrowRight />} />
          <Button aria-label="마지막 패널" disabled={index === last} onClick={() => onIndex(last)} iconStart={<ArrowRightToLine />} />
        </div>
      </div>
    </div>
  )
}

function dialogSpec(kind: CaseKind, id: string, bundle: string[] | null): JudgeDialogSpec {
  if (bundle) {
    return { mode: 'bundle', title: '묶기', description: `Alert ${bundle.length + 1}건 · 판정 전에 묶어 비교해요`, targets: [`${id} · 기준 Alert · Fan-in`, ...bundle.map(item => `${item} · Fan-out`)], noteLabel: '묶는 이유', notePlaceholder: '이유를 적어 주세요' }
  }
  return kind === 'alert'
    ? { mode: 'judge', title: '판정', description: '단일 Alert', targets: [`${id} · Fan-in 61%`], noteLabel: '설명', notePlaceholder: '사유를 적어 주세요' }
    : { mode: 'judge', title: 'Episode 판정', description: `${id} · 소속 Alert 3건을 함께 판정해요`, targets: ['A-261111-000001 · 허브 계좌 집중 유입', 'A-261111-000002 · 단기 분할 송금', 'A-261111-000003 · 신규 계좌 고액 유출'], noteLabel: '분석가 의견', notePlaceholder: '사유를 적어 주세요' }
}

type CaseDetailProps = { route: Route; kind: CaseKind; id: string; tab: CaseTab; view: GraphView }

export function CaseDetailPage({ route, kind, id, tab, view }: CaseDetailProps) {
  const [focus, setFocus] = useState<number | null>(null)
  const [dialog, setDialog] = useState<{ bundle: string[] | null } | null>(null)
  const titles = overviewTitles[kind]
  const to = (nextTab: CaseTab, nextView: GraphView = view) => hrefFor({ page: 'case', kind, id, tab: nextTab, view: nextView })

  return (
    <Shell route={route}
      headerLeft={
        <>
          <SegmentedSwitch label="상세 보기" value={tab} items={[{ key: 'overview', label: '개요', href: to('overview') }, { key: 'analysis', label: '분석', href: to('analysis') }, { key: 'related', label: '관련', href: to('related') }]} />
          {tab !== 'overview' && (
            <SegmentedSwitch label="그래프 묶는 기준" value={view} items={[{ key: 'pattern', label: '패턴별 보기', href: to(tab, 'pattern') }, { key: 'owner', label: '소유주별 보기', href: to(tab, 'owner') }]} />
          )}
        </>
      }
      headerRight={<Button tone="brand" onClick={() => setDialog({ bundle: null })}>판정</Button>}
      footer={tab === 'overview' && focus !== null ? <PanelPager titles={titles} index={focus} onIndex={setFocus} /> : undefined}>
      {tab === 'overview' && <Overview kind={kind} focus={focus} onFocus={setFocus} />}
      {tab === 'analysis' && <Analysis kind={kind} id={id} />}
      {tab === 'related' && <Related kind={kind} id={id} onBundle={bundle => setDialog({ bundle })} />}
      {dialog && <JudgeDialog spec={dialogSpec(kind, id, dialog.bundle)} onClose={() => setDialog(null)} />}
    </Shell>
  )
}
