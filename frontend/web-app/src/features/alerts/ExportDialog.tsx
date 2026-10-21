// UI 재설계 내보내기 창 시안(김명기 10/8 제안): 표 전체를 내보내되, 카드별로 강조할 부분을 고른다.
// 카드마다 다운로드 버튼을 두면 버튼이 많아지고, 받은 사람이 맥락 없이 조각만 보게 되기 때문이다.
import { NumBadge } from '@/components/NumBadge'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ProvenanceBadge } from '@/components/Provenance'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

type Part = { id: string; label: ReactNode; detail: string; locked?: boolean }

const step = (n: number, text: string) => <span className="inline-flex items-center gap-1.5"><NumBadge n={n} />{text}</span>

export default function ExportDialog({ open, onOpenChange, code, txCount, seedCount }: { open: boolean; onOpenChange: (open: boolean) => void; code: string; txCount: number; seedCount: number }) {
  const parts: Part[] = [
    { id: 'summary', label: '요약 카드', detail: '외부 유입액·순유입·근거 거래·참여 계좌·거래 기간' },
    { id: 'why', label: step(1, '왜 Alert가 됐나'), detail: `씨앗 거래 ${seedCount}건을 표에서 강조` },
    { id: 'money', label: step(2, '돈이 어떻게 움직였나'), detail: '외부 유입·유출 거래를 표에서 강조' },
    { id: 'shape', label: step(3, '어떤 모양인가'), detail: '집중 수취·경유 계좌가 낀 거래 강조' },
    { id: 'who', label: step(4, '누가 관여했나'), detail: '주요 계좌 5개의 거래 강조' },
    { id: 'seen', label: step(5, '전에 본 적 있나'), detail: '다른 사건에서 판정된 거래 표시' },
    { id: 'limits', label: step(6, '어디까지 봤나'), detail: '기준 시각·수신 완결·한도. 받는 사람이 숫자를 오해하지 않게 항상 포함', locked: true },
    { id: 'history', label: step(7, '처리 이력'), detail: '판정·제외·묶기 사유' },
  ]
  const [picked, setPicked] = useState<string[]>(['summary', 'why', 'limits'])
  const [format, setFormat] = useState('xlsx')
  const toggle = (id: string) => setPicked(list => list.includes(id) ? list.filter(v => v !== id) : [...list, id])
  const chosen = parts.filter(p => p.locked || picked.includes(p.id))

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">{code} 내보내기<ProvenanceBadge kind="proposal" title="파일 형식과 생성 위치(FE·BE)는 팀과 정함" /></DialogTitle>
        <DialogDescription>거래 표 {txCount}건 전체를 내보냅니다. 강조할 카드를 고르면 그 내용이 요약 시트에 들어가고 관련 거래가 표에서 강조됩니다.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <p className="text-xs font-medium">강조할 카드</p>
          {parts.map(p => <label key={p.id} className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-xs has-[:disabled]:cursor-default">
            <Checkbox className="mt-0.5" checked={p.locked || picked.includes(p.id)} disabled={p.locked} onCheckedChange={() => toggle(p.id)} />
            <span><span className="font-medium">{p.label}</span><span className="mt-0.5 block text-muted-foreground">{p.detail}</span></span>
          </label>)}
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium">파일 형식</p>
            <RadioGroup value={format} onValueChange={setFormat} className="gap-2">
              <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="xlsx" />XLSX · 요약 시트 + 거래 표(강조 포함)</Label>
              <Label className="flex items-center gap-2 text-xs font-normal"><RadioGroupItem value="csv" />CSV · 거래 표만(강조·요약 없음)</Label>
            </RadioGroup>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium">미리보기 · 요약 시트</p>
            <ol className="mt-2 space-y-1 text-muted-foreground">
              <li>{code} · 내보낸 사람 · 근거 기준 시각 · 근거 버전</li>
              {format === 'xlsx' ? chosen.map(p => <li key={p.id}>{p.label}</li>) : <li>CSV는 요약 시트가 없습니다</li>}
            </ol>
            <p className="mt-3 font-medium">미리보기 · 거래 표</p>
            <div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 font-mono text-[0.6875rem]">
              {[['T-1', '씨앗', true], ['T-2', '경유', false], ['T-3', '씨앗', true], ['T-4', '주변', false]].map(([id, role, hi]) => <div key={String(id)} className={`contents ${hi && format === 'xlsx' && picked.includes('why') ? '[&>span]:bg-[var(--risk-6)]/40' : ''}`}>
                <span className="px-1">{id}</span><span className="px-1">{role}</span><span className="px-1">…</span>
              </div>)}
            </div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
        <Button onClick={() => { onOpenChange(false); toast.success(`${code}.${format} 내보내기`, { description: '시안이라 파일은 만들지 않습니다.' }) }}>내보내기</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
