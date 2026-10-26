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
import { toast } from 'sonner'
import { PatternBadge } from '@/components/badges'
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

  // 재설계 S5 참고 정보: 조사 범위·미판정 수, 대표 유형·씨앗, 같은 거래의 다른 사건 판정, 저장본(COMMENT 기록)
  const [drafts, setDrafts] = useMemoryState<{ at: string; text: string }[]>(`${key}:drafts`, [])
  const seeds = alert.transactions.filter(t => t.role === 'SEED')
  const saveDraft = () => { setDrafts([{ at: new Date().toTimeString().slice(0, 5), text: comment.trim() }, ...drafts]); toast.success('임시 저장', { description: '처리 이력에 의견(COMMENT)으로 남습니다. 시안이라 서버에는 보내지 않습니다.' }) }

  return (
    <>
    <ReviewLayout reference={<>
        <dl className="space-y-4 text-xs">
          <div><dt className="text-muted-foreground">조사 범위</dt><dd className="mt-1 font-medium tabular-nums">거래 {alert.transactions.length}건 · 미판정 {alert.status === 'OPEN' ? alert.transactions.length : 0}건</dd></div>
          <div><dt className="text-muted-foreground">대표 유형</dt><dd className="mt-1 flex items-center gap-2"><PatternBadge code={alert.primaryType.code} /><span className="text-muted-foreground">씨앗 거래 {seeds.length}건{seeds[0] ? ` · T-${seeds[0].txId} 점수 ${seeds[0].launderingScore.toFixed(2)}` : ''}</span></dd></div>
          <div><dt className="text-muted-foreground">같은 거래의 다른 사건 판정</dt><dd className="mt-1">없음</dd></div>
        </dl>
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium">저장본 {drafts.length}개</p>
          {drafts.length ? <ul className="mt-2 space-y-2 text-xs">{drafts.map((d, i) => <li key={i} className="rounded-md border px-2.5 py-2"><span className="tabular-nums text-muted-foreground">{d.at}</span><p className="mt-1 line-clamp-2">{d.text}</p><button type="button" className="mt-1 text-[0.6875rem] underline underline-offset-4" onClick={() => setComment(d.text)}>불러오기</button></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">임시 저장한 의견이 여기에 쌓입니다.</p>}
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
          target={target} setTarget={setTarget} locked={locked} episodes={episodes} onConfirm={() => setConfirm(true)}
          onDraft={saveDraft} draftCount={drafts.length} onOpenDrafts={() => document.querySelector('[data-testid=review-reference]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })} />
    </ReviewLayout>



      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertCode(alert.alertId)} · {option.label}</AlertDialogTitle>
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
