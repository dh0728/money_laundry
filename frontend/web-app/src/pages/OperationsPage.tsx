// UI 재설계 S17 수집·도착 현황 + S18 분석 작업 현황 시안.
// API는 이미 있다(origin/dev API.md §1.2·§1.3): GET /api/banks/arrivals, GET /api/v1/batch-jobs, /{jobId}, POST /{jobId}/resume(ADMIN).
// 10/8 김명기: 전 역할 읽기, 조치는 ADMIN만. 직원 이상 보고 기능은 보류.
import { useState } from 'react'
import { toast } from 'sonner'
import { AdminButton, MockRoleSwitch, useMockRole } from '@/components/MockRole'
import { PageHeading, SectionTitle } from '@/components/page'
import { ProvenanceBadge } from '@/components/Provenance'
import { UnderTabs } from '@/components/UnderTabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Arrival = 'NOT_ARRIVED' | 'URL_ISSUED' | 'RECEIVED' | 'RUNNING' | 'COMPLETED' | 'VALIDATION_FAILED' | 'FAILED' | 'EXPIRED'
const ARRIVAL: Record<Arrival, { label: string; tone: string }> = {
  NOT_ARRIVED: { label: '미도착', tone: 'unseen' }, URL_ISSUED: { label: '전송 대기', tone: 'unseen' }, RECEIVED: { label: '수신', tone: 'pending' },
  RUNNING: { label: '검수 중', tone: 'working' }, COMPLETED: { label: '검수 완료', tone: 'closed' },
  VALIDATION_FAILED: { label: '검수 실패', tone: 'danger' }, FAILED: { label: '적재 오류', tone: 'danger' }, EXPIRED: { label: 'URL 만료', tone: 'danger' },
}
const BANKS: { bankId: number; name: string; country: string; status: Arrival; fileName?: string; rowCount?: number; receivedAt?: string; finishedAt?: string; errors?: string[]; integration?: string }[] = [
  { bankId: 10, name: '은행 10', country: 'US', status: 'COMPLETED', fileName: 'aml17_20261010.csv', rowCount: 18402, receivedAt: '10-10 22:14', finishedAt: '10-10 22:16', integration: '통합 정상' },
  { bankId: 11, name: '은행 11', country: 'US', status: 'COMPLETED', fileName: 'aml17_20261010.csv', rowCount: 9230, receivedAt: '10-10 23:02', finishedAt: '10-10 23:03', integration: '일부 보류 · 상대 은행 보고 대기 12행' },
  { bankId: 12, name: '은행 12', country: 'GB', status: 'RUNNING', fileName: 'aml17_20261010.csv', rowCount: 22871, receivedAt: '10-11 01:40' },
  { bankId: 13, name: '은행 13', country: 'SG', status: 'VALIDATION_FAILED', fileName: 'aml17_20261010.csv', rowCount: 4410, receivedAt: '10-11 00:21', finishedAt: '10-11 00:22', errors: ['행 118 · amountPaid · 숫자가 아님', '행 902 · txAt · 거래 기준일 밖', '파일 · 헤더 · 열 이름이 AML17 형식과 다름'] },
  { bankId: 14, name: '은행 14', country: 'KR', status: 'URL_ISSUED' },
  { bankId: 15, name: '은행 15', country: 'KR', status: 'NOT_ARRIVED' },
]

const STAGES = [['WAIT_INGEST', '수신 대기'], ['INTEGRATE', '통합'], ['FREEZE_INPUT', '입력 고정'], ['FEATURES', '피처'], ['INFERENCE', '추론'], ['SCORES', '점수'], ['ALERTS', 'Alert 생성'], ['COMPLETE', '완료']] as const
type Job = { jobId: number; type: 'ANALYSIS' | 'INGEST'; date: string; status: 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'COMPLETED' | 'FAILED'; stage: string; failures: number; retryAt?: string; action?: string; suspicious?: number; alerts?: number; started: string }
const JOB_STATUS: Record<Job['status'], { label: string; tone: string }> = { QUEUED: { label: '대기', tone: 'unseen' }, RUNNING: { label: '실행 중', tone: 'working' }, RETRY_WAIT: { label: '재시도 대기', tone: 'pending' }, COMPLETED: { label: '완료', tone: 'closed' }, FAILED: { label: '실패', tone: 'danger' } }
const JOBS: Job[] = [
  { jobId: 412, type: 'ANALYSIS', date: '10-11', status: 'RETRY_WAIT', stage: 'INFERENCE', failures: 0, retryAt: '03:42', started: '10-11 03:00' },
  { jobId: 409, type: 'ANALYSIS', date: '10-10', status: 'FAILED', stage: 'FEATURES', failures: 3, action: '피처 계산 3회 연속 실패 · 명시 재개 필요', started: '10-10 03:00' },
  { jobId: 405, type: 'ANALYSIS', date: '10-09', status: 'COMPLETED', stage: 'COMPLETE', failures: 0, suspicious: 47, alerts: 12, started: '10-09 03:00' },
  { jobId: 401, type: 'ANALYSIS', date: '10-08', status: 'COMPLETED', stage: 'COMPLETE', failures: 0, suspicious: 52, alerts: 15, started: '10-08 03:00' },
]

const Tone = ({ tone, children }: { tone: string; children: string }) => tone === 'danger'
  ? <Badge variant="outline" className="border-destructive/50 text-xs font-normal text-destructive">{children}</Badge>
  : <Badge variant="outline" data-tone={tone} className="semantic-status-badge text-xs font-normal">{children}</Badge>

function Stages({ job }: { job: Job }) {
  const ci = STAGES.findIndex(s => s[0] === job.stage)
  return <ol className="flex flex-wrap items-center gap-1 text-[0.6875rem]">{STAGES.map(([k, l], i) => {
    const failed = i === ci && job.status === 'FAILED', cur = i === ci && job.status !== 'COMPLETED'
    return <li key={k} className="flex items-center gap-1"><span className={`rounded-full border px-2 py-0.5 ${failed ? 'border-destructive text-destructive' : cur ? 'border-foreground font-medium' : i < ci || job.status === 'COMPLETED' ? '' : 'border-dashed text-muted-foreground'}`}>{l}</span>{i < STAGES.length - 1 && <span className="text-muted-foreground">›</span>}</li>
  })}</ol>
}

function ArrivalsTab() {
  const [sel, setSel] = useState(BANKS[3])
  const done = BANKS.filter(b => b.status === 'COMPLETED').length
  return <div className="space-y-4">
    <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4" aria-label="도착 요약">
      {[['기준일', '10-11', '창: 10-10 03:00 ~ 10-11 03:00'], ['컷오프까지', '1시간 18분', '03:00 마감 · 늦은 파일은 다음 날 분석'], ['도착', `${BANKS.filter(b => !['NOT_ARRIVED', 'URL_ISSUED'].includes(b.status)).length} / ${BANKS.length}개 은행`, `검수 완료 ${done}곳`], ['조치 필요', '1곳', '은행 13 검수 실패']].map(([l, v, s]) =>
        <Card key={l} className="shadow-none"><CardContent className="px-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-lg font-semibold tabular-nums">{v}</p><p className="mt-1 text-xs text-muted-foreground">{s}</p></CardContent></Card>)}
    </section>
    <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card className="shadow-none"><CardContent><SectionTitle title="은행별 도착" description="보고 은행마다 창 안 최신 업로드 1건" action={<Select defaultValue="10-11"><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{['10-11', '10-10', '10-09'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>} />
        <Table><TableHeader><TableRow><TableHead>은행</TableHead><TableHead>상태</TableHead><TableHead className="text-right">행 수</TableHead><TableHead>수신</TableHead><TableHead>검수 끝</TableHead></TableRow></TableHeader>
          <TableBody>{BANKS.map(b => <TableRow key={b.bankId} aria-selected={sel.bankId === b.bankId} className={`cursor-pointer ${sel.bankId === b.bankId ? 'bg-muted/50' : ''}`} onClick={() => setSel(b)}>
            <TableCell>{b.name}<span className="ml-1.5 text-xs text-muted-foreground">{b.country}</span></TableCell><TableCell><Tone tone={ARRIVAL[b.status].tone}>{ARRIVAL[b.status].label}</Tone></TableCell>
            <TableCell className="text-right tabular-nums">{b.rowCount?.toLocaleString() ?? '—'}</TableCell><TableCell className="tabular-nums text-xs">{b.receivedAt ?? '—'}</TableCell><TableCell className="tabular-nums text-xs">{b.finishedAt ?? '—'}</TableCell>
          </TableRow>)}</TableBody></Table>
        <p className="mt-3 text-xs text-muted-foreground">검수 완료는 은행 보고 저장까지입니다. 통합·분석이 끝났다는 뜻이 아닙니다.</p>
      </CardContent></Card>
      <Card className="shadow-none"><CardContent><SectionTitle title={`${sel.name} · ${ARRIVAL[sel.status].label}`} description={sel.fileName ?? '아직 파일이 없습니다'} />
        <dl className="grid grid-cols-[88px_1fr] gap-y-3 text-xs">
          <dt className="text-muted-foreground">행 수</dt><dd className="tabular-nums">{sel.rowCount?.toLocaleString() ?? '—'}</dd>
          <dt className="text-muted-foreground">통합</dt><dd>{sel.integration ?? (sel.status === 'COMPLETED' ? '통합 대기' : '—')}</dd>
          <dt className="text-muted-foreground">다음 분석</dt><dd>{sel.receivedAt ? '10-11 03:00 컷오프 분석' : '—'}</dd>
        </dl>
        {sel.errors && <div className="mt-4"><p className="text-xs font-medium">검수 오류 {sel.errors.length}건 (최대 100건 표시)</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{sel.errors.map(e => <li key={e}>{e}</li>)}</ul><p className="mt-3 text-xs">은행이 고쳐 다시 올리면 새 업로드로 들어옵니다.</p></div>}
        {sel.status === 'NOT_ARRIVED' && <p className="mt-4 text-xs text-muted-foreground">컷오프까지 오지 않으면 이 은행의 그날 거래는 다음 날 분석에 들어갑니다. Alert 상세의 은행 수신 완결에 "수신 중"으로 보입니다.</p>}
      </CardContent></Card>
    </div>
  </div>
}

function JobsTab({ role }: { role: ReturnType<typeof useMockRole>[0] }) {
  const [sel, setSel] = useState(JOBS[1])
  return <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
    <Card className="shadow-none"><CardContent><SectionTitle title="분석 작업" description="매일 03:00 컷오프에 등록 · 최신순" />
      <Table><TableHeader><TableRow><TableHead>작업</TableHead><TableHead>분석일</TableHead><TableHead>상태</TableHead><TableHead>현재 단계</TableHead><TableHead className="text-right">의심 거래 · Alert</TableHead></TableRow></TableHeader>
        <TableBody>{JOBS.map(j => <TableRow key={j.jobId} aria-selected={sel.jobId === j.jobId} className={`cursor-pointer ${sel.jobId === j.jobId ? 'bg-muted/50' : ''}`} onClick={() => setSel(j)}>
          <TableCell className="font-mono text-xs">#{j.jobId}</TableCell><TableCell className="tabular-nums">{j.date}</TableCell><TableCell><Tone tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Tone></TableCell>
          <TableCell className="text-xs">{STAGES.find(s => s[0] === j.stage)?.[1]}{j.retryAt && <span className="ml-1.5 text-muted-foreground">{j.retryAt} 재시도</span>}</TableCell>
          <TableCell className="text-right tabular-nums">{j.status === 'COMPLETED' ? `${j.suspicious} · ${j.alerts}` : '—'}</TableCell>
        </TableRow>)}</TableBody></Table>
      <p className="mt-3 text-xs text-muted-foreground">완료 전 분석의 의심 거래·Alert 수는 0으로 오므로 표시하지 않습니다.</p>
    </CardContent></Card>
    <Card className="shadow-none"><CardContent className="space-y-4"><SectionTitle title={`#${sel.jobId} · ${sel.date} 분석`} description={`시작 ${sel.started} · ${JOB_STATUS[sel.status].label}`} action={sel.status === 'FAILED' ? <AdminButton role={role} size="sm" onClick={() => toast.success(`#${sel.jobId} 재개 요청`, { description: '실패 단계부터 다시 실행합니다. 시안이라 보내지 않습니다.' })}>실패 단계부터 재개</AdminButton> : undefined} />
      <Stages job={sel} />
      {sel.action && <p className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">{sel.action}</p>}
      <div><p className="text-xs font-medium">모델별 상태</p>
        <Table><TableHeader><TableRow><TableHead>모델</TableHead><TableHead>상태</TableHead><TableHead>버전</TableHead></TableRow></TableHeader>
          <TableBody>{[['이진 분류', sel.status === 'COMPLETED' ? '완료' : sel.stage === 'INFERENCE' ? '원격 대기' : '시작 전'], ['유형 분류', sel.status === 'COMPLETED' ? '완료' : sel.stage === 'INFERENCE' ? '수집 완료' : '시작 전']].map(([m, s]) => <TableRow key={m}><TableCell className="text-xs">{m}</TableCell><TableCell className="text-xs">{s}</TableCell><TableCell className="font-mono text-xs">demo-random-v1</TableCell></TableRow>)}</TableBody></Table>
      </div>
      <p className="text-xs text-muted-foreground">포함한 업로드 5개 · 컷오프 뒤 도착한 1개는 다음 날로 넘어감</p>
    </CardContent></Card>
  </div>
}

export default function OperationsPage() {
  const [tab, setTab] = useState<'arrivals' | 'jobs'>('arrivals')
  const [role, setRole] = useMockRole()
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <PageHeading title="수집·처리 현황" description="은행 보고가 언제 들어왔고 분석이 어디까지 왔는지. 모두 볼 수 있고 조치는 관리자만 합니다." badge={<ProvenanceBadge kind="mock" title="API는 있음(API.md §1.2) · 화면은 mock 데이터" />} />
      <MockRoleSwitch role={role} onChange={setRole} />
    </div>
    <UnderTabs value={tab} onChange={setTab} items={[{ value: 'arrivals', label: '도착 현황' }, { value: 'jobs', label: '분석 작업', count: JOBS.filter(j => j.status === 'FAILED').length }]} />
    {tab === 'arrivals' ? <ArrivalsTab /> : <JobsTab role={role} />}
  </div>
}
