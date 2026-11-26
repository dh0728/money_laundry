import type { ReactNode } from 'react'
import { ListFilter } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { Button } from '../components/primitives'
import { KpiCard } from '../components/summary'
import { Tag } from '../components/tags'
import { backtestCases, backtestKpis, backtestTarget, caseKindLabel, sensitivityRows, type BacktestCase, type SensitivityRow } from './data'
import { Dropdown } from './Dropdown'
import type { Backtest } from './state'

// Figma "screen/rule-engine/draft-backtest": 새 버전을 과거 거래에 돌려 운영 버전과 견준다

const sensitivityColumns: Column<SensitivityRow>[] = [
  { key: 'threshold', header: '송금 계좌 수', minWidth: 200, cell: row => row.threshold },
  { key: 'subjects', header: '적중 대상', width: 80, cell: row => row.subjects },
  { key: 'evidence', header: '근거 거래', width: 80, cell: row => row.evidence },
  { key: 'overlap', header: '모델 Alert 겹침', width: 117, cell: row => row.overlap },
  { key: 'newAlerts', header: '예상 새 Alert', width: 104, cell: row => row.newAlerts },
]

const caseColumns: Column<BacktestCase>[] = [
  { key: 'account', header: '대상', width: 130, sortable: true, cell: row => `${row.account} · ${row.role}` },
  { key: 'kind', header: '구분', width: 85, sortable: true, cell: row => <Tag tone={row.kind === 'added' ? 'unread' : 'negative'}>{caseKindLabel[row.kind]}</Tag> },
  { key: 'evidence', header: '근거', minWidth: 220, sortable: true, cell: row => row.evidence },
  { key: 'alert', header: 'Alert', minWidth: 220, sortable: true, cell: row => row.alert },
  { key: 'verdict', header: '사람 판정', width: 100, sortable: true, cell: row => row.verdict },
]

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-2 text-[14px] leading-[1.4]">
      <p className="shrink-0 whitespace-nowrap text-(--rd-mute)">{name}</p>
      <p className="min-w-px flex-1 text-(--rd-strong)">{children}</p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-full shrink-0 flex-col items-start gap-1">
      <p className="w-full text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{title}</p>
      {children}
    </div>
  )
}

type Actions = { onStartTrial: () => void; onRequestApproval: () => void }

function CasePanel({ item, backtest, onStartTrial, onRequestApproval }: { item: BacktestCase; backtest: Backtest } & Actions) {
  const { detail } = item
  return (
    <Panel title={`${item.account} · ${item.role} 계좌`} shrinkTitle onClose={() => backtest.selectCase(null)} className="absolute inset-0" contentClassName="rd-scroll-thin overflow-y-auto"
      headerLeft={<Tag tone={item.kind === 'added' ? 'cautionSubtle' : 'gray'}>{caseKindLabel[item.kind]}</Tag>}
      footer={<>
        <Button tone="gray" className="font-medium" onClick={onStartTrial}>시험 운영 시작</Button>
        <Button tone="brand" className="font-medium" onClick={onRequestApproval}>승인 요청</Button>
      </>}>
      <Group title="Alert 요약">
        <Field name="Alert">{item.alert} · 모델 위험도 {detail.risk}</Field>
        <Field name="기간">{detail.period}</Field>
        <Field name="근거">{detail.evidence}</Field>
        <Field name="판정">{item.verdict} · {detail.judge}</Field>
      </Group>
      {detail.overlap && (
        <Group title="다른 룰과 겹침">
          <div className="flex w-full items-center gap-2">
            <Tag tone="cautionSubtle">{detail.overlap.rule}</Tag>
            <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{detail.overlap.text}</p>
          </div>
        </Group>
      )}
      <Group title="실행 기록">
        {backtest.runs.map((run, index) => <Field key={index} name={run.when}>{run.text}</Field>)}
      </Group>
    </Panel>
  )
}

export function RuleBacktestView({ backtest, onStartTrial, onRequestApproval }: { backtest: Backtest } & Actions) {
  const selected = backtestCases.find(item => item.account === backtest.caseId)
  const count = (kind: BacktestCase['kind']) => backtestCases.filter(item => item.kind === kind).length

  return (
    <div className="flex min-h-full w-full flex-col items-start gap-4 p-3">
      <div className="flex w-full shrink-0 items-center gap-2">
        <Dropdown label="백테스트할 룰 버전" tone="black" value={backtestTarget.key} options={[{ key: backtestTarget.key, label: backtestTarget.label }]} onChange={() => {}} />
        <Tag tone="neutral">{backtestTarget.base}</Tag>
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-stretch gap-2">
        {backtestKpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi} className="min-h-[148px] min-w-[160px] flex-1" />)}
      </div>
      <div className="flex min-h-[640px] w-full flex-1 items-stretch gap-4">
        <Panel title="백테스트" className="min-w-0 flex-1">
          <div className="flex w-full flex-1 flex-col items-start gap-4">
            <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{backtestTarget.scope}</p>
            <p className="w-full text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">값을 바꾸면 어떻게 달라지나</p>
            <DataTable bordered label="값을 바꿨을 때 적중 변화" columns={sensitivityColumns} rows={sensitivityRows} rowKey={row => row.threshold} />
            <div className="flex w-full items-center gap-2">
              <p className="text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">사례</p>
              <Tag tone="infoSubtle">{caseKindLabel.added} {count('added')}</Tag>
              <Tag tone="gray">{caseKindLabel.dropped} {count('dropped')}</Tag>
              <div className="h-px min-w-px flex-1" />
              <Button size="sm" aria-label="사례 필터" iconStart={<ListFilter />} />
            </div>
            <DataTable bordered label="달라진 사례" columns={caseColumns} rows={backtestCases} rowKey={row => row.account}
              onRowClick={row => backtest.selectCase(row.account)} activeKey={backtest.caseId ?? undefined} />
          </div>
        </Panel>
        {/* 시안의 사례 패널도 높이 338 에 내용이 잘려 있어, 옆 패널과 같은 높이로 두고 안에서 스크롤한다 */}
        {selected && (
          <div className="relative w-[372px] shrink-0">
            <CasePanel item={selected} backtest={backtest} onStartTrial={onStartTrial} onRequestApproval={onRequestApproval} />
          </div>
        )}
      </div>
    </div>
  )
}
