import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DataTable, type Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { Button, ButtonLink } from '../components/primitives'
import { AssigneeTag, Tag, type TagTone } from '../components/tags'
import { hrefFor } from '../route'
import type { LogItem, MiniLine, RuleRow } from './data'
import { actionLabel, statusLabel, statusOrder, statusTone, type RuleAction, type RuleStatus } from './model'
import { ReasonDialog } from './ReasonDialog'
import { RiskBandPanel } from './RiskBandPanel'
import type { RuleList } from './state'

// Figma "screen/rule-engine/draft-list": 위험 점수 구간 + 룰 표 + 고른 룰의 상세

// ── 룰 표 ───────────────────────────────────────────────────────────────
type SortKey = 'status' | 'name' | 'alerts' | 'falsePositive' | 'lastHit' | 'version' | 'owner'
type Sort = { key: SortKey; descending: boolean }
const sortValue: Record<SortKey, (row: RuleRow) => string | number> = {
  status: row => statusOrder.indexOf(row.status),
  name: row => row.id,
  alerts: row => row.alerts,
  // 판정이 아직 없는 룰은 어느 쪽으로 정렬해도 맨 아래에 둔다(아래 sorted 에서 따로 처리)
  falsePositive: row => row.falsePositive ?? 0,
  lastHit: row => row.lastHit,
  version: row => row.version,
  owner: row => row.owner,
}
function sorted(rows: RuleRow[], sort: Sort | null): RuleRow[] {
  if (!sort) return rows
  const value = sortValue[sort.key]
  return [...rows].sort((a, b) => {
    if (sort.key === 'falsePositive' && (a.falsePositive == null) !== (b.falsePositive == null)) return a.falsePositive == null ? 1 : -1
    const left = value(a), right = value(b)
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ko')
    return sort.descending ? -order : order
  })
}

const columns: Column<RuleRow>[] = [
  { key: 'status', header: '상태', width: 85, sortable: true, cell: row => <Tag tone={statusTone[row.status]}>{statusLabel[row.status]}</Tag> },
  { key: 'name', header: '룰 이름 · 패턴', minWidth: 320, sortable: true, cell: row => `${row.id} ${row.name} · ${row.pattern}` },
  { key: 'alerts', header: '연결 Alert', width: 108, sortable: true, cell: row => row.alerts },
  { key: 'falsePositive', header: '정상 판정(오탐)', width: 137, sortable: true, cell: row => (row.falsePositive == null ? '—' : `${row.falsePositive}%`) },
  { key: 'lastHit', header: '마지막 적중', width: 113, sortable: true, cell: row => row.lastHit },
  { key: 'version', header: '버전', width: 71, sortable: true, cell: row => `v${row.version}` },
  { key: 'owner', header: '담당자', width: 148, sortable: true, cell: row => <AssigneeTag name={row.owner} /> },
]

function RuleListPanel({ list, className }: { list: RuleList; className?: string }) {
  const [sort, setSort] = useState<Sort | null>(null)
  const rows = useMemo(() => sorted(list.rows, sort), [list.rows, sort])
  const counts = statusOrder.map(status => ({ status, count: list.rows.filter(row => row.status === status).length })).filter(item => item.count > 0)
  // 같은 열을 다시 누르면 방향을 뒤집는다
  const onSort = (key: string) => setSort(current => ({ key: key as SortKey, descending: current?.key === key && !current.descending }))

  return (
    <Panel title="룰" className={className}>
      <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-4">
        <div className="flex w-full items-center gap-2">
          <Tag tone="inverse">{list.rows.length}개</Tag>
          <div className="h-px min-w-px flex-1" />
          {counts.map(item => <Tag key={item.status} tone={statusTone[item.status]}>{statusLabel[item.status]} {item.count}</Tag>)}
        </div>
        <DataTable label="룰 목록" columns={columns} rows={rows} rowKey={row => row.id} onRowClick={row => list.select(row.id)} activeKey={list.selectedId ?? undefined} onSort={onSort} />
      </div>
    </Panel>
  )
}

// ── 상세 패널 ───────────────────────────────────────────────────────────
function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col items-start gap-2', className)}>
      <p className="w-full text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{title}</p>
      {children}
    </div>
  )
}

function VersionLine({ tone, tag, text }: { tone: TagTone; tag: string; text: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <Tag tone={tone}>{tag}</Tag>
      <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-strong)">{text}</p>
    </div>
  )
}

const treeTone: Record<NonNullable<MiniLine['tag']>, TagTone> = { WHEN: 'brandBase', ALL: 'infoSubtle', ANY: 'pendingSubtle', THEN: 'positiveSolid' }
function MiniTree({ lines }: { lines: MiniLine[] }) {
  return (
    <div className="flex w-full flex-col items-start gap-1 rounded-[4px] bg-(--rd-subtle) p-2">
      {lines.map((line, index) => line.tag ? (
        <div key={index} className={cn('flex w-full items-center gap-2', line.indent && 'pl-4')}>
          <Tag tone={treeTone[line.tag]}>{line.tag}</Tag>
          <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{line.text}</p>
        </div>
      ) : (
        <p key={index} className="w-full text-[14px] leading-[1.4] text-(--rd-strong)">{line.text}</p>
      ))}
    </div>
  )
}

function LogList({ title, items }: { title: string; items: LogItem[] }) {
  return (
    <Group title={title} className="shrink-0">
      <div className="flex w-full flex-col items-start gap-1">
        {items.map((item, index) => (
          <div key={index} className="flex w-full items-start gap-2 text-[14px] leading-[1.4]">
            <p className="shrink-0 whitespace-nowrap text-(--rd-mute)">{item.when}</p>
            <p className="min-w-px flex-1 text-(--rd-strong)">{item.text}</p>
          </div>
        ))}
      </div>
    </Group>
  )
}

/** 상태마다 할 수 있는 일. 승인 대기(시안)에는 셋 다 있다. */
const actionsOf: Record<RuleStatus, RuleAction[]> = { pending: ['pause', 'reject', 'approve'], active: ['pause'], trial: ['pause'], paused: [], draft: [] }

function RuleDetailPanel({ rule, onAct, onClose }: { rule: RuleRow; onAct: (action: RuleAction) => void; onClose: () => void }) {
  const { detail } = rule
  return (
    <Panel title={`${rule.id} ${rule.name}`} shrinkTitle onClose={onClose} className="absolute inset-0" contentClassName="rd-scroll-thin overflow-y-auto"
      headerLeft={<><Tag tone={statusTone[rule.status]}>{statusLabel[rule.status]}</Tag><Tag tone="gray">v{rule.version}</Tag></>}
      footer={<>
        <ButtonLink tone="gray" className="font-medium" href={hrefFor({ page: 'rules', tab: 'create' })}>복제</ButtonLink>
        <ButtonLink tone="gray" className="font-medium" href={hrefFor({ page: 'rules', tab: 'backtest' })}>백테스트로 열기</ButtonLink>
        {actionsOf[rule.status].map(action => (
          <Button key={action} tone={action === 'approve' ? 'brand' : 'danger'} className="font-medium" onClick={() => onAct(action)}>{actionLabel[action]}</Button>
        ))}
      </>}>
      {detail.notice && (
        <div className="flex w-full shrink-0 items-center gap-2 rounded-[8px] bg-(--rd-info-subtle) p-2">
          <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-caution-text)">{detail.notice}</p>
        </div>
      )}
      {detail.change && (
        <Group title="변경 전후 조건" className="shrink-0">
          <VersionLine tone="gray" tag={detail.change.before.tag} text={detail.change.before.text} />
          <VersionLine tone="selected" tag={detail.change.after.tag} text={detail.change.after.text} />
        </Group>
      )}
      <Group title="조건 트리" className="shrink-0"><MiniTree lines={detail.tree} /></Group>
      {detail.backtest && (
        <Group title={detail.backtest.title} className="shrink-0">
          <div className="flex w-full items-start gap-2">
            {detail.backtest.stats.map(stat => (
              <div key={stat.label} className="flex flex-auto flex-col items-start gap-[2px] whitespace-nowrap leading-[1.4] text-(--rd-strong)">
                <p className="w-full text-[14px]">{stat.label}</p>
                <p className="w-full text-[16px] font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>
        </Group>
      )}
      {/* 시안은 두 기록을 옆으로 나란히 두지만 370 폭에서는 글이 두세 줄로 꺾여, 위아래로 놓았다 */}
      <LogList title="버전 이력" items={detail.versions} />
      <LogList title="변경 기록" items={detail.changes} />
    </Panel>
  )
}

export function RuleListView({ list }: { list: RuleList }) {
  const [asking, setAsking] = useState<RuleAction | null>(null)
  const rule = list.rows.find(row => row.id === list.selectedId)

  return (
    <div className="flex min-h-full w-full flex-col items-start gap-4 p-3">
      <RiskBandPanel saved={list.bands} onSave={list.saveBands} className="h-[338px] w-full shrink-0" />
      <div className="flex min-h-[654px] w-full flex-1 items-stretch gap-4">
        <RuleListPanel list={list} className="min-w-0 flex-1" />
        {/* 시안의 상세 패널은 높이 338 에 내용이 잘려 있다. 여기서는 옆 패널과 같은 높이로 두고 안에서 스크롤한다. */}
        {rule && (
          <div className="relative w-[372px] shrink-0">
            <RuleDetailPanel rule={rule} onAct={setAsking} onClose={() => list.select(null)} />
          </div>
        )}
      </div>
      {rule && asking && (
        <ReasonDialog action={asking} target={rule.id} onClose={() => setAsking(null)}
          onConfirm={reason => { list.act(rule.id, asking, reason); setAsking(null) }} />
      )}
    </div>
  )
}
