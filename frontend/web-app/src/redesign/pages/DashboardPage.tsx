import { useState, type ReactNode } from 'react'
import { ArrowDownUp, Calendar, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CaseCard } from '../components/CaseCard'
import { Panel } from '../components/Panel'
import { Button, Checkbox, SegmentedSwitch } from '../components/primitives'
import { AiSummary, KpiCard, type AiSummaryData, type Kpi } from '../components/summary'
import { StatusTag, Tag, type TagTone } from '../components/tags'
import { myBoard, workBoard } from '../data'
import { Shell } from '../layout/Shell'
import { hrefFor, type DashboardScope, type Route } from '../route'

const mySummary: AiSummaryData = {
  headline: '최근 7일 내 담당 Alert 증가, Fan-in 집중 수취가 가장 많음',
  chartLabel: '최근 7일 내 담당 Alert', chartValue: '9 → 19건', bars: [15, 19, 13, 17, 22, 27, 32], axis: ['11/5', '11/11'],
  points: [{ icon: 'alert', text: '고위험 중 Fan-in 건부터 판정 권장' }, { icon: 'up', text: '11/9부터 늘어 7일 전의 약 2배' }, { icon: 'down', text: 'Fan-in 6건이 수취 계좌 2곳으로 모임' }],
  patterns: ['FAN-IN 64%', 'FAN-OUT 21%', 'CYCLE 9%'],
}
const myKpis: Kpi[] = [
  { label: '위험 점수 0.90 이상', value: '10', caption: '처리 전 Alert', note: '판정이 급한 고위험 건' },
  { label: '3일 이상 경과', value: '8', caption: 'Alert 8 · Episode 0', note: '처리 전·처리 중 업무 중 오래 머문 건' },
]
// 보드 머리의 "열람 전"은 시안에서 danger 빨강이다(표에서는 주황)
const boardTone: Partial<Record<string, TagTone>> = { unread: 'danger' }

function MyDashboard() {
  return (
    <div className="flex w-full flex-col gap-4 p-3">
      <div className="flex h-[284px] w-full gap-4">
        <AiSummary data={mySummary} className="w-[684px] shrink-0" />
        <div className="flex min-w-0 flex-1 gap-4">
          {myKpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi} className="min-w-0 flex-1" />)}
        </div>
      </div>
      <div className="grid w-full grid-cols-4 gap-4">
        {myBoard.map(column => (
          <section key={column.status} aria-label={column.status} className="flex min-w-0 flex-col gap-3 pb-4 pt-4">
            <div className="flex h-5 items-center gap-1 px-2">
              <StatusTag status={column.status} tone={boardTone[column.status]} />
              <Tag tone="count">{column.count}</Tag>
            </div>
            {column.cards.map(card => <CaseCard key={card.id} card={card} />)}
          </section>
        ))}
      </div>
    </div>
  )
}

const allSummary: AiSummaryData = {
  headline: '고위험 Alert가 이틀째 늘고, Fan-out 비중이 가장 커짐',
  chartLabel: '최근 7일 고위험 Alert(0.90 이상)', chartValue: '14 → 31건', bars: [15, 19, 13, 17, 22, 27, 32], axis: ['11/5', '11/11'],
  points: [{ icon: 'alert', text: '오늘 고위험 31건 중 19건이 새 계좌 거래 포함' }, { icon: 'up', text: 'Fan-out이 지난주보다 늘어 가장 큰 유형' }, { icon: 'down', text: '같은 수취 계좌가 은행 3곳에서 반복 등장' }],
  patterns: ['FAN-IN Fan-out 58%', 'FAN-OUT Gather-scatter 23%', 'CYCLE Bipartite 11%'],
}
const topKpis: Kpi[] = [
  { label: '들어온 거래 수', value: '48,210', caption: '전일 대비 +3.4%', note: '오늘 은행 배치로 수신·통합된 거래' },
  { label: '세탁 의심 / 전체 거래', value: '1,287', unit: '/ 48,210', caption: '의심 비율 2.7%', note: '모델이 의심으로 판별한 거래 ÷ 들어온 거래' },
  { label: '새 계좌 · 새 소유주', value: '412 · 156', caption: '오늘 처음 등장', note: '이전 거래 이력이 없는 계좌와 소유주' },
]
const bottomKpis: Kpi[] = [
  { label: '오늘 유입 Alert', delta: { text: '-8%', good: true }, value: '128', caption: '전일 대비', note: '모델이 의심으로 판별한 신규 Alert' },
  { label: '30일 Alert 처리율', delta: { text: '+2.1%p', good: true }, value: '74.5%', caption: '직전 30일 대비', note: '처리 완료 ÷ 유입 Alert' },
  { label: '처리 전 Alert', value: '342', caption: '3일 이상 경과 57건', note: '아직 판정하지 않은 Alert' },
  { label: '의심 거래 중 Alert 편입', value: '16.6%', caption: '214 / 1,287건', note: 'Alert에 들어간 의심 거래 ÷ 의심 거래' },
  { label: '조사 중 Episode', value: '23', caption: '소속 Alert 64건', note: '종결 Episode 41건' },
]

/** 패널 머리(370 고정) 없이 제목 줄만 있는 차트 상자 */
function ChartBox({ title, sub, className, children }: { title: string; sub?: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col border border-(--rd-line) bg-(--rd-subtle)', className)}>
      <header className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-(--rd-line) px-3">
        <h3 className="text-[16px] font-semibold leading-[1.4] text-(--rd-ink)">{title}</h3>
        {sub && <p className="text-[14px] text-(--rd-strong)">{sub}</p>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  )
}

const scoreBands = [
  { label: '0.90 이상 · 위험', count: '186건', width: '13%', bar: 'bg-(--rd-danger)', text: 'text-(--rd-danger)' },
  { label: '0.70 ~ 0.90 · 주의', count: '715건', width: '50%', bar: 'bg-(--rd-caution)', text: 'text-(--rd-caution)' },
  { label: '0.70 미만 · 정상', count: '386건', width: '27%', bar: 'bg-(--rd-sub)', text: 'text-(--rd-positive)' },
]
function ScoreBands() {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  return (
    <ChartBox title="위험 점수 구간별 분포" sub="의심 거래 1,287건 기준" className="min-w-0 flex-1">
      <div className="flex flex-1 flex-col justify-between">
        {scoreBands.map(band => (
          <div key={band.label} className="flex h-11 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[4px] bg-(--rd-bg)">
              <Checkbox label={`${band.label} 선택`} checked={picked.has(band.label)} onChange={next => setPicked(current => { const copy = new Set(current); if (next) copy.add(band.label); else copy.delete(band.label); return copy })} />
            </span>
            <p className={cn('w-[112px] shrink-0 whitespace-nowrap text-[14px]', band.text)}>{band.label}</p>
            <div className="flex h-full min-w-0 flex-1 items-center">
              <div style={{ width: band.width }} className={cn('h-full rounded-[2px]', band.bar)} />
            </div>
            <p className={cn('shrink-0 text-[14px]', band.text)}>{band.count}</p>
          </div>
        ))}
      </div>
    </ChartBox>
  )
}

const volume = [['20', 126, 32], ['21', 132, 34], ['22', 133, 36], ['23', 126, 33], ['24', 111, 29], ['25', 87, 22], ['26', 84, 21], ['27', 131, 35], ['28', 135, 36], ['29', 137, 37], ['30', 134, 35], ['31', 112, 29], ['01', 131, 34], ['02', 136, 35]] as const
function VolumeTrend() {
  return (
    <Panel title="기간별 거래량 추이" className="min-w-0 flex-1" contentClassName="justify-end" wideHeader
      headerLeft={<div className="flex items-center gap-3 whitespace-nowrap text-[14px] text-(--rd-strong)"><span className="flex items-center gap-2"><i className="size-2 rounded-[2px] bg-(--rd-brand)" />전체 거래</span><span className="flex items-center gap-2"><i className="size-2 rounded-[2px] bg-(--rd-danger-ink)" />의심 거래 (×10 확대)</span></div>}
      hideFooter>
      <div className="flex h-[176px] w-full items-end justify-between gap-2 border-b border-(--rd-line)" aria-hidden>
        {volume.map(([day, total, suspicious]) => (
          <div key={day} className="flex h-full flex-1 items-end justify-center gap-[2px]">
            <div style={{ height: total }} className="w-[22px] rounded-t-[2px] bg-(--rd-brand)" />
            <div style={{ height: suspicious }} className="w-[22px] rounded-t-[2px] bg-(--rd-danger-ink)" />
          </div>
        ))}
      </div>
      <div className="flex w-full justify-between gap-2 text-[14px] text-(--rd-strong)">
        {volume.map(([day]) => <span key={day} className="flex-1 text-center">{day}</span>)}
      </div>
    </Panel>
  )
}

// 29일치 [처리 전(회색), 처리 중(파랑), 처리 완료(초록)] 건수
const daily: [number, number, number][] = Array.from({ length: 29 }, (_, index): [number, number, number] =>
  index === 10 ? [352, 18, 10] : index === 14 ? [190, 12, 8] : index % 3 === 0 ? [0, 0, 0] : [2, index % 2 ? 3 : 0, 3])
const dailyTicks = [380, 285, 190, 95, 0]
const dailyLabels = ['7월 23일', '7월 27일', '7월 31일', '8월 4일', '8월 8일', '8월 12일', '8월 16일', '8월 20일']
function DailyStatus() {
  return (
    <section aria-label="일별 Alert 처리 상태" className="flex h-[322px] w-full flex-col border border-(--rd-line) bg-(--rd-subtle)">
      <header className="flex h-12 shrink-0 items-center justify-between px-3">
        <h3 className="text-[16px] font-semibold leading-[1.4] text-(--rd-ink)">일별 Alert 처리 상태</h3>
        <div className="flex items-center gap-1"><StatusTag status="pending" /><StatusTag status="inProgress" tone="brand" /><StatusTag status="done" /></div>
      </header>
      <div className="flex min-h-0 flex-1 gap-2 px-4 pb-3">
        <div className="flex w-8 flex-col justify-between pb-6 text-right text-[14px] text-(--rd-strong)">{dailyTicks.map(tick => <span key={tick}>{tick}</span>)}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 flex flex-col justify-between py-[10px]" aria-hidden>{dailyTicks.map(tick => <i key={tick} className="h-px w-full bg-(--rd-mute)" />)}</div>
            <div className="absolute inset-x-0 bottom-[10px] top-[10px] flex items-end justify-between gap-1 px-10" aria-hidden>
              {daily.map(([pending, progress, done], index) => (
                <div key={index} className="flex h-full w-10 flex-col-reverse">
                  <div style={{ height: `${pending / 3.8}%` }} className="bg-(--rd-sub)" />
                  <div style={{ height: progress ? 3 + progress / 4 : 0 }} className="bg-(--rd-info)" />
                  <div style={{ height: done ? 2 + done / 4 : 0 }} className="bg-(--rd-positive)" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex h-6 items-end justify-between text-[14px] text-(--rd-strong)">{dailyLabels.map(label => <span key={label}>{label}</span>)}</div>
        </div>
      </div>
    </section>
  )
}

const patternCounts = [['Fan-out', '233', '100%'], ['Fan-in', '187', '82%'], ['Gather-scatter', '96', '42%'], ['Scatter-gather', '74', '32%'], ['Cycle', '268', '100%'], ['Random', '152', '66%']] as const
function Composition() {
  return (
    <div className="flex h-[292px] w-full gap-2">
      <ChartBox title="전체 구성과 거래별 건수" className="w-[372px] shrink-0">
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex w-[100px] shrink-0 flex-col justify-between pb-16 text-right text-[14px]">
            <p className="text-(--rd-danger)">2.7% 세탁 의심<br /><span className="text-(--rd-strong)">1,287건</span></p>
            <p className="text-(--rd-positive)">97% 정상 판별<br /><span className="text-(--rd-strong)">46,923건</span></p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <div className="h-2 rounded-[4px] bg-(--rd-danger)" />
            <div className="min-h-0 flex-1 rounded-[4px] bg-(--rd-positive)" />
          </div>
        </div>
      </ChartBox>
      <ChartBox title="의심 거래 유형별 건수" className="min-w-0 flex-1">
        <div className="flex flex-1 flex-col justify-between">
          {patternCounts.map(([name, count, width]) => (
            <div key={name} className="flex h-7 items-center gap-[6px] text-[14px] text-(--rd-inv)">
              <p className="flex h-full w-[168px] shrink-0 items-center rounded-full bg-(--rd-danger) px-3">{name}</p>
              <div className="h-full min-w-0 flex-1"><p style={{ width }} className="flex h-full items-center rounded-full bg-(--rd-danger) px-3">{count}</p></div>
            </div>
          ))}
        </div>
      </ChartBox>
    </div>
  )
}

function AllDashboard() {
  return (
    <div className="flex w-full flex-col gap-6 p-3">
      <div className="flex h-[376px] w-full gap-4">
        <AiSummary data={allSummary} className="w-[549px] shrink-0" />
        <div className="grid min-w-0 flex-1 grid-rows-[172fr_196fr] gap-2">
          <div className="flex min-h-0 gap-2">{topKpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi} className="min-w-0 flex-1" />)}</div>
          <div className="flex min-h-0 gap-2">{bottomKpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi} className="min-w-0 flex-1" />)}</div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-3">
        <div className="flex h-[297px] w-full gap-4"><ScoreBands /><VolumeTrend /></div>
        <DailyStatus />
        <Composition />
      </div>
      <Panel title="업무 현황" headerRight={<><Button size="sm" aria-label="필터" iconStart={<ListFilter />} className="[&_svg]:size-4" /><Button size="sm" aria-label="정렬" iconStart={<ArrowDownUp />} className="[&_svg]:size-4" /><Button size="sm" iconStart={<Calendar />} className="text-[16px] font-medium [&_svg]:size-4">기간</Button></>}>
        <div className="grid w-full grid-cols-3 gap-4">
          {workBoard.map(column => (
            <section key={column.label} aria-label={column.label} className="flex min-w-0 flex-col gap-2">
              <div className="flex h-5 items-center gap-1 px-2"><Tag tone={column.tone}>{column.label}</Tag><Tag tone="muted">{column.count}</Tag></div>
              {column.cards.map(card => <CaseCard key={card.id} card={card} />)}
            </section>
          ))}
        </div>
      </Panel>
    </div>
  )
}

export function DashboardPage({ route, scope }: { route: Route; scope: DashboardScope }) {
  return (
    <Shell route={route} headerLeft={
      <SegmentedSwitch label="대시보드 범위" value={scope} items={[
        { key: 'mine', label: '내 담당', href: hrefFor({ page: 'dashboard', scope: 'mine' }) },
        { key: 'all', label: '전체', href: hrefFor({ page: 'dashboard', scope: 'all' }) },
      ]} />
    }>
      {scope === 'mine' ? <MyDashboard /> : <AllDashboard />}
    </Shell>
  )
}
