/* eslint-disable react-refresh/only-export-components -- Step·Row 컴포넌트와 계산 함수를 한 파일에 둠 */
// UI 재설계(MONEY17-174) Alert 상세 개요 시안. 읽는 순서 ①~⑦은 10/6 회의·팀장 목업과 같고, 10/8·10/11 김명기 승인 반영.
import { NumBadge } from '@/components/NumBadge'
import type { ReactNode } from 'react'
import type { AlertDetail as AlertDetailData, AlertAccountRole, HistoryRow } from '@/api/alerts'
import { typeDisplay } from '@/api/codes'
import { PatternBadge } from '@/components/badges'
import { ProvenanceBadge, ProvenanceNote } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CaseStats } from './CasePresentation'
import { CaseActivityCharts } from './CaseActivityCharts'
import { Panel } from './DetailPanels'
import { historyLabels } from './detailText'
import { sumBy, usd } from './metrics'

const roleLabels: Record<AlertAccountRole, string> = { SUBJECT: '대표', SOURCE: '출발', DESTINATION: '도착', INTERMEDIARY: '경유', HUB: '허브' }

/** 질문 번호와 출처를 제목 앞에 붙인 패널 */
export function Step({ n, title, description, source, children, wide, action }: { n?: number; title: string; description?: string; source: string; children: ReactNode; wide?: boolean; action?: ReactNode }) {
  return <div className={wide ? '@5xl:col-span-2' : undefined}>
    <Panel title={<span className="inline-flex items-center gap-2">{n != null && <NumBadge n={n} />}{title}</span>} description={description} action={<span className="flex items-center gap-1.5">{action}<Badge variant="outline" className="font-normal text-muted-foreground">{source}</Badge></span>}>{children}</Panel>
  </div>
}

export const Row = ({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) => <>
  <dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}{note && <span className="ml-1.5 text-muted-foreground">{note}</span>}</dd>
</>

/** 사건 밖에서 들어오고 나간 돈. 사건 안 경유 거래를 두 번 세지 않는다(거래 총액을 쓰지 않는 이유, 10/11) */
export function flowFacts(tx: Pick<AlertDetailData['transactions'][number], 'fromAccount' | 'toAccount' | 'amountUsd'>[]) {
  const senders = new Set(tx.map(t => t.fromAccount))
  const receivers = new Set(tx.map(t => t.toAccount))
  const externalIn = tx.filter(t => !receivers.has(t.fromAccount)).reduce((s, t) => s + t.amountUsd, 0)
  const externalOut = tx.filter(t => !senders.has(t.toAccount)).reduce((s, t) => s + t.amountUsd, 0)
  return { senders, receivers, externalIn, externalOut, passThrough: [...senders].filter(a => receivers.has(a)) }
}

export function overviewFacts(alert: AlertDetailData) {
  const tx = alert.transactions
  const { externalIn, externalOut, passThrough } = flowFacts(tx)
  const inDegree = sumBy(tx, t => t.toAccount, () => 1)[0]
  const outDegree = sumBy(tx, t => t.fromAccount, () => 1)[0]
  const seeds = tx.filter(t => t.role === 'SEED')
  return { tx, externalIn, externalOut, passThrough, inDegree, outDegree, seeds }
}

export default function RedesignOverview({ alert, history, onAccounts }: { alert: AlertDetailData; history: HistoryRow[]; onAccounts: () => void }) {
  const { tx, externalIn, externalOut, passThrough, inDegree, outDegree, seeds } = overviewFacts(alert)
  const times = tx.map(t => t.txAt).sort()
  const span = times.length ? `${times[0].slice(5, 10)} ~ ${times[times.length - 1].slice(5, 10)}` : '—'
  const daily = sumBy(tx, t => t.txAt.slice(5, 10), t => t.amountUsd).sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ day: d.name, amount: Math.round(d.v) }))
  const topSenders = sumBy(tx, t => t.fromAccount, t => t.amountUsd).slice(0, 5)
  const net = alert.accounts.find(a => a.role === 'SUBJECT')
  const share = alert.typeDistribution[`${alert.primaryType.code}`]
  const topAccounts = [...alert.accounts].sort((a, b) => (b.inAmountUsd + b.outAmountUsd) - (a.inAmountUsd + a.outAmountUsd)).slice(0, 5)

  return <div className="space-y-4" data-testid="overview">
    {/* 요약 카드 5개. 거래 총액은 경유 거래를 중복으로 세어 넣지 않는다(10/11) */}
    <CaseStats items={[
      { label: '외부 유입액', value: usd(externalIn), secondary: '사건 밖에서 들어온 돈' },
      { label: '순유입 (대표 계좌)', value: net ? usd(net.inAmountUsd - net.outAmountUsd) : '데이터 없음' },
      { label: '근거 거래', value: `${tx.length}건`, secondary: `씨앗 거래 ${seeds.length}건` },
      { label: '참여 계좌', value: `${alert.accountCount}개`, secondary: `은행 ${alert.bankCount}곳` },
      { label: '거래 기간', value: span },
    ]} />

    <div className="grid grid-cols-1 items-stretch gap-4 @5xl:grid-cols-2">
      <Step n={1} title="왜 Alert가 됐나" description="모델이 의심한 씨앗 거래와 대표 유형" source="모델">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><PatternBadge code={alert.primaryType.code} /><span>{typeDisplay(alert.primaryType.code).label}</span>{share != null && <span className="text-muted-foreground">씨앗 중 {Math.round(share * 100)}%</span>}</div>
        <Table><TableHeader><TableRow><TableHead>거래</TableHead><TableHead>송금 → 수취</TableHead><TableHead className="text-right">금액</TableHead><TableHead className="text-right">점수</TableHead></TableRow></TableHeader>
          <TableBody>{seeds.slice(0, 4).map(t => <TableRow key={t.txId}><TableCell className="font-mono text-xs">T-{t.txId}</TableCell><TableCell className="font-mono text-xs">{t.fromAccount} → {t.toAccount}</TableCell><TableCell className="text-right tabular-nums">{usd(t.amountUsd)}</TableCell><TableCell className="text-right tabular-nums">{t.launderingScore.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>
        <div className="mt-4 rounded-md border border-dashed p-3 text-xs">
          <p className="font-medium">룰 적중</p>
          <p className="mt-1 text-muted-foreground">룰 엔진이 아직 연결되지 않아 이 Alert에 걸린 룰을 확인할 수 없습니다. "걸린 룰 없음"과 다릅니다.</p>
          <div className="mt-2"><ProvenanceBadge kind="planned" title="BE MONEY17-147 룰엔진 계약 뒤 연결" /></div>
        </div>
      </Step>

      <Step n={2} title="돈이 어떻게 움직였나" description="사건 밖에서 들어오고 나간 돈" source="계산">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs">
          <Row label="외부 유입" value={usd(externalIn)} />
          <Row label="외부 유출" value={usd(externalOut)} />
          <Row label="경유 비율" value={externalIn ? `${Math.round((externalOut / externalIn) * 100)}%` : '산출 불가'} note="외부 유출 ÷ 외부 유입" />
          <Row label="외부 이동 건수" value={<ProvenanceBadge kind="proposal" title="서버 조회 필요(2단계)" />} note="2단계" />
        </dl>
      </Step>

      <div className="@5xl:col-span-2"><CaseActivityCharts amounts={{ USD: { daily, senders: topSenders } }} /></div>

      <Step n={3} title="어떤 모양인가" description="모델 대표 유형과 실제 거래 구조를 나란히" source="모델·관측">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs">
          <Row label="모델 대표 유형" value={<PatternBadge code={alert.primaryType.code} />} />
          <Row label="집중 수취" value={inDegree ? `${inDegree.v}건 → 1계좌` : '—'} note={inDegree?.name} />
          <Row label="분산 송금" value={outDegree ? `1계좌 → ${outDegree.v}건` : '—'} note={outDegree?.name} />
          <Row label="경유 계좌" value={`${passThrough.length}개`} note="받고 다시 보낸 계좌" />
        </dl>
      </Step>

      <Step n={4} title="누가 관여했나" description="금액이 큰 계좌 5개" source="관측" action={<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onAccounts}>전체 계좌 {alert.accounts.length}개 보기</Button>}>
        <Table><TableHeader><TableRow><TableHead>계좌</TableHead><TableHead>역할</TableHead><TableHead className="text-right">유입</TableHead><TableHead className="text-right">유출</TableHead></TableRow></TableHeader>
          <TableBody>{topAccounts.map(a => <TableRow key={a.account}><TableCell className="font-mono text-xs">{a.account}<span className="ml-1.5 text-muted-foreground">은행 {a.bank}</span></TableCell><TableCell className="text-xs">{roleLabels[a.role]}</TableCell><TableCell className="text-right tabular-nums">{usd(a.inAmountUsd)}</TableCell><TableCell className="text-right tabular-nums">{usd(a.outAmountUsd)}</TableCell></TableRow>)}</TableBody></Table>
      </Step>

      <Step n={5} title="전에 본 적 있나" description="같은 거래·계좌가 나온 다른 사건" source="사람·관측">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs">
          <Row label="같은 거래 판정" value="다른 사건 판정 없음" />
          <Row label="이어진 Alert" value="없음" note="종결 뒤 재탐지면 A-… 에서 이어짐" />
        </dl>
        <div className="mt-4 space-y-2">
          <p className="flex items-center gap-2 text-xs font-medium">연관 Alert 후보<ProvenanceBadge kind="proposal" title="계좌·소유주로 사건을 찾는 API 필요(2단계)" /></p>
          {[{ id: 'A-3017', who: '송동현', same: '계좌 2개 공유' }, { id: 'A-3022', who: alert.assignee.name, same: '소유주 1명 공유' }].map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="font-mono">{c.id}</span><span className="text-muted-foreground">{c.same}</span><Badge variant="outline" className="font-normal">담당 {c.who}</Badge>
            {c.who !== alert.assignee.name && <span className="w-full text-[0.6875rem] text-muted-foreground">묶으면 담당자에게 알림이 갑니다</span>}
          </div>)}
        </div>
      </Step>

      <Step n={6} title="어디까지 봤나" description="이 화면 숫자의 기준과 빠진 부분" source="한계">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs">
          <Row label="근거 기준 시각" value={alert.lastTxAt.replace('T', ' ').slice(0, 16)} />
          <Row label="근거 버전" value="v2" note="09-25 재검사" />
          <Row label="은행 수신 완결" value={<span className="flex flex-wrap gap-1">{['09-22', '09-23', '09-24'].map(d => <Badge key={d} variant="outline" className="font-normal">{d} 완결</Badge>)}<Badge variant="outline" className="border-dashed font-normal">09-25 수신 중</Badge></span>} />
          <Row label="탐색 한도" value={`한도 안 (${tx.length} / 100건)`} note="넘으면 일부 거래가 빠짐" />
        </dl>
      </Step>

      <Step n={7} title="처리 이력" description="누가 · 언제 · 무엇을 · 왜" source="사람" wide>
        <div className="divide-y">{history.map(e => <div key={e.id} className="flex gap-2.5 py-2">
          <span className="w-11 shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">{e.at.slice(5, 10)}</span>
          <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground" />
          <div className="min-w-0 flex-1 text-xs"><p>{historyLabels[e.action]}<span className="ml-2 text-muted-foreground">{e.actor.name}</span></p>{e.comment && <p className="mt-1 truncate text-muted-foreground">{e.comment}</p>}</div>
        </div>)}</div>
      </Step>
    </div>
    <ProvenanceNote kind="mock">시안용 mock 데이터입니다. 출처 표시: 모델 · 관측 · 계산 · 사람 · 룰 · 한계</ProvenanceNote>
  </div>
}
