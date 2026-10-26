import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { episodeCode } from './alertFilters'
import { verdictGroups, verdictOption, verdictOptions, type AlertVerdict } from './verdict'
export function AlertVerdictForm({ verdict, setVerdict, comment, setComment, target, setTarget, locked, episodes, onConfirm, disabledSubmit = false, targetFooter, commentLabel, newActionLabel }: {
 verdict: AlertVerdict; setVerdict: (value: AlertVerdict) => void; comment: string; setComment: (value: string) => void
 target: string; setTarget: (value: string) => void; locked: boolean; episodes: number[]; onConfirm: () => void
 disabledSubmit?: boolean; targetFooter?: ReactNode; commentLabel?: string; newActionLabel?: string
}) {
 const option = verdictOption(verdict)
 const ready = !locked && comment.trim().length > 0 && (verdict !== 'link-episode' || target !== '')
 return <>
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
        {targetFooter}
        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Label htmlFor="reason">판단 근거 <span className="text-muted-foreground">(필수)</span></Label>
          <Textarea id="reason" aria-label={commentLabel} maxLength={4000} value={comment} onChange={e => setComment(e.target.value)} disabled={locked} className="min-h-[280px] flex-1 resize-y text-sm leading-7" placeholder="확인한 거래, 계좌 간 관계, 판단 근거를 작성하세요." />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" disabled={!ready || disabledSubmit} onClick={() => onConfirm()}><Check className="size-3.5" />{verdict === 'new-episode' && newActionLabel ? newActionLabel : option.action}</Button>
        </div>
 </>
}
