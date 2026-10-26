import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { UnderTabs, RiskBadge, PatternBadge } from './shared'
import { TODAY, type RecordItem } from './domain'
import { SectionCards, type SectionCardItem } from './blocks/section-cards'
import { ChartAreaInteractive, type DailyFlow } from './blocks/chart-area-interactive'

const fmt = (n: number) => n.toLocaleString('ko-KR')
function Personal({ records, user, onOpen }: { records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void }) {
  const mine = records.filter(r => r.owner === user && r.status !== '종결')
  const queue = mine.slice().sort((a, b) => b.score - a.score).slice(0, 5)
  const stats = [
    { label: '내 담당 미처리', value: mine.length, sub: '검토·조사가 필요한 업무' },
    { label: '3일 이상 경과', value: mine.filter(r => r.age >= 3).length, sub: '우선 처리가 필요한 업무' },
    { label: '내 종결', value: records.filter(r => r.owner === user && r.status === '종결').length, sub: '현재 조회 범위 기준' },
  ]
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="shadow-none"><CardContent>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-3xl font-semibold tracking-tight mt-4 tabular-nums">{s.value}<span className="text-sm font-normal ml-1.5 text-muted-foreground">건</span></p>
            <p className="text-[11px] text-muted-foreground mt-2">{s.sub}</p>
          </CardContent></Card>
        ))}
      </div>
      <section aria-labelledby="queue-title">
        <div className="mb-3">
          <h2 id="queue-title" className="text-base font-semibold tracking-tight">먼저 확인할 업무</h2>
          <p className="text-xs text-muted-foreground mt-1.5">위험 점수 높은 순 · 종결 건 제외</p>
        </div>
        {/* 수정안: 바깥 카드 없이 업무마다 독립된 카드를 간격을 두고 나열 */}
        <div className="space-y-2.5" data-testid="work-queue">
          {queue.map(r => (
            <button type="button" key={r.id} onClick={() => onOpen(r)} className="work-card w-full text-left grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border bg-card px-5 py-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none">
              <span className="min-w-0">
                <span className="block text-xs font-mono text-muted-foreground">{r.id}</span>
                <span className="block text-sm mt-1.5 truncate">{r.title}</span>
                <span className="flex gap-2 mt-2 items-center"><PatternBadge pattern={r.pattern} probability={r.probability} /><span className="text-[11px] text-muted-foreground">{r.owner} · {r.age === 0 ? '오늘 탐지' : `${r.age}일 경과`}</span></span>
              </span>
              <RiskBadge risk={r.risk} score={r.score} />
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="activity-title">
        <div className="mb-3">
          <h2 id="activity-title" className="text-base font-semibold tracking-tight">최근 내 활동</h2>
          <p className="text-xs text-muted-foreground mt-1.5">현재 조회 범위에서 최근 처리한 업무</p>
        </div>
        <div className="space-y-2.5">
          {records.filter(r => r.owner === user).slice(0, 3).map((r, i) => (
            <button type="button" key={r.id} onClick={() => onOpen(r)} className="work-card w-full text-left flex gap-4 items-center rounded-lg border bg-card px-5 py-3 text-xs hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="text-muted-foreground tabular-nums w-10">{14 - i}:24</span>
              <span className="font-mono">{r.id}</span>
              <span className="text-muted-foreground">{r.status === '종결' ? '검토 종결' : '검토 시작'}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

// 9/18 회의: 기관 전체는 EDA 전시장이 아니라 업무 요약만. 모델 팀 지표 확정 전이라 추이는 결정적 예시값이다.
const dailyFlow: DailyFlow[] = Array.from({ length: 91 }, (_, i) => {
  const d = new Date(TODAY); d.setDate(d.getDate() - (90 - i))
  const inflow = 38 + Math.round(14 * Math.sin(i / 5) + 9 * Math.sin(i / 1.7) + i / 6)
  return { date: d.toISOString().slice(0, 10), inflow, closed: Math.max(0, inflow - 6 + Math.round(7 * Math.cos(i / 3))) }
})
const sum = (rows: DailyFlow[], k: 'inflow' | 'closed') => rows.reduce((a, r) => a + r[k], 0)
const pct = (now: number, before: number) => Math.round((now - before) / before * 1000) / 10

function Institution({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const today = dailyFlow[dailyFlow.length - 1], yesterday = dailyFlow[dailyFlow.length - 2]
  const last30 = dailyFlow.slice(-30), prev30 = dailyFlow.slice(-60, -30)
  const rate = (rows: DailyFlow[]) => Math.round(sum(rows, 'closed') / sum(rows, 'inflow') * 1000) / 10
  const open = records.filter(r => r.kind === 'Alert' && r.status !== '종결')
  const stale = open.filter(r => r.age >= 3)
  const cards: SectionCardItem[] = [
    { label: '오늘 유입 Alert', value: fmt(today.inflow), delta: pct(today.inflow, yesterday.inflow), trend: '전일 대비', note: '모델이 의심으로 판별한 신규 건' },
    { label: '30일 처리율', value: `${rate(last30)}%`, delta: Math.round((rate(last30) - rate(prev30)) * 10) / 10, unit: '%p', trend: '직전 30일 대비', note: '처리 완료 ÷ 유입' },
    { label: '미처리 Alert', value: fmt(open.length), trend: '현재 조회 범위', note: '종결되지 않은 Alert' },
    { label: '3일 이상 경과', value: fmt(stale.length), trend: '우선 처리 대상', note: '미처리 중 3일 이상 경과' },
  ]
  const recent = open.slice().sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score).slice(0, 5)
  return (
    <>
      <SectionCards items={cards} />
      <ChartAreaInteractive data={dailyFlow} referenceDate={today.date} />
      <section aria-labelledby="recent-title">
        <div className="mb-3">
          <h2 id="recent-title" className="text-base font-semibold tracking-tight">최근 유입 Alert</h2>
          <p className="text-xs text-muted-foreground mt-1.5">미처리 · 최신순</p>
        </div>
        <div className="space-y-2.5">
          {recent.map(r => (
            <button type="button" key={r.id} onClick={() => onOpen(r)} className="work-card w-full text-left grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border bg-card px-5 py-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none">
              <span className="min-w-0">
                <span className="block text-xs font-mono text-muted-foreground">{r.id}</span>
                <span className="block text-sm mt-1.5 truncate">{r.title}</span>
                <span className="flex gap-2 mt-2 items-center"><PatternBadge pattern={r.pattern} probability={r.probability} /><span className="text-[11px] text-muted-foreground">{r.owner} · {r.age === 0 ? '오늘 탐지' : `${r.age}일 경과`}</span></span>
              </span>
              <RiskBadge risk={r.risk} score={r.score} />
            </button>
          ))}
        </div>
      </section>
      <p className="text-[11px] text-muted-foreground">추이·처리율은 예시값입니다. 모델 팀 운영 지표가 정해지면 교체합니다. 데이터 설명 차트는 발표 자료에 둡니다.</p>
    </>
  )
}

export default function Dashboard({ records, user, onOpen }: { records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void }) {
  const [scope, setScope] = useState('personal')
  return (
    <div className="space-y-6">
      <UnderTabs value={scope} onChange={setScope} items={[{ value: 'personal', label: '내 담당' }, { value: 'institution', label: '기관 전체' }]} />
      {scope === 'personal' ? <Personal records={records} user={user} onOpen={onOpen} /> : <Institution records={records} onOpen={onOpen} />}
    </div>
  )
}
