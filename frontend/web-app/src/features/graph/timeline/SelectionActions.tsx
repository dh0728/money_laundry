// 그래프에서 끌어 고른 계좌·선으로 할 수 있는 일(재설계 §6.2 5번 + 지원 님 제안 10/12).
// 노드를 끌지 않게 되어(10/12) 빈 곳 끌기는 고르기에만 쓰인다.
// API 사실: EXCLUDE는 본인 담당 OPEN Alert의 거래만, 되돌리는 API 없음. TRANSFER·UNLINK는 Alert 전체 단위(부분 거래 목록은 409).
import { useState } from 'react'
import { toast } from 'sonner'
import { ProvenanceBadge } from '@/components/Provenance'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { TimeTx } from './timeLayout'

export type GraphContext = { kind: 'alert'; code: string } | { kind: 'episode'; code: string }
type Action = 'exclude' | 'move' | 'split'

export function SelectionActions({ context, accounts, txs, onOnly, onClear }: { context: GraphContext; accounts: number; txs: TimeTx[]; onOnly: () => void; onClear: () => void }) {
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const alerts = [...new Set(txs.map(t => t.alertId).filter((v): v is number => v != null))].sort()
  const close = () => { setAction(null); setReason('') }
  const done = (msg: string) => { toast.success(msg, { description: '시안이라 서버에는 보내지 않습니다.' }); close(); onClear() }
  const title = { exclude: '조사 범위에서 제거', move: context.kind === 'alert' ? 'Episode로 묶기' : 'Episode에서 빼기', split: '새 Alert로 분리' }
  return <>
    {/* 그래프 아래 고정 줄에 들어간다(김명기 10/12): 그래프를 가리지 않고, 나타나고 사라져도 그래프 크기가 변하지 않는다 */}
    <b className="shrink-0 whitespace-nowrap font-medium">계좌 {accounts}개 · 거래 {txs.length}건</b>
      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={onOnly}>선택 거래만 보기</Button>
      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={!txs.length} onClick={() => setAction('exclude')}>범위에서 제거</Button>
      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={!txs.length} onClick={() => setAction('move')}>{title.move}</Button>
      <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs" disabled={!txs.length} onClick={() => setAction('split')}>새 Alert로 분리</Button>
      <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={onClear}>선택 해제</Button>
    <Dialog open={action != null} onOpenChange={open => { if (!open) close() }}>
      <DialogContent className="sm:max-w-lg">
        {action && <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{title[action]}{action === 'split' && <ProvenanceBadge kind="proposal" title="지원 님 제안 · API 없음" />}</DialogTitle>
            <DialogDescription>
              {action === 'exclude' && `${context.code}의 조사 범위에서 거래 ${txs.length}건을 뺍니다. 되돌리는 API가 없어 다시 넣을 수 없습니다. 본인 담당 진행 중 Alert의 거래만 뺄 수 있습니다.`}
              {action === 'move' && context.kind === 'alert' && `지금 API는 Alert 전체 단위로만 묶습니다. 고른 거래 ${txs.length}건이 아니라 ${context.code} 전체가 Episode로 갑니다.`}
              {action === 'move' && context.kind === 'episode' && `연결 해제는 Alert 단위입니다. 고른 거래가 속한 Alert ${alerts.length}건 전체가 ${context.code}에서 빠집니다${alerts.length ? `: ${alerts.map(a => `A-${a}`).join(', ')}` : ''}.`}
              {action === 'split' && `고른 거래 ${txs.length}건만 떼어 새 Alert를 만듭니다. 지금 API에는 없는 기능이라 Backend와 계약을 정해야 합니다(근거 버전·담당 배정·원래 Alert에서 빠지는 처리).`}
            </DialogDescription>
          </DialogHeader>
          <Textarea className="min-h-20 text-sm" placeholder="사유(필수, 처리 이력에 남습니다)" value={reason} onChange={e => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={close}>취소</Button>
            <Button disabled={!reason.trim()} onClick={() => done(action === 'exclude' ? `거래 ${txs.length}건 범위에서 제거` : action === 'split' ? `거래 ${txs.length}건으로 새 Alert 생성(제안)` : context.kind === 'alert' ? `${context.code} Episode로 묶기` : `Alert ${alerts.length}건 연결 해제`)}>{title[action]}</Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </>
}
