// v24 Detail.tsx(kind=Episode) "검토 의견" 탭.
// 9/28 회의: Episode는 생성에서 끝내고 관리자(검토자)에게 검수를 넘기는 기능만 둔다.
// v24의 L2 종결·보고 확정·상위 검토 선택지는 L1·L2 구분이 없어져 뺐다.
import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import type { EpisodeDetail } from '@/api/episodes'
import { SectionTitle } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { episodeCode } from '@/features/alerts/alertFilters'
import { usd } from '@/features/alerts/metrics'
import { useMemoryState } from '@/lib/memory'

// 저장된 ISO 시각을 이 컴퓨터 시간대(서울)의 YYYY-MM-DD HH:mm으로
const localTime = (iso: string) => new Date(iso).toLocaleString('sv-SE').slice(0, 16)

type Props = {
  episode: EpisodeDetail
  responsible: boolean
  onComment: (comment: string) => void
  onRequestReview: (comment: string) => void
}

export default function EpisodeReview({ episode, responsible, onComment, onRequestReview }: Props) {
  const [comment, setComment] = useMemoryState(`episode:${episode.episodeId}:comment`, '')
  const [confirm, setConfirm] = useState(false)
  const requested = Boolean(episode.reviewRequestedAt)
  const locked = !responsible || episode.status === 'CLOSED'
  const ready = !locked && comment.trim().length > 0

  return (
    <div className="grid flex-1 items-stretch gap-4 @5xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="review-layout">
      <Card className="h-full w-full shadow-none"><CardContent className="flex h-full flex-col gap-6">
        <SectionTitle title="조사 의견" description="묶은 근거와 조사 내용을 남기고, 끝나면 관리자에게 검수를 넘깁니다." />
        {requested && <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="review-requested">관리자 검수 요청됨 · {localTime(episode.reviewRequestedAt!)}</p>}
        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label htmlFor="episode-comment">조사 의견 <span className="text-muted-foreground">(필수)</span></Label>
          <Textarea id="episode-comment" value={comment} onChange={e => setComment(e.target.value)} disabled={locked} className="min-h-[280px] flex-1 resize-y text-sm leading-7" placeholder="어떤 주체가 어떤 패턴으로 자금을 옮겼는지, 연결한 Alert의 공통점을 작성하세요." />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={!ready} onClick={() => { onComment(comment.trim()); setComment('') }}><MessageSquare className="size-3.5" />의견만 남기기</Button>
          <Button size="sm" disabled={!ready || requested} onClick={() => setConfirm(true)}><Send className="size-3.5" />관리자 검수 넘기기</Button>
        </div>
        <p className="text-right text-[11px] text-muted-foreground"><Badge variant="outline" className="mr-1.5 font-normal">FE 제안</Badge>검수 넘김은 API 계약에 아직 없어 시연 화면에서만 저장됩니다.</p>
      </CardContent></Card>

      <Card className="h-full shadow-none" data-testid="review-reference"><CardContent>
        <SectionTitle title="참고 정보" description="검수 전에 대조할 조사 요약" />
        <dl className="space-y-4 text-xs">
          <div><dt className="text-muted-foreground">구성</dt><dd className="mt-1 font-medium">Alert {episode.alertCount}건 · 거래 {episode.flow.txCount}건</dd></div>
          <div><dt className="text-muted-foreground">대표 계좌 유입 · 유출</dt><dd className="mt-1 font-medium">{usd(episode.flow.inflowUsd)} · {usd(episode.flow.outflowUsd)}</dd></div>
          <div><dt className="text-muted-foreground">통과 비율</dt><dd className="mt-1 font-medium">{Math.round(episode.flow.passThroughRatio * 100)}% (유출 ÷ 유입)</dd></div>
        </dl>
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium">검수 전 확인</p>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground"><li>연결한 Alert가 같은 주체(사람·관계)의 흐름인가</li><li>패턴별 근거 거래를 확인했는가</li><li>대표 계좌의 다른 Alert 이력을 봤는가</li></ul>
        </div>
      </CardContent></Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{episodeCode(episode.episodeId)} · 관리자 검수 넘기기</AlertDialogTitle>
            <AlertDialogDescription>조사 의견과 함께 관리자에게 검수를 요청합니다. 검토자 지정은 기관 정책을 따릅니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{comment}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onRequestReview(comment.trim()); setComment('') }}>검수 넘기기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
