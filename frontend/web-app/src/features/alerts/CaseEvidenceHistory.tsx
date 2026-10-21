import type { ReactNode } from 'react'
import type { ReviewCase, ReviewKind, ReviewMember } from '@/api/liveReview'
import { Button } from '@/components/ui/button'

const decisionText = (decision: ReviewMember['decision']) => decision === 'NORMAL' ? '정상' : decision === 'SUSPICIOUS' ? '의심' : '판정 없음'
const stateText: Record<ReviewMember['state'], string> = { PENDING: '미판정', DECIDED: '판정 완료', EXCLUDED: '제외', TRANSFERRED: '이관' }
const caseName = (kind: ReviewKind, id: number) => `${kind === 'ALERT' ? 'Alert A' : 'Episode E'}-${id}`

function HistoryDetails({ title, count, empty, children }: { title: string; count: number | undefined; empty: string; children: ReactNode }) {
  return <details className="min-w-0 rounded-lg border bg-card p-3">
    <summary className="cursor-pointer break-words text-sm font-medium">{title} · {count === undefined ? '미제공' : `${count}건`}</summary>
    <div className="mt-3 min-w-0 space-y-3 text-xs">
      {count === undefined ? <p className="text-muted-foreground">정보 미제공</p> : count === 0 ? <p className="text-muted-foreground">{empty}</p> : children}
    </div>
  </details>
}

export default function CaseEvidenceHistory({ item, onOpenCase }: { item: ReviewCase; onOpenCase: (kind: ReviewKind, caseId: number) => void }) {
  const currentAlertId = item.alertId ?? item.caseId
  const openButton = (kind: ReviewKind, id: number, representative = false) => {
    const name = `${representative ? '대표 ' : ''}${caseName(kind, id)} 보기`
    return <Button type="button" variant="outline" size="sm" className="h-auto max-w-full whitespace-normal break-all text-left" aria-label={name} onClick={() => onOpenCase(kind, id)}>{name}</Button>
  }
  return <section aria-label="사건 연결·보존 판정" className="min-w-0 space-y-3">
    <h3 className="text-sm font-semibold">사건 연결·보존 판정</h3>
    {item.kind === 'ALERT' && <div className="min-w-0 rounded-lg border p-3 text-xs">
      {item.canonicalAlertId === undefined ? <p className="text-muted-foreground">대표 Alert 정보 미제공</p>
        : item.canonicalAlertId === null ? <p className="text-muted-foreground">대표 Alert 없음</p>
          : item.canonicalAlertId === currentAlertId ? <p className="break-all">A-{item.canonicalAlertId} · 현재 사건이 대표 Alert입니다.</p>
            : <div className="min-w-0 space-y-2"><p>대표 사건의 현재 범위는 해당 Alert에서 확인하세요.</p>{openButton('ALERT', item.canonicalAlertId, true)}</div>}
    </div>}
    <HistoryDetails title="다른 사건의 판정" count={item.relatedDecisions?.length} empty="다른 사건의 판정 없음">
      <p className="text-muted-foreground">같은 거래에 대한 참고 판정이며 현재 사건의 판정을 바꾸지 않습니다.</p>
      <ul className="min-w-0 space-y-2">
        {item.relatedDecisions?.map((entry, index) => <li key={`${entry.kind}-${entry.caseId}-${entry.groupId}-${entry.txId}-${index}`} className="min-w-0 space-y-2 rounded-md bg-muted/40 p-2">
          <p className="break-all">거래 {entry.txId} · 묶음 {entry.groupId}</p>
          <p>{decisionText(entry.decision)} · {entry.status === 'CLOSED' ? '종결' : '열림'}</p>
          {openButton(entry.kind, entry.caseId)}
        </li>)}
      </ul>
    </HistoryDetails>
    {item.kind === 'ALERT' && <>
      <HistoryDetails title="현재 근거에서 빠진 거래" count={item.withdrawnMembers?.length} empty="철회된 거래 없음">
        <p className="text-muted-foreground">현재 조사 범위에 포함되지 않는 보존 기록입니다.</p>
        <ul className="min-w-0 space-y-2">
          {item.withdrawnMembers?.map((entry, index) => <li key={`${entry.txId}-${entry.evidenceVersion}-${index}`} className="min-w-0 space-y-1 rounded-md bg-muted/40 p-2">
            <p className="break-all">거래 {entry.txId}</p>
            <p className="break-words">근거 버전 {entry.evidenceVersion} · {entry.reviewRole === 'SUBJECT' ? '조사 대상' : '참고 맥락'}</p>
            <p>{stateText[entry.state]} · {decisionText(entry.decision)}</p>
          </li>)}
        </ul>
      </HistoryDetails>
      <HistoryDetails title="이전·후속 Alert" count={item.relations?.length} empty="연결된 Alert 없음">
        <p className="text-muted-foreground">API에 기록된 출발 Alert → 도착 Alert 순서입니다. 현재 소속을 뜻하지 않습니다.</p>
        <ul className="min-w-0 space-y-2">
          {item.relations?.map((entry, index) => <li key={`${entry.event_id}-${entry.source_alert_id}-${entry.target_alert_id}-${index}`} className="min-w-0 space-y-2 rounded-md bg-muted/40 p-2">
            <p className="break-all">{entry.kind} · 이벤트 {entry.event_id}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {entry.source_alert_id === currentAlertId ? <span className="break-all">A-{entry.source_alert_id} · 현재 사건</span> : openButton('ALERT', entry.source_alert_id)}
              <span aria-label="다음 연결">→</span>
              {entry.target_alert_id === currentAlertId ? <span className="break-all">A-{entry.target_alert_id} · 현재 사건</span> : openButton('ALERT', entry.target_alert_id)}
            </div>
          </li>)}
        </ul>
      </HistoryDetails>
      <HistoryDetails title="열린 변경 제안" count={item.pendingProposalIds?.length} empty="열린 변경 제안 없음">
        <p className="font-medium">현재 공개 범위 유지 · 미반영</p>
        <p className="text-muted-foreground">제안 상세·동의 처리는 이 화면에 연결되지 않았습니다.</p>
        <ul className="min-w-0 space-y-1">{item.pendingProposalIds?.map(id => <li key={id} className="break-all">제안 {id}</li>)}</ul>
      </HistoryDetails>
    </>}
  </section>
}
