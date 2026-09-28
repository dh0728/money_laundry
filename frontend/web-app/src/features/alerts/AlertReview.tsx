// v24 Detail.tsx "검토 의견" 탭. 판정 선택지는 verdict.ts(9/28 결정)를 따른다.
import { useState } from 'react'
import { Check } from 'lucide-react'
import type { AlertDetail } from '@/api/alerts'
import { alertResolutionLabels } from '@/api/codes'
import { SectionTitle } from '@/components/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useMemoryState } from '@/lib/memory'
import { alertCode, episodeCode } from './alertFilters'
import { usd } from './metrics'
import { verdictGroups, verdictOption, verdictOptions, type AlertVerdict } from './verdict'

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
  const ready = !locked && comment.trim().length > 0 && (verdict !== 'link-episode' || target !== '')

  const counterparts = new Set(alert.transactions.flatMap(t => [t.fromAccount, t.toAccount])).size
  const owners = new Set(alert.transactions.flatMap(t => [t.fromOwnerName, t.toOwnerName]).filter(Boolean)).size
  const biggest = [...alert.transactions].sort((a, b) => b.amountUsd - a.amountUsd)[0]

  return (
    <div className="grid flex-1 items-stretch gap-4 @5xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="review-layout">
      <Card className="h-full w-full shadow-none"><CardContent className="flex h-full flex-col gap-6">
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
        <div className="space-y-2">
          <Label>판정</Label>
          <Select value={verdict} onValueChange={v => setVerdict(v as AlertVerdict)} disabled={locked}>
            <SelectTrigger className="w-80" aria-label="판정"><SelectValue /></SelectTrigger>
            <SelectContent>
              {verdictGroups.map(group => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {verdictOptions.filter(o => o.group === group).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.group === '이상거래' ? `이상거래 · ${o.label}` : o.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {option.proposal && <p className="text-[11px] text-muted-foreground"><Badge variant="outline" className="mr-1.5 font-normal">FE 제안</Badge>API 계약에 아직 없는 판정입니다. 시연 화면에서만 저장됩니다.</p>}
        </div>
        {verdict === 'link-episode' && (
          <div className="space-y-2">
            <Label>연결할 Episode</Label>
            <Select value={target} onValueChange={setTarget} disabled={locked}>
              <SelectTrigger className="w-80" aria-label="연결할 Episode"><SelectValue placeholder="진행 중인 Episode 선택" /></SelectTrigger>
              <SelectContent>{episodes.map(id => <SelectItem key={id} value={String(id)}>{episodeCode(id)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label htmlFor="reason">판단 근거 <span className="text-muted-foreground">(필수)</span></Label>
          <Textarea id="reason" value={comment} onChange={e => setComment(e.target.value)} disabled={locked} className="min-h-[280px] flex-1 resize-y text-sm leading-7" placeholder="확인한 거래, 계좌 간 관계, 판단 근거를 작성하세요." />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" disabled={!ready} onClick={() => setConfirm(true)}><Check className="size-3.5" />{option.action}</Button>
        </div>
      </CardContent></Card>

      <Card className="h-full shadow-none" data-testid="review-reference"><CardContent>
        <SectionTitle title="참고 정보" description="판단 전에 대조할 조사 요약" />
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
      </CardContent></Card>

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
    </div>
  )
}
