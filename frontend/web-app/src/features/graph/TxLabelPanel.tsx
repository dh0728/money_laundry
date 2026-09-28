// 그래프 상세 패널 아래의 "거래 판정". 선택한 계좌·선에 속한 거래를 나열하고,
// 모델 판정과 반대 방향으로 바꾸는 버튼을 둔다. 바로 바뀌지 않고 확인창에서 사유를 받는다(2026-09-28 김명기 결정).
import { useState } from 'react'
import { ProvenanceNote } from '@/components/Provenance'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { focusTransactions, type PanelFocus } from './relabel'
import { formatMoney, type GraphModel, type GraphTransaction } from './v24/model'

const labelText = (label: 0 | 1) => (label === 1 ? '이상 거래' : '정상 거래')

type Props = {
  model: GraphModel
  focus: PanelFocus
  /** 판정을 바꿀 수 있는지(담당자·처리 전) */
  editable: boolean
  onRelabel: (txId: number, label: 0 | 1, reason: string) => void
}

export default function TxLabelPanel({ model, focus, editable, onRelabel }: Props) {
  const [target, setTarget] = useState<GraphTransaction | null>(null)
  const [reason, setReason] = useState('')
  const rows = focusTransactions(model, focus)
  const next: 0 | 1 = target?.label === 1 ? 0 : 1

  return (
    <section className="mt-4 border-t pt-4" data-testid="tx-label-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">거래 판정 <span className="ml-1 text-xs font-normal text-muted-foreground">{rows.length}건</span></h4>
      </div>
      <ProvenanceNote kind="proposal">사람이 바꾼 판정은 API 계약에 아직 없어 시연 화면에서만 저장됩니다.</ProvenanceNote>
      <ul className="mt-3 divide-y rounded-md border">
        {rows.map(t => {
          const changed = t.modelLabel !== undefined && t.modelLabel !== t.label
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs" data-testid="tx-label-row">
              <span className="font-mono">{t.id}</span>
              <span className="tabular-nums text-muted-foreground">{t.at.slice(5)}</span>
              <span className="ml-auto tabular-nums">{formatMoney(t.amount, t.currency)}</span>
              <span className="flex w-full items-center gap-1.5">
                <Badge variant="outline" className={`font-normal ${t.label === 1 ? 'border-destructive/50 text-destructive' : ''}`}>{labelText(t.label)}</Badge>
                {changed && <Badge variant="outline" className="semantic-metadata-badge font-normal" title={`${t.relabel?.actor} · ${t.relabel?.at.slice(0, 16).replace('T', ' ')} · ${t.relabel?.reason}`}>사람 판정 · 모델은 {labelText(t.modelLabel!)}</Badge>}
                <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" disabled={!editable} onClick={() => { setTarget(t); setReason('') }}>
                  {t.label === 1 ? '정상 거래로 전환하기' : '이상 거래로 전환하기'}
                </Button>
              </span>
            </li>
          )
        })}
      </ul>

      <AlertDialog open={target !== null} onOpenChange={open => { if (!open) setTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>거래 {target?.id}를 {labelText(next)}로 전환할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              현재 판정은 {target ? labelText(target.label) : ''}입니다. 전환 사유와 처리자, 시각이 처리 이력에 남습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="relabel-reason">전환 사유 <span className="text-muted-foreground">(필수)</span></Label>
            <Textarea id="relabel-reason" value={reason} onChange={e => setReason(e.target.value)} className="min-h-24 text-sm" placeholder="예: 거래 목적 증빙이 확인되어 정상으로 판단함" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction disabled={!reason.trim()} onClick={() => { if (target) onRelabel(Number(target.id), next, reason.trim()); setTarget(null) }}>
              {labelText(next)}로 전환
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
