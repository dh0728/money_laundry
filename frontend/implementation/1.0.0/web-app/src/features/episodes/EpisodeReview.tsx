// v24 Detail.tsx(kind=Episode) "검토 의견" 탭.
// 9/28 회의: Episode는 생성에서 끝내고 관리자(검토자)에게 검수를 넘기는 기능만 둔다.
// v24의 L2 종결·보고 확정·상위 검토 선택지는 L1·L2 구분이 없어져 뺐다.
import { MessageSquare, Send } from 'lucide-react'
import type { EpisodeDetail } from '@/api/episodes'
import { SectionTitle } from '@/components/page'
import { Button } from '@/components/ui/button'
import { ReviewLayout } from '@/features/alerts/ReviewLayout'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

export default function EpisodeReview({ episode, responsible, onComment }: Props) {
  const [comment, setComment] = useMemoryState(`episode:${episode.episodeId}:comment`, '')
  const requested = Boolean(episode.reviewRequestedAt)
  const locked = !responsible || episode.status === 'CLOSED'
  const ready = !locked && comment.trim().length > 0

  return (
    <>
    <ReviewLayout reference={<>
        <dl className="space-y-4 text-xs">
          <div><dt className="text-muted-foreground">구성</dt><dd className="mt-1 font-medium">Alert {episode.alertCount}건 · 거래 {episode.flow.txCount}건</dd></div>
          <div><dt className="text-muted-foreground">대표 계좌 유입 · 유출</dt><dd className="mt-1 font-medium">{usd(episode.flow.inflowUsd)} · {usd(episode.flow.outflowUsd)}</dd></div>
          <div><dt className="text-muted-foreground">통과 비율</dt><dd className="mt-1 font-medium">{Math.round(episode.flow.passThroughRatio * 100)}% (유출 ÷ 유입)</dd></div>
        </dl>
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium">검수 전 확인</p>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground"><li>연결한 Alert가 같은 주체(사람·관계)의 흐름인가</li><li>패턴별 근거 거래를 확인했는가</li><li>대표 계좌의 다른 Alert 이력을 봤는가</li></ul>
        </div>

    </>}> 
        <SectionTitle title="조사 의견" description="묶은 근거와 조사 내용을 남깁니다. 관리자 검수 절차는 준비 중입니다." />
        {requested && <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="review-requested">관리자 검수 요청됨 · {localTime(episode.reviewRequestedAt!)}</p>}
        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label htmlFor="episode-comment">조사 의견 <span className="text-muted-foreground">(필수)</span></Label>
          <Textarea id="episode-comment" value={comment} onChange={e => setComment(e.target.value)} disabled={locked} className="min-h-[280px] flex-1 resize-y text-sm leading-7" placeholder="어떤 주체가 어떤 패턴으로 자금을 옮겼는지, 연결한 Alert의 공통점을 작성하세요." />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={!ready} onClick={() => { onComment(comment.trim()); setComment('') }}><MessageSquare className="size-3.5" />의견만 남기기</Button>
          <Button size="sm" disabled title="관리자 검수 절차 준비 중"><Send className="size-3.5" />관리자 검수 넘기기</Button>
        </div>
        <p className="text-xs text-muted-foreground">관리자 검수 절차는 준비 중입니다.</p>
    </ReviewLayout>




    </>
  )
}
