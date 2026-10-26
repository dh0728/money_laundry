import { AlertVerdictForm } from './AlertVerdictForm'
// v24 Detail.tsx "검토 의견" 탭. 판정 선택지는 verdict.ts(9/28 결정)를 따른다.
import { useState } from 'react'
import type { AlertDetail } from '@/api/alerts'
import { alertResolutionLabels } from '@/api/codes'
import { SectionTitle } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ReviewLayout } from '@/features/alerts/ReviewLayout'
import { useMemoryState } from '@/lib/memory'
import { alertCode, episodeCode } from './alertFilters'
import { usd } from './metrics'
import { verdictOption, type AlertVerdict } from './verdict'

export type VerdictSubmit = { verdict: AlertVerdict; comment: string; episodeId?: number }

type Props = {
  alert: AlertDetail
  responsible: boolean
  episodes: number[]
  onSubmit: (submit: VerdictSubmit) => void
}

export default function AlertReview({ alert, responsible, episodes, onSubmit }: Props) {
  const key = `alert:${alert.alertId}`
  // 탭을 오가도 쓰던 내용이 남도록 메모리에 둔다(새로고침하면 사라짐)
  const [verdict, setVerdict] = useMemoryState<AlertVerdict>(`${key}:verdict`, 'normal')
  const [comment, setComment] = useMemoryState(`${key}:comment`, '')
  const [target, setTarget] = useMemoryState(`${key}:target`, '')
  const [confirm, setConfirm] = useState(false)
  const decided = alert.status !== 'OPEN'
  const locked = decided || !responsible
  const option = verdictOption(verdict)

  const counterparts = new Set(alert.transactions.flatMap(t => [t.fromAccount, t.toAccount])).size
  const owners = new Set(alert.transactions.flatMap(t => [t.fromOwnerName, t.toOwnerName]).filter(Boolean)).size
  const biggest = [...alert.transactions].sort((a, b) => b.amountUsd - a.amountUsd)[0]

  return (
    <>
    <ReviewLayout reference={<>
        <dl className="space-y-4 text-xs">
          <div><dt className="text-muted-foreground">검토 범위</dt><dd className="mt-1 font-medium">거래 {alert.transactions.length}건 · 소유주 {owners}명 · 계좌 {counterparts}개</dd></div>
          <div><dt className="text-muted-foreground">대표 계좌</dt><dd className="mt-1 font-mono">{alert.subjectAccount.account} · 은행 {alert.subjectAccount.bank}</dd></div>
          <div><dt className="text-muted-foreground">최대 거래</dt><dd className="mt-1 font-medium">{biggest ? `${biggest.txId} · ${usd(biggest.amountUsd)}` : '거래 없음'}</dd></div>
          <div><dt className="text-muted-foreground">임계 초과 비율</dt><dd className="mt-1 font-medium">{Math.round(alert.scoreStats.aboveRatio * 100)}%</dd></div>
        </dl>
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium">판단 전 확인</p>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground"><li>거래 목적과 고객 프로필이 일치하는가</li><li>송금·수취 관계를 입증할 자료가 있는가</li><li>같은 소유주의 다른 Alert가 있는가</li></ul>
        </div>

    </>}> 
        <SectionTitle
          title={decided ? '판정 완료' : '검토 의견'}
          description={decided ? '이미 판정한 Alert입니다.' : 'Alert를 통째로 판정합니다. 정상이면 종결하고, 이상거래면 어디로 보낼지 고르세요.'}
        />
        {decided && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="decided-summary">
            {alert.status === 'ESCALATED' && alert.episodeId != null
              ? <>이상거래 · {episodeCode(alert.episodeId)}에 연결됨</>
              : alert.resolution ? alertResolutionLabels[alert.resolution] : '종결'}
          </p>
        )}
        <AlertVerdictForm verdict={verdict} setVerdict={setVerdict} comment={comment} setComment={setComment}
          target={target} setTarget={setTarget} locked={locked} episodes={episodes} onConfirm={() => setConfirm(true)} />
    </ReviewLayout>



      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertCode(alert.alertId)} · {option.group === '이상거래' ? `이상거래 · ${option.label}` : option.label}</AlertDialogTitle>
            <AlertDialogDescription>{option.result}{verdict === 'link-episode' && target ? ` · ${episodeCode(Number(target))}` : ''}. 판단 근거와 담당자를 처리 이력에 남깁니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{comment}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onSubmit({ verdict, comment: comment.trim(), episodeId: target ? Number(target) : undefined }); setComment('') }}>{option.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
