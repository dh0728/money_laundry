// UI 재설계 S20 구성원·권한, S21 감사 이력 시안(김명기 10/6 제안: 사이드바가 아니라 ADMIN에게만 보이는 설정 탭).
// API 없음 → BE MONEY17-149(11/02~11/13). Q11: 역할은 STAFF·ADMIN 둘, ADMIN이 모든 권한, ADMIN은 자기 권한을 못 바꾼다.
import { useState } from 'react'
import { toast } from 'sonner'
import { AdminButton, type MockRole } from '@/components/MockRole'
import { SectionTitle } from '@/components/page'
import { ProvenanceNote } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// 권한 후보(정의는 팀·Backend). high = 결과가 커서 STAFF 기본값을 꺼 둔다
const PERMS = [
  { k: 'decide', label: '판정·종결', high: false }, { k: 'episode', label: 'Episode 묶기', high: false }, { k: 'exclude', label: '조사 범위 제거', high: false },
  { k: 'export', label: '보고서 내보내기', high: false }, { k: 'raw', label: '원문(실명·계좌번호) 열람', high: true }, { k: 'rule', label: '룰 생성·수정·활성화', high: true },
  { k: 'threshold', label: '기준값 변경', high: true }, { k: 'backtest', label: '백테스트 실행', high: true }, { k: 'reassign', label: '담당 재배정', high: true },
]
type Member = { id: number; name: string; username: string; role: MockRole; open: number; aged: number; last: string }
const MEMBERS: Member[] = [
  { id: 1, name: '관리자1', username: 'admin01', role: 'ADMIN', open: 0, aged: 0, last: '방금' },
  { id: 2, name: '관리자2', username: 'admin02', role: 'ADMIN', open: 0, aged: 0, last: '10-11 09:12' },
  { id: 11, name: '오분석', username: 'staff11', role: 'STAFF', open: 22, aged: 8, last: '10-11 15:40' },
  { id: 12, name: '송분석', username: 'staff12', role: 'STAFF', open: 17, aged: 3, last: '10-10 18:05' },
  { id: 13, name: '김분석', username: 'staff13', role: 'STAFF', open: 9, aged: 0, last: '10-11 11:20' },
]
const defaults = (role: MockRole) => Object.fromEntries(PERMS.map(p => [p.k, role === 'ADMIN' || !p.high]))

export function MembersTab({ role, me = 1 }: { role: MockRole; me?: number }) {
  const [sel, setSel] = useState(MEMBERS[2])
  const [draftRole, setDraftRole] = useState<MockRole>(sel.role)
  const [perms, setPerms] = useState<Record<string, boolean>>(defaults(sel.role))
  const [reason, setReason] = useState('')
  const pick = (m: Member) => { setSel(m); setDraftRole(m.role); setPerms(defaults(m.role)); setReason('') }
  const self = sel.id === me, base = defaults(sel.role)
  const changes = [...(draftRole !== sel.role ? [`역할 ${sel.role === 'ADMIN' ? '관리자' : '조사자'} → ${draftRole === 'ADMIN' ? '관리자' : '조사자'}`] : []), ...PERMS.filter(p => perms[p.k] !== base[p.k]).map(p => `${p.label} ${perms[p.k] ? '허용' : '해제'}`)]
  const locked = role !== 'ADMIN' || self
  return <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
    <Card className="shadow-none"><CardContent><SectionTitle title="구성원" description={`${MEMBERS.length}명 · 행을 고르면 오른쪽에서 권한을 봅니다`} />
      <Table><TableHeader><TableRow><TableHead>이름</TableHead><TableHead>역할</TableHead><TableHead className="text-right">담당 미처리</TableHead><TableHead className="text-right">72시간 경과</TableHead><TableHead>마지막 활동</TableHead></TableRow></TableHeader>
        <TableBody>{MEMBERS.map(m => <TableRow key={m.id} aria-selected={sel.id === m.id} className={`cursor-pointer ${sel.id === m.id ? 'bg-muted/50' : ''}`} onClick={() => pick(m)}>
          <TableCell>{m.name}<span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.username}</span>{m.id === me && <Badge variant="outline" className="ml-2 font-normal">나</Badge>}</TableCell>
          <TableCell className="text-xs">{m.role === 'ADMIN' ? '관리자' : '조사자'}</TableCell><TableCell className="text-right tabular-nums">{m.open}</TableCell><TableCell className="text-right tabular-nums">{m.aged}</TableCell><TableCell className="tabular-nums text-xs">{m.last}</TableCell>
        </TableRow>)}</TableBody></Table>
    </CardContent></Card>
    <Card className="shadow-none"><CardContent className="space-y-4"><SectionTitle title={`${sel.name} 권한`} description={self ? '자기 권한은 바꿀 수 없습니다(직무 분리)' : '바꾼 내용은 저장 전에 요약해 보여 줍니다'} />
      <label className="flex items-center gap-3 text-xs"><span className="w-12 text-muted-foreground">역할</span>
        <Select value={draftRole} disabled={locked} onValueChange={v => { setDraftRole(v as MockRole); setPerms(defaults(v as MockRole)) }}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="STAFF">조사자</SelectItem><SelectItem value="ADMIN">관리자</SelectItem></SelectContent></Select></label>
      <div className="grid grid-cols-1 gap-2 @3xl:grid-cols-2">{PERMS.map(p => <Label key={p.k} className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs font-normal">
        <Checkbox checked={perms[p.k]} disabled={locked || draftRole === 'ADMIN'} onCheckedChange={v => setPerms({ ...perms, [p.k]: Boolean(v) })} />{p.label}{p.high && <span className="ml-auto text-[0.6875rem] text-muted-foreground">영향 큼</span>}
      </Label>)}</div>
      {draftRole === 'ADMIN' && <p className="text-xs text-muted-foreground">관리자는 모든 권한을 가집니다(Q11).</p>}
      {sel.open > 0 && <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"><span>담당 미처리 {sel.open}건</span><AdminButton role={role} size="sm" variant="outline" onClick={() => toast('재배정 대상 고르기', { description: '시안이라 열지 않습니다.' })}>담당 재배정</AdminButton></div>}
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">{changes.length ? <><p className="font-medium">저장 전 변경 요약</p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{changes.map(c => <li key={c}>{c}</li>)}</ul></> : <p className="text-muted-foreground">바뀐 내용이 없습니다.</p>}</div>
      <Textarea className="min-h-16 text-sm" placeholder="바꾸는 이유(감사 이력에 남습니다)" value={reason} onChange={e => setReason(e.target.value)} disabled={locked} />
      <div className="flex justify-end"><AdminButton role={role} size="sm" disabled={self || !changes.length || !reason.trim()} onClick={() => toast.success(`${sel.name} 권한 변경`, { description: '시안이라 저장하지 않습니다.' })}>적용</AdminButton></div>
      <ProvenanceNote kind="proposal">권한 지정·재배정 API가 아직 없습니다(BE 149).</ProvenanceNote>
    </CardContent></Card>
  </div>
}

const AUDIT = [
  ['10-11 15:40', '10-11 15:40', '오분석', '조사자', '의견 저장', 'A-3010', '분산 송금 경로 확인 중'],
  ['10-11 14:02', '10-11 14:02', '관리자1', '관리자', '권한 변경', '송분석', '원문 열람 권한 해제 · 업무 범위 조정'],
  ['10-11 11:20', '10-11 11:20', '김분석', '조사자', 'Episode 묶기', 'E-801 ← A-3017', '같은 수취 계좌 2개 공유 · 담당자 송분석에게 알림'],
  ['10-11 09:12', '10-11 09:13', '관리자2', '관리자', '룰 승인', 'RULE-005 v1', '백테스트 의심 종결 58% · 시험 운영'],
  ['10-10 18:05', '10-10 18:05', '송분석', '조사자', '정상 종결', 'A-3022', '정기 급여 이체로 확인'],
  ['10-09 10:31', '10-09 10:31', '관리자2', '관리자', '승인 요청', 'RULE-004 v1', '분산 송금 룰 첫 버전 · 백테스트 첨부'],
]
export function AuditTab() {
  const [who, setWho] = useState('all'), [what, setWhat] = useState('all')
  const rows = AUDIT.filter(r => (who === 'all' || r[2] === who) && (what === 'all' || r[4] === what))
  return <Card className="shadow-none"><CardContent className="space-y-4"><SectionTitle title="감사 이력" description="누가 · 언제 · 무엇을 · 왜. 업무 시각과 실제 저장 시각을 함께 남깁니다" />
    <div className="flex flex-wrap gap-3 text-xs">
      <label className="space-y-1.5"><span className="block text-muted-foreground">사용자</span><Select value={who} onValueChange={setWho}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">전체</SelectItem>{MEMBERS.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1.5"><span className="block text-muted-foreground">행동</span><Select value={what} onValueChange={setWhat}><SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">전체</SelectItem>{[...new Set(AUDIT.map(r => r[4]))].map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></label>
    </div>
    <Table><TableHeader><TableRow><TableHead>업무 시각</TableHead><TableHead>저장 시각</TableHead><TableHead>사용자</TableHead><TableHead>행동</TableHead><TableHead>대상</TableHead><TableHead className="w-[32%]">사유</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(r => <TableRow key={r[0] + r[2]}><TableCell className="tabular-nums text-xs">{r[0]}</TableCell><TableCell className="tabular-nums text-xs text-muted-foreground">{r[1]}</TableCell><TableCell className="text-xs">{r[2]}<span className="ml-1.5 text-muted-foreground">{r[3]}</span></TableCell><TableCell className="text-xs">{r[4]}</TableCell><TableCell className="font-mono text-xs">{r[5]}</TableCell><TableCell className="whitespace-normal text-xs text-muted-foreground">{r[6]}</TableCell></TableRow>)}</TableBody></Table>
    <ProvenanceNote kind="proposal">사건별 이력은 지금 API에 있고(사건 상세 history), 사용자별·관리 행동(권한·룰·기준값) 조회는 없습니다(BE 149).</ProvenanceNote>
  </CardContent></Card>
}
