import { useState } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { UnderTabs, SectionTitle, RiskBadge, PatternBadge } from './shared'
import { blockPatterns, graphMeta, records as allRecords, type RecordItem } from './domain'
import PatternGlyph from './PatternGlyph'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const patternName: Record<string, string> = { 'FAN-OUT': 'FAN_OUT', 'FAN-IN': 'FAN_IN', '패턴 외': 'NON_PATTERN' }

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

function Institution({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const s = graphMeta.stats
  const metrics = [
    { label: '전체 거래', value: fmt(s.rows), sub: 'HI-Small 원천 거래' },
    { label: '세탁 라벨 거래', value: fmt(s.label1), sub: `전체의 ${(s.label1 / s.rows * 100).toFixed(2)}%` },
    { label: '패턴 소속', value: fmt(s.matched), sub: `세탁 거래의 ${(s.matched / s.label1 * 100).toFixed(1)}%` },
    { label: '패턴 외', value: fmt(s.outside), sub: `세탁 거래의 ${(s.outside / s.label1 * 100).toFixed(1)}%` },
    { label: '허브 계좌', value: fmt(graphMeta.hubs), sub: `최대 상대 계좌 ${fmt(graphMeta.hubMaxDegree)}개` },
  ]
  const distribution = Object.entries(s.ptype_counts).filter(([k]) => k !== '패턴 외').map(([k, v]) => ({ pattern: patternName[k] ?? k, blocks: v })).sort((a, b) => b.blocks - a.blocks)
  // 차트 강조 규칙: red는 이상거래/오류/고위험 전용이므로, 분포 차트는 가장 큰 값만 순수 흰색(foreground)으로 강조하고 나머지는 회색(muted-foreground)으로 렌더링한다.
  const compositionRaw = [
    { name: '패턴 소속', value: s.matched },
    { name: '패턴 외 · 다건 묶음', value: s.outside - graphMeta.single.count },
    { name: '패턴 외 · 단일 거래', value: graphMeta.single.count },
  ]
  // 큰 값부터 흰색 → 회색 → 어두운 회색으로 명도만 나눠, 빨강을 쓰지 않고도 세 조각을 구분한다
  const tones = ['var(--foreground)', 'var(--muted-foreground)', 'oklch(0.42 0 0)']
  const rank = compositionRaw.map((c, i) => i).sort((a, b) => compositionRaw[b].value - compositionRaw[a].value)
  const composition = compositionRaw.map((c, i) => ({ ...c, fill: tones[rank.indexOf(i)] }))
  return (
    <>
      <div className="grid grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5 gap-4" data-testid="institution-metrics">
        {metrics.map(m => (
          <Card key={m.label} className="shadow-none"><CardContent>
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="text-2xl font-semibold tracking-tight mt-3 tabular-nums">{m.value}</p>
            <p className="text-[11px] text-muted-foreground mt-2">{m.sub}</p>
          </CardContent></Card>
        ))}
      </div>
      <div className="grid gap-4 @5xl:grid-cols-[1.4fr_1fr]">
        <Card className="shadow-none"><CardContent>
          <SectionTitle title="패턴별 세탁 블록 분포" description="Patterns 파일이 선언한 8종 · 블록 수 기준" />
          <ChartContainer config={{ blocks: { label: '블록', color: 'var(--muted-foreground)' } }} className="h-[260px] w-full">
            <BarChart data={distribution} layout="vertical" margin={{ left: 18, right: 24 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="pattern" width={116} tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="blocks" radius={3} label={{ position: 'right', fontSize: 11, fill: 'var(--muted-foreground)' }}>
                {distribution.map((d, i) => <Cell key={d.pattern} fill={i === 0 ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent></Card>
        <Card className="shadow-none"><CardContent>
          <SectionTitle title="세탁 거래 구성" description={`라벨 1 거래 ${fmt(s.label1)}건`} />
          <div className="grid grid-cols-[160px_1fr] items-center gap-5">
            <ChartContainer config={{ value: { label: '거래' } }} className="h-[160px] w-[160px]">
              <PieChart><ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} /><Pie data={composition} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} strokeWidth={2}>{composition.map(c => <Cell key={c.name} fill={c.fill} />)}</Pie></PieChart>
            </ChartContainer>
            <div className="space-y-3 text-xs">
              {composition.map(c => <p key={c.name} className="grid grid-cols-[10px_1fr_auto] gap-2 items-center"><i className="size-2.5 rounded-sm" style={{ background: c.fill }} />{c.name}<span className="tabular-nums">{fmt(c.value)}</span></p>)}
              <p className="text-[11px] text-muted-foreground leading-5 pt-2 border-t">라벨은 모양이 아니라 자금 출처로 붙음. 단일 거래 블록은 그래프 모양이 없음.</p>
            </div>
          </div>
        </CardContent></Card>
      </div>
      <Card className="shadow-none"><CardContent>
        <SectionTitle title="패턴 대표 모양" description="IBM AML 논문 Figure 2 구조 · 흰색은 중심·중간 계좌 · 선택하면 해당 유형 Alert로 이동" />
        <div className="grid grid-cols-3 @3xl:grid-cols-5 @5xl:grid-cols-9 gap-3">
          {blockPatterns.map(p => {
            const alert = records.find(r => r.kind === 'Alert' && r.pattern === p) ?? allRecords[0]
            return (
              <button type="button" key={p} onClick={() => onOpen(alert)} className="rounded-lg border bg-background/40 hover:bg-muted/50 p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <PatternGlyph pattern={p} className="w-full aspect-[6/5]" />
                <span className="block font-mono text-[10px] text-muted-foreground mt-1.5 truncate">{p}</span>
              </button>
            )
          })}
        </div>
      </CardContent></Card>
      <p className="text-[11px] text-muted-foreground">출처 · {graphMeta.source}. 기관 운영 지표가 아니라 분석 대상 데이터 규모입니다.</p>
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
