import type { ReactNode } from 'react'
import { Check, FolderOpen, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { episodeCode } from './alertFilters'
import { verdictOption, verdictOptions, type AlertVerdict } from './verdict'
import { Box, Text } from '@/components/layout-primitives'

// 재설계 S5 검토 의견: 최종 판단 3개를 한눈에 고르고, 버튼 위계는 저장본 목록(3) → 임시 저장(2) → 확인(1, 가장 강한 주 버튼).
export function AlertVerdictForm({ verdict, setVerdict, comment, setComment, target, setTarget, locked, episodes, onConfirm, disabledSubmit = false, targetFooter, commentLabel, newActionLabel, onDraft, draftCount, onOpenDrafts }: {
 verdict: AlertVerdict; setVerdict: (value: AlertVerdict) => void; comment: string; setComment: (value: string) => void
 target: string; setTarget: (value: string) => void; locked: boolean; episodes: number[]; onConfirm: () => void
 disabledSubmit?: boolean; targetFooter?: ReactNode; commentLabel?: string; newActionLabel?: string
 onDraft?: () => void; draftCount?: number; onOpenDrafts?: () => void
}) {
 const option = verdictOption(verdict)
 const ready = !locked && comment.trim().length > 0 && (verdict !== 'link-episode' || target !== '')
 const visible = verdictOptions.filter(o => !o.hidden)
 return <>
        <Box className="space-y-2">
          <Label>최종 판단</Label>
          <RadioGroup value={verdict} onValueChange={v => setVerdict(v as AlertVerdict)} disabled={locked} className="grid grid-cols-1 gap-2 @3xl:grid-cols-3">
            {visible.map(o => <Label key={o.value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 font-normal has-[:disabled]:cursor-not-allowed ${verdict === o.value ? 'border-foreground bg-muted/40' : ''}`}>
              <RadioGroupItem value={o.value} className="mt-0.5" />
              <Text as="span"><Text as="span" className="block text-sm font-medium">{o.label}</Text><Text as="span" className="mt-0.5 block text-xs text-muted-foreground">{o.value === 'normal' ? '이상 없음으로 끝냅니다' : o.value === 'standalone' ? '이 Alert 하나로 의심 종결합니다' : '진행 중인 Episode에 넣습니다'}</Text></Text>
            </Label>)}
          </RadioGroup>
          <Text className="text-xs text-muted-foreground">새 Episode는 Alert 2건 이상이 필요해서 <a href="#alerts" className="underline underline-offset-4">Alert 목록</a>의 ‘Episode로 묶기’에서 만듭니다.</Text>
        </Box>
        {verdict === 'link-episode' && (
          <Box className="space-y-2">
            <Label>연결할 Episode</Label>
            <Select value={target} onValueChange={setTarget} disabled={locked}>
              <SelectTrigger className="w-80" aria-label="연결할 Episode"><SelectValue placeholder="진행 중인 Episode 선택" /></SelectTrigger>
              <SelectContent>{episodes.map(id => <SelectItem key={id} value={String(id)}>{episodeCode(id)}</SelectItem>)}</SelectContent>
            </Select>
          </Box>
        )}
        {targetFooter}
        <Box className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label htmlFor="reason">판단 근거 <Text as="span" className="text-muted-foreground">(필수)</Text></Label>
          <Textarea id="reason" aria-label={commentLabel} maxLength={4000} value={comment} onChange={e => setComment(e.target.value)} disabled={locked} editor placeholder="확인한 거래, 계좌 간 관계, 판단 근거를 작성하세요." />
        </Box>
        <Box className="flex flex-wrap items-center justify-end gap-2">
          {onOpenDrafts && <Button size="sm" variant="ghost" onClick={onOpenDrafts}><FolderOpen className="size-3.5" />저장본 목록{draftCount ? ` (${draftCount})` : ''}</Button>}
          {onDraft && <Button size="sm" variant="outline" disabled={locked || !comment.trim()} onClick={onDraft}><Save className="size-3.5" />임시 저장</Button>}
          <Button size="sm" disabled={!ready || disabledSubmit} onClick={() => onConfirm()}><Check className="size-3.5" />{verdict === 'new-episode' && newActionLabel ? newActionLabel : option.action}</Button>
        </Box>
 </>
}
