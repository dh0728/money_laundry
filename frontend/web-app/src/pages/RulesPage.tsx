// UI 재설계(MONEY17-174) 룰엔진·백테스트 시안 (FE MONEY17-150 대상, BE MONEY17-147 계약 전 mock).
// 10/6 팀 결정: 룰엔진은 설명용. 모델이 만든 Alert에 어떤 룰이 걸리는지 보여 줄 뿐 Alert를 만들지 않는다.
// 그래서 송동현 팀장 목업(10/6)의 "룰만 찾음"·"GNN 씨앗과 겹침"(룰이 전체 거래를 따로 검사하는 구조)은 쓰지 않고,
// 백테스트는 "기간 안 모델 Alert 중 몇 건을 설명하나 · 그 Alert들이 사람 판정에서 어떻게 끝났나"로 본다.
import { NumBadge } from '@/components/NumBadge'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PageHeading, SectionTitle } from '@/components/page'
import { ProvenanceBadge, ProvenanceNote } from '@/components/Provenance'
import { UnderTabs } from '@/components/UnderTabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AdminButton, MockRoleSwitch, useMockRole, type MockRole } from '@/components/MockRole'

type Tab = 'list' | 'write' | 'backtest' | 'approval' | 'thresholds'
type Role = MockRole
type Status = 'DRAFT' | 'VALIDATED' | 'BACKTESTED' | 'PENDING' | 'SHADOW' | 'ACTIVE'
type Param = { k: string; label: string; unit: string; def: number; min: number; max?: number; step: number }
type Template = { key: string; name: string; unit: string; desc: string; ready: boolean; why?: string; policy?: boolean; params: Param[]; sentence: (p: Record<string, number>) => ReactNode }

const POLICY_USD = 10_000 // 회사 정책 기준금액. 룰에 적지 않고 실행 때 값을 기록한다
const won = (n: number) => n.toLocaleString('ko-KR')

const TEMPLATES: Template[] = [
  { key: 'LARGE', name: '단건 고액 거래', unit: '거래 1건', desc: '한 번에 큰 금액이 움직인 거래', ready: true,
    params: [{ k: 'amount', label: '금액 기준', unit: 'USD 이상', def: 30000, min: 1000, step: 1000 }],
    sentence: p => <>거래 한 건의 금액이 <b>{won(p.amount)} USD 이상</b>이면 적중합니다.</> },
  { key: 'STRUCT', name: '분할 입·출금', unit: '계좌 × 기간', desc: '기준금액 바로 아래 금액을 여러 번 나눠 넣거나 뺌', ready: true, policy: true,
    params: [{ k: 'ratio', label: '기준금액 대비 하한', unit: '% 이상', def: 85, min: 50, max: 99, step: 5 }, { k: 'days', label: '기간', unit: '일 안에', def: 7, min: 1, max: 30, step: 1 }, { k: 'count', label: '건수', unit: '건 이상', def: 3, min: 2, step: 1 }],
    sentence: p => <>한 계좌에 <b>{p.days}일 안에</b> 회사 기준금액({won(POLICY_USD)} USD)의 <b>{p.ratio}% 이상 100% 미만</b>인 입금이 <b>{p.count}건 이상</b> 있으면 적중합니다.</> },
  { key: 'FANIN', name: '집중 수취 (FAN-IN)', unit: '수취 계좌 × 기간', desc: '여러 계좌의 돈이 한 계좌로 모임', ready: true,
    params: [{ k: 'hours', label: '기간', unit: '시간 안에', def: 24, min: 1, max: 720, step: 1 }, { k: 'n', label: '서로 다른 송금 계좌', unit: '개 이상', def: 3, min: 2, step: 1 }, { k: 'total', label: '받은 총액', unit: 'USD 이상', def: 20000, min: 0, step: 1000 }],
    sentence: p => <>한 계좌가 <b>{p.hours}시간 안에</b> 서로 다른 계좌 <b>{p.n}개 이상</b>에서 돈을 받고, 받은 총액이 <b>{won(p.total)} USD 이상</b>이면 적중합니다.</> },
  { key: 'FANOUT', name: '분산 송금 (FAN-OUT)', unit: '송금 계좌 × 기간', desc: '한 계좌의 돈이 여러 계좌로 흩어짐', ready: true,
    params: [{ k: 'hours', label: '기간', unit: '시간 안에', def: 24, min: 1, max: 720, step: 1 }, { k: 'n', label: '서로 다른 수취 계좌', unit: '개 이상', def: 3, min: 2, step: 1 }, { k: 'total', label: '보낸 총액', unit: 'USD 이상', def: 10000, min: 0, step: 1000 }],
    sentence: p => <>한 계좌가 <b>{p.hours}시간 안에</b> 서로 다른 계좌 <b>{p.n}개 이상</b>으로 돈을 보내고, 보낸 총액이 <b>{won(p.total)} USD 이상</b>이면 적중합니다.</> },
  { key: 'PASS', name: '급속 자금 통과', unit: '계좌 × 기간', desc: '들어온 돈이 금방 다시 나감', ready: true,
    params: [{ k: 'minutes', label: '입금 후', unit: '분 안에 출금', def: 180, min: 5, max: 1440, step: 5 }, { k: 'ratio', label: '빠져나간 비율', unit: '% 이상', def: 80, min: 10, max: 100, step: 5 }, { k: 'minIn', label: '들어온 총액', unit: 'USD 이상', def: 20000, min: 0, step: 1000 }],
    sentence: p => <>한 계좌에 들어온 돈이 <b>{won(p.minIn)} USD 이상</b>이고, 그중 <b>{p.ratio}% 이상</b>이 입금 후 <b>{p.minutes}분 안에</b> 다시 나가면 적중합니다.</> },
  { key: 'DORMANT', name: '휴면 계좌 활성화', unit: '계좌 × 기간', desc: '', ready: false, why: '계좌 개설일·장기 이력이 필요', params: [], sentence: () => null },
  { key: 'SURGE', name: '평소 대비 급증', unit: '계좌 × 기간', desc: '', ready: false, why: '비교할 과거 기간이 충분해야 함', params: [], sentence: () => null },
  { key: 'CYCLE', name: '순환 거래', unit: '여러 계좌', desc: '', ready: false, why: '원장 전체 경로 탐색이 필요', params: [], sentence: () => null },
  { key: 'REPEAT', name: '반복 상대방 거래', unit: '계좌 쌍 × 기간', desc: '', ready: false, why: '이후 단계', params: [], sentence: () => null },
  { key: 'COUNTRY', name: '고위험 국가 거래', unit: '계좌 × 기간', desc: '', ready: false, why: '데이터에 국가 정보가 없음', params: [], sentence: () => null },
]
const tpl = (key: string) => TEMPLATES.find(t => t.key === key)!

const STATUS: Record<Status, { label: string; tone?: string }> = {
  DRAFT: { label: '작성 중', tone: 'unseen' }, VALIDATED: { label: '검증됨', tone: 'unseen' }, BACKTESTED: { label: '백테스트 완료', tone: 'unseen' },
  PENDING: { label: '승인 대기', tone: 'pending' }, SHADOW: { label: '시험 운영', tone: 'working' }, ACTIVE: { label: '운영 중' },
}
const STEPS: [Status, string][] = [['DRAFT', '작성'], ['VALIDATED', '검증'], ['BACKTESTED', '백테스트'], ['PENDING', '승인 대기'], ['SHADOW', '시험 운영'], ['ACTIVE', '운영']]

type Rule = { id: string; tpl: string; v: number; status: Status; owner: string; approver: string; lastRun: string; p: Record<string, number>; hits: number; suspicious: number; normal: number; open: number }
const RULES: Rule[] = [
  { id: 'RULE-001', tpl: 'LARGE', v: 2, status: 'ACTIVE', owner: '관리자1', approver: '관리자2', lastRun: '10-10 03:00', p: { amount: 30000 }, hits: 41, suspicious: 22, normal: 9, open: 10 },
  { id: 'RULE-003', tpl: 'FANIN', v: 1, status: 'ACTIVE', owner: '관리자2', approver: '관리자1', lastRun: '10-10 03:00', p: { hours: 24, n: 3, total: 20000 }, hits: 63, suspicious: 38, normal: 7, open: 18 },
  { id: 'RULE-005', tpl: 'PASS', v: 1, status: 'SHADOW', owner: '관리자1', approver: '관리자2', lastRun: '10-10 03:00', p: { minutes: 180, ratio: 80, minIn: 20000 }, hits: 27, suspicious: 11, normal: 8, open: 8 },
  { id: 'RULE-004', tpl: 'FANOUT', v: 1, status: 'PENDING', owner: '관리자2', approver: '—', lastRun: '—', p: { hours: 24, n: 3, total: 10000 }, hits: 0, suspicious: 0, normal: 0, open: 0 },
  { id: 'RULE-002', tpl: 'STRUCT', v: 1, status: 'DRAFT', owner: '관리자1', approver: '—', lastRun: '—', p: { ratio: 85, days: 7, count: 3 }, hits: 0, suspicious: 0, normal: 0, open: 0 },
]
const ALERTS_IN_PERIOD = 212 // 백테스트 기간 안 모델이 만든 Alert 수(mock)

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status]
  return s.tone ? <Badge variant="outline" data-tone={s.tone} className="semantic-status-badge text-xs font-normal">{s.label}</Badge> : <Badge className="text-xs font-normal">{s.label}</Badge>
}

const Section = ({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) =>
  <Card className="shadow-none"><CardContent><SectionTitle title={title} description={description} action={action} />{children}</CardContent></Card>

function Stepper({ current }: { current: Status }) {
  const ci = STEPS.findIndex(s => s[0] === current)
  return <ol className="flex flex-wrap items-center gap-1.5 text-xs">{STEPS.map(([key, label], i) => <li key={key} className="flex items-center gap-1.5">
    <span className={`rounded-full border px-2.5 py-1 ${i === ci ? 'border-foreground font-medium' : i < ci ? 'text-foreground' : 'border-dashed text-muted-foreground'}`}>{i < ci ? '✓ ' : ''}{label}</span>{i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
  </li>)}</ol>
}

/** 사람 판정 기준 결과: 룰이 설명한 Alert들이 어떻게 끝났나 */
function Outcome({ r }: { r: Pick<Rule, 'suspicious' | 'normal' | 'open'> }) {
  const closed = r.suspicious + r.normal
  return <span className="tabular-nums">{closed ? `${Math.round((r.suspicious / closed) * 100)}%` : '—'}<span className="ml-1.5 text-xs text-muted-foreground">의심 {r.suspicious} · 정상 {r.normal} · 미종결 {r.open}</span></span>
}

function ListTab({ role, onOpen, onNew }: { role: Role; onOpen: (rule: Rule) => void; onNew: () => void }) {
  const [selected, setSelected] = useState<Rule>(RULES[1])
  return <div className="space-y-4">
    <Section title="룰 목록" description={`${RULES.length}개 · 적중은 최근 30일 모델 Alert ${ALERTS_IN_PERIOD}건 기준`} action={<AdminButton role={role} size="sm" onClick={onNew}>새 룰 만들기</AdminButton>}>
      <Table><TableHeader><TableRow><TableHead>번호</TableHead><TableHead>템플릿</TableHead><TableHead>버전</TableHead><TableHead>상태</TableHead><TableHead className="w-[34%]">조건</TableHead><TableHead className="text-right">적중 Alert</TableHead><TableHead className="text-right">의심 종결 비율</TableHead><TableHead>작성 · 승인</TableHead><TableHead>마지막 실행</TableHead></TableRow></TableHeader>
        <TableBody>{RULES.map(r => { const t = tpl(r.tpl), live = r.status === 'ACTIVE' || r.status === 'SHADOW'; return <TableRow key={r.id} aria-selected={selected.id === r.id} className={`cursor-pointer ${selected.id === r.id ? 'bg-muted/50' : ''}`} onClick={() => setSelected(r)}>
          <TableCell className="font-mono text-xs">{r.id}</TableCell>
          <TableCell><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.unit}</p></TableCell>
          <TableCell className="tabular-nums">v{r.v}</TableCell><TableCell><StatusBadge status={r.status} /></TableCell>
          <TableCell className="whitespace-normal text-xs text-muted-foreground">{t.sentence(r.p)}</TableCell>
          <TableCell className="text-right tabular-nums">{live ? `${r.hits}건` : '—'}</TableCell>
          <TableCell className="text-right">{live ? <Outcome r={r} /> : '—'}</TableCell>
          <TableCell className="text-xs">{r.owner}<p className="text-muted-foreground">승인 {r.approver}</p></TableCell>
          <TableCell className="text-xs tabular-nums">{r.lastRun}</TableCell>
        </TableRow> })}</TableBody></Table>
      <p className="mt-3 text-xs text-muted-foreground">룰은 Alert를 만들지 않습니다. 모델이 만든 Alert에 어떤 룰이 걸리는지 보여 줘 설명을 돕습니다. 시험 운영 룰은 결과만 저장하고 Alert 상세에는 보이지 않습니다. 운영 중인 룰은 직접 고치지 않고 새 버전을 만듭니다.</p>
    </Section>
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section title={`${selected.id} v${selected.v} · ${tpl(selected.tpl).name}`} description="선택한 룰의 상세" action={<AdminButton role={role} size="sm" variant="outline" onClick={() => onOpen(selected)}>{selected.status === 'DRAFT' ? '이어서 작성' : '새 버전 만들기'}</AdminButton>}>
        <p className="text-sm">{tpl(selected.tpl).sentence(selected.p)}</p>
        <div className="mt-4"><Stepper current={selected.status} /></div>
        <p className="mt-4 text-xs font-medium">버전 이력</p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">{Array.from({ length: selected.v }, (_, i) => selected.v - i).map(v => <li key={v}>v{v} · {v === selected.v ? STATUS[selected.status].label : '운영 종료'} · {v === selected.v ? '10-02 승인' : '09-20 승인'}</li>)}</ul>
      </Section>
      <Section title="최근 적중 Alert" description={<>누르면 Alert 상세의 <NumBadge n={1} /> 룰 적중으로 이동</>}>
        {selected.hits ? <ul className="divide-y text-xs">{['A-3010', 'A-3004', 'A-3017', 'A-3021'].map((id, i) => <li key={id} className="flex items-center justify-between gap-3 py-2"><a className="font-mono underline-offset-4 hover:underline" href={`#alerts/${id.slice(2)}`}>{id}</a><span className="text-muted-foreground">{['받은 총액 52,100 USD (20,000 이상)', '송금 계좌 5개 (3개 이상)', '빠져나간 비율 91% (80% 이상)', '거래 1건 41,000 USD (30,000 이상)'][i]}</span><span>{['의심 종결', '처리 중', '정상 종결', '처리 전'][i]}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">운영 전이라 적중 기록이 없습니다.</p>}
      </Section>
    </div>
  </div>
}

function WriteTab({ role, draft, setDraft, onBacktest }: { role: Role; draft: { tpl: string; p: Record<string, number>; base?: Rule }; setDraft: (d: { tpl: string; p: Record<string, number>; base?: Rule }) => void; onBacktest: () => void }) {
  const t = tpl(draft.tpl)
  const bad = t.params.filter(f => !Number.isFinite(draft.p[f.k]) || draft.p[f.k] < f.min || (f.max != null && draft.p[f.k] > f.max))
  const same = RULES.filter(r => r.tpl === draft.tpl && r.id !== draft.base?.id)
  const long = (draft.p.hours ?? 0) > 168 || (draft.p.days ?? 0) > 30
  const checks: [string, 'ok' | 'warn' | 'err', string][] = [
    ['조건', bad.length ? 'err' : 'ok', bad.length ? `${bad.map(f => f.label).join(', ')} 값이 허용 범위를 벗어났습니다.` : '모든 값이 허용 범위 안에 있습니다.'],
    ['데이터', 'ok', '필요한 값(계좌·시각·금액)이 Alert 근거 거래에 있습니다.'],
    ['실행 비용', long ? 'warn' : 'ok', long ? '기간이 길어 일 배치 시간 안에 끝나는지 확인이 필요합니다.' : '일 배치로 실행할 수 있는 범위입니다.'],
    ['중복', same.length ? 'warn' : 'ok', same.length ? `같은 템플릿의 ${same.map(r => r.id).join(', ')}이 있습니다. 같은 Alert에 함께 걸릴 수 있습니다.` : '같은 템플릿을 쓰는 다른 룰이 없습니다.'],
  ]
  const err = checks.some(c => c[1] === 'err')
  const readOnly = role !== 'ADMIN'
  return <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <Section title="1. 템플릿 고르기" description={draft.base ? '기존 룰의 새 버전이라 템플릿은 바꿀 수 없습니다.' : '처음에는 5개만 제공합니다. 나머지는 필요한 데이터가 준비된 뒤 추가합니다.'}>
      <div className="grid grid-cols-1 gap-2 @3xl:grid-cols-2">{TEMPLATES.map(x => { const on = x.key === draft.tpl; return <button key={x.key} type="button" aria-pressed={on} disabled={!x.ready || Boolean(draft.base) || readOnly}
        onClick={() => setDraft({ tpl: x.key, p: Object.fromEntries(x.params.map(f => [f.k, f.def])) })}
        className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors enabled:hover:bg-muted/50 disabled:cursor-not-allowed ${on ? 'border-foreground bg-muted/40' : ''} ${x.ready ? '' : 'border-dashed opacity-70'}`}>
        <span className="block text-sm font-medium">{x.name}</span><span className="mt-0.5 block text-muted-foreground">{x.ready ? x.desc : x.why}</span><span className="mt-1 block text-[0.6875rem] text-muted-foreground">{x.ready ? `판정 단위: ${x.unit}` : '이후 단계'}</span>
      </button> })}</div>
    </Section>
    <div className="space-y-4">
      <Section title="2. 값 채우기" description={`${t.name} · 판정 단위: ${t.unit}`}>
        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-3">{t.params.map(f => <label key={f.k} className="space-y-1.5 text-xs"><span className="text-muted-foreground">{f.label}</span>
          <span className="flex items-center gap-2"><Input type="number" className="h-9 tabular-nums" value={draft.p[f.k]} min={f.min} max={f.max} step={f.step} disabled={readOnly} onChange={e => setDraft({ ...draft, p: { ...draft.p, [f.k]: Number(e.target.value) } })} /><span className="shrink-0 text-muted-foreground">{f.unit}</span></span>
        </label>)}</div>
        {t.policy && <p className="mt-3 text-xs text-muted-foreground">회사 기준금액 {won(POLICY_USD)} USD는 룰에 적지 않고 회사 정책값에서 가져옵니다. 정책값이 바뀌어도 과거 기준이 남도록 실행할 때의 값을 기록합니다.</p>}
      </Section>
      <Section title="이 룰을 문장으로 읽으면" description="입력한 값으로 만든 설명. Alert 상세에도 이 문장이 보입니다">
        <p className="text-sm leading-6">{t.sentence(draft.p)}</p>
        <ul className="mt-4 space-y-1.5 text-xs">{checks.map(([k, s, m]) => <li key={k} className="grid grid-cols-[20px_64px_1fr] gap-2"><span className={s === 'err' ? 'text-destructive' : s === 'warn' ? 'text-[var(--palette-blue-500)]' : 'text-muted-foreground'}>{s === 'ok' ? '✓' : s === 'warn' ? '△' : '✕'}</span><span className="font-medium">{k}</span><span className="text-muted-foreground">{m}</span></li>)}</ul>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><Stepper current={err ? 'DRAFT' : 'VALIDATED'} />
          <span className="flex gap-2"><AdminButton role={role} size="sm" variant="outline" onClick={() => toast.success('임시 저장', { description: '시안이라 저장하지 않습니다.' })}>임시 저장</AdminButton><AdminButton role={role} size="sm" disabled={err} onClick={onBacktest}>백테스트로</AdminButton></span></div>
      </Section>
    </div>
  </div>
}

function BacktestTab({ role, draft }: { role: Role; draft: { tpl: string; p: Record<string, number>; base?: Rule } }) {
  const t = tpl(draft.tpl)
  const vary = t.params[t.params.length > 1 ? 1 : 0]
  const values = [vary.def - vary.step * 1, vary.def, vary.def + vary.step, vary.def + vary.step * 2].filter(v => v >= vary.min)
  // mock: 기준이 엄할수록 적중 Alert는 줄고 의심 종결 비율은 오른다
  const sim = (v: number) => { const k = (v - vary.min + vary.step) / (vary.def - vary.min + vary.step); const hits = Math.max(4, Math.round(64 / k)); const sus = Math.round(hits * Math.min(0.9, 0.45 + 0.12 * k)); const nor = Math.round((hits - sus) * 0.55); return { hits, suspicious: sus, normal: nor, open: hits - sus - nor } }
  const cur = sim(draft.p[vary.k] ?? vary.def)
  const [ran, setRan] = useState(true)
  return <div className="space-y-4">
    <Section title="실행 조건" description="과거 기간의 모델 Alert에 이 룰을 다시 돌려 봅니다" action={<AdminButton role={role} size="sm" onClick={() => { setRan(false); setTimeout(() => setRan(true), 700) }}>백테스트 실행</AdminButton>}>
      <div className="flex flex-wrap items-end gap-4 text-xs">
        <label className="space-y-1.5"><span className="block text-muted-foreground">룰</span><span className="block rounded-md border px-3 py-2">{draft.base ? `${draft.base.id} v${draft.base.v + 1} 초안` : '새 룰 초안'} · {t.name}</span></label>
        <label className="space-y-1.5"><span className="block text-muted-foreground">기간</span>
          <Select defaultValue="30"><SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">최근 7일</SelectItem><SelectItem value="30">최근 30일</SelectItem><SelectItem value="60">최근 60일</SelectItem></SelectContent></Select></label>
        <span className="text-muted-foreground">기간 안 모델 Alert <b className="text-foreground">{ALERTS_IN_PERIOD}건</b> · 정책 기준금액 {won(POLICY_USD)} USD로 실행</span>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{ran ? '완료 · 10-11 16:40 · 12초' : '실행 중…'}<ProvenanceBadge kind="proposal" title="실행 작업·상태·결과 API 필요(BE 147)" /></p>
    </Section>
    <section aria-label="백테스트 요약" className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
      {[['적중 Alert', `${cur.hits}건`, `${ALERTS_IN_PERIOD}건 중 ${Math.round((cur.hits / ALERTS_IN_PERIOD) * 100)}%를 설명`], ['의심 종결', `${cur.suspicious}건`, '사람이 의심으로 판정'], ['정상 종결', `${cur.normal}건`, '룰은 걸렸지만 정상'], ['미종결', `${cur.open}건`, '아직 판정 전']].map(([l, v, s]) =>
        <Card key={l} className="shadow-none"><CardContent className="px-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-lg font-semibold tabular-nums">{v}</p><p className="mt-1 text-xs text-muted-foreground">{s}</p></CardContent></Card>)}
    </section>
    <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-2">
      <Section title="값을 바꾸면 얼마나 달라지나" description={`${vary.label} 기준`}>
        <Table><TableHeader><TableRow><TableHead>{vary.label}</TableHead><TableHead className="text-right">적중 Alert</TableHead><TableHead className="text-right">의심 종결 비율</TableHead></TableRow></TableHeader>
          <TableBody>{values.map(v => { const s = sim(v), on = v === (draft.p[vary.k] ?? vary.def); return <TableRow key={v} className={on ? 'bg-muted/50' : ''}><TableCell className="tabular-nums">{won(v)} {vary.unit}{on && <Badge variant="outline" className="ml-2 font-normal">지금 값</Badge>}</TableCell><TableCell className="text-right tabular-nums">{s.hits}건</TableCell><TableCell className="text-right"><Outcome r={s} /></TableCell></TableRow> })}</TableBody></Table>
      </Section>
      <Section title="다른 룰과 비교" description="같은 기간 · 운영 중·시험 운영 룰">
        <Table><TableHeader><TableRow><TableHead>룰</TableHead><TableHead className="text-right">적중 Alert</TableHead><TableHead className="text-right">의심 종결 비율</TableHead><TableHead className="text-right">이 초안과 같이 걸림</TableHead></TableRow></TableHeader>
          <TableBody>{RULES.filter(r => r.status === 'ACTIVE' || r.status === 'SHADOW').map((r, i) => <TableRow key={r.id}><TableCell className="text-xs"><span className="font-mono">{r.id}</span> {tpl(r.tpl).name}</TableCell><TableCell className="text-right tabular-nums">{r.hits}건</TableCell><TableCell className="text-right"><Outcome r={r} /></TableCell><TableCell className="text-right tabular-nums">{[9, 14, 3][i]}건</TableCell></TableRow>)}</TableBody></Table>
      </Section>
    </div>
    <ProvenanceNote kind="proposal">성능은 "룰이 걸린 Alert가 사람 판정에서 의심으로 끝난 비율"로 봅니다. 룰이 Alert를 만들지 않으므로 "룰만 찾음"은 두지 않습니다.</ProvenanceNote>
  </div>
}

function ApprovalTab({ role, me }: { role: Role; me: string }) {
  const pending = RULES.filter(r => r.status === 'PENDING'), shadow = RULES.filter(r => r.status === 'SHADOW')
  const [reason, setReason] = useState('')
  return <div className="space-y-4">
    {pending.map(r => { const t = tpl(r.tpl), self = r.owner === me; return <Section key={r.id} title={`${r.id} v${r.v} · ${t.name}`} description={`승인 대기 · 작성 ${r.owner} · 10-09 요청`} action={<StatusBadge status={r.status} />}>
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-2">
        <div className="space-y-3 text-sm"><p className="text-xs font-medium">조건</p><p>{t.sentence(r.p)}</p><p className="text-xs text-muted-foreground">새 룰이라 이전 버전이 없습니다.</p></div>
        <div className="space-y-2 text-xs"><p className="font-medium">첨부된 백테스트 · 최근 30일</p><p>적중 Alert <b className="tabular-nums">48건</b> ({ALERTS_IN_PERIOD}건 중 23%) · 의심 종결 비율 <b>71%</b> · RULE-003과 같이 걸림 14건</p></div>
      </div>
      <Textarea className="mt-4 min-h-16 text-sm" placeholder="반려할 때 이유를 적습니다" value={reason} onChange={e => setReason(e.target.value)} disabled={role !== 'ADMIN'} />
      <div className="mt-3 flex flex-wrap items-start justify-end gap-2">
        <AdminButton role={role} size="sm" variant="outline" disabled={!reason.trim()} onClick={() => toast('반려', { description: '시안이라 저장하지 않습니다.' })}>반려</AdminButton>
        <AdminButton role={role} size="sm" disabled={self} onClick={() => toast.success(`${r.id} 승인 · 시험 운영 시작`, { description: '시안이라 저장하지 않습니다.' })}>승인하고 시험 운영</AdminButton>
      </div>
      {self && role === 'ADMIN' && <p className="mt-2 text-right text-[0.6875rem] text-muted-foreground">작성자는 자기 룰을 승인할 수 없습니다.</p>}
    </Section> })}
    {shadow.map(r => <Section key={r.id} title={`${r.id} v${r.v} · ${tpl(r.tpl).name}`} description="시험 운영 중 · 10-02부터 · 결과만 저장하고 Alert 상세에는 안 보임" action={<StatusBadge status={r.status} />}>
      <p className="text-sm">{tpl(r.tpl).sentence(r.p)}</p>
      <p className="mt-3 text-xs">시험 운영 9일 · 적중 Alert <b className="tabular-nums">{r.hits}건</b> · 의심 종결 비율 <Outcome r={r} /></p>
      <div className="mt-3 flex justify-end gap-2"><AdminButton role={role} size="sm" variant="outline" onClick={() => toast('시험 운영 중단')}>중단</AdminButton><AdminButton role={role} size="sm" onClick={() => toast.success(`${r.id} 운영 전환`)}>운영으로 전환</AdminButton></div>
    </Section>)}
  </div>
}


// 기준값(10/11 김명기: 룰엔진 다섯 번째 탭). 현재 값은 origin/dev 사실: application.yml suspicious-tx.threshold 기본 0.7(분석 실행마다 threshold_value로 동결),
// API.md app.type.ambiguity-delta 기본 0.10. 지금은 서버 환경 변수라 화면에서 바꾸는 API가 없다(BE 147·148).
const THRESHOLDS = [
  { k: 'model', label: '모델 의심 임계값', value: 0.7, step: 0.05, min: 0.05, max: 0.95, unit: '점 이상이면 의심 거래', note: '바꾸면 Alert가 생기는 양이 달라집니다. 분석 실행마다 그때의 값이 기록돼 과거 Alert는 그대로입니다.', impact: (v: number) => Math.round(212 * Math.pow(0.7 / v, 2.2)) },
  { k: 'ambiguity', label: '유형 모호 기준', value: 0.1, step: 0.01, min: 0.01, max: 0.5, unit: '미만이면 유형 후보 2개', note: '상위 두 유형 확률의 차이가 이 값보다 작으면 유형을 하나로 단정하지 않고 두 개를 함께 보입니다.' },
  { k: 'policy', label: '회사 기준금액', value: POLICY_USD, step: 1000, min: 1000, max: 100000, unit: 'USD', note: '분할 입·출금 룰이 씁니다. 룰에는 적지 않고, 룰을 실행할 때 이 값을 함께 기록합니다.' },
]

function ThresholdTab({ role }: { role: Role }) {
  const [values, setValues] = useState<Record<string, number>>(Object.fromEntries(THRESHOLDS.map(t => [t.k, t.value])))
  const [reason, setReason] = useState('')
  const changed = THRESHOLDS.filter(t => values[t.k] !== t.value)
  return <div className="space-y-4">
    <div className="grid grid-cols-1 items-stretch gap-4 @5xl:grid-cols-3">{THRESHOLDS.map(t => <Card key={t.k} className="shadow-none"><CardContent className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold tracking-tight">{t.label}</h2><span className="text-xs text-muted-foreground tabular-nums">지금 {won(t.value)}</span></div>
      <label className="flex items-center gap-2 text-xs"><Input type="number" className="h-9 w-32 tabular-nums" value={values[t.k]} step={t.step} min={t.min} max={t.max} disabled={role !== 'ADMIN'} onChange={e => setValues({ ...values, [t.k]: Number(e.target.value) })} /><span className="text-muted-foreground">{t.unit}</span></label>
      <p className="text-xs leading-5 text-muted-foreground">{t.note}</p>
      {t.impact && <p className="mt-auto rounded-md border px-3 py-2 text-xs">최근 30일에 적용하면 Alert <b className="tabular-nums">212건 → {won(t.impact(values[t.k]))}건</b> <ProvenanceBadge kind="proposal" title="재계산 API 필요(BE 147·148)" /></p>}
    </CardContent></Card>)}</div>
    <Section title="바꾸기" description="관리자만 바꿀 수 있고, 다음 일 분석부터 적용됩니다">
      <p className="text-xs">{changed.length ? changed.map(t => `${t.label} ${won(t.value)} → ${won(values[t.k])}`).join(' · ') : '바뀐 값이 없습니다.'}</p>
      <Textarea className="mt-3 min-h-16 text-sm" placeholder="바꾸는 이유(이력에 남습니다)" value={reason} onChange={e => setReason(e.target.value)} disabled={role !== 'ADMIN'} />
      <div className="mt-3 flex justify-end"><AdminButton role={role} size="sm" disabled={!changed.length || !reason.trim()} onClick={() => toast.success('기준값 변경 예약 · 다음 일 분석부터', { description: '시안이라 저장하지 않습니다.' })}>변경 저장</AdminButton></div>
    </Section>
    <Section title="변경 이력" description="누가 · 언제 · 무엇을 · 왜">
      <Table><TableHeader><TableRow><TableHead>시각</TableHead><TableHead>항목</TableHead><TableHead>이전 → 이후</TableHead><TableHead>변경자</TableHead><TableHead>사유</TableHead></TableRow></TableHeader>
        <TableBody>{[['09-28 10:12', '모델 의심 임계값', '0.65 → 0.7', '관리자1', '시연 데이터 Alert 과다'], ['09-15 09:40', '회사 기준금액', '—  → 10,000 USD', '관리자2', '분할 입·출금 룰 준비']].map(r => <TableRow key={r[0]}>{r.map((c, i) => <TableCell key={i} className={i === 0 || i === 2 ? 'tabular-nums text-xs' : 'text-xs'}>{c}</TableCell>)}</TableRow>)}</TableBody></Table>
      <ProvenanceNote kind="proposal">지금은 서버 환경 변수라 화면에서 바꾸는 API와 이력이 없습니다(BE 147·148).</ProvenanceNote>
    </Section>
  </div>
}

export default function RulesPage() {
  const [tab, setTab] = useState<Tab>('list')
  const [role, setRole] = useMockRole()
  const [draft, setDraft] = useState<{ tpl: string; p: Record<string, number>; base?: Rule }>({ tpl: 'FANOUT', p: { hours: 24, n: 3, total: 10000 } })
  const open = (rule: Rule) => { setDraft({ tpl: rule.tpl, p: { ...rule.p }, base: rule.status === 'DRAFT' ? undefined : rule }); setTab('write') }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <PageHeading title="룰엔진" description="룰은 모델이 만든 Alert를 설명합니다. 템플릿을 고르고 값만 채워 만들며, 검증·백테스트·승인을 거친 버전만 운영합니다." badge={<ProvenanceBadge kind="proposal" title="BE MONEY17-147 계약 전 시안" />} />
      <MockRoleSwitch role={role} onChange={setRole} />
    </div>
    <UnderTabs value={tab} onChange={setTab} items={[{ value: 'list', label: '룰 목록', count: RULES.length }, { value: 'write', label: '룰 작성' }, { value: 'backtest', label: '백테스트' }, { value: 'approval', label: '승인', count: RULES.filter(r => r.status === 'PENDING').length }, { value: 'thresholds', label: '기준값' }]} />
    {tab === 'list' && <ListTab role={role} onOpen={open} onNew={() => { setDraft({ tpl: 'FANOUT', p: { hours: 24, n: 3, total: 10000 } }); setTab('write') }} />}
    {tab === 'write' && <WriteTab role={role} draft={draft} setDraft={setDraft} onBacktest={() => setTab('backtest')} />}
    {tab === 'backtest' && <BacktestTab role={role} draft={draft} />}
    {tab === 'approval' && <ApprovalTab role={role} me="관리자1" />}
    {tab === 'thresholds' && <ThresholdTab role={role} />}
  </div>
}
