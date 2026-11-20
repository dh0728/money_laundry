import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WorkspaceDialog } from '../ui/WorkspaceDialog'
import { StatusTag } from '../ui/Tags'
import { useWorkspace, type JudgmentRecord, type Verdict } from '../workspace-store'
import { canJudgeCase } from './case-selectors'

type Props = { ids: number[]; open: boolean; onOpenChange: (open: boolean) => void }
export function CaseVerdictDialog(props: Props) {
  return props.open ? <VerdictContent {...props} /> : null
}
function VerdictContent({ ids: inputIds, onOpenChange }: Props) {
  const { records, viewerId, judgeCases } = useWorkspace()
  // Freeze targets for this opening: successful saves may remove them from an
  // eligible list before the returned judgment/report link is acknowledged.
  const [ids] = useState(() => [...new Set(inputIds)])
  const items = records.filter(item => ids.includes(item.caseId))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [result, setResult] = useState<JudgmentRecord | null>(null)
  const [failure, setFailure] = useState<{ error: string; conflict?: boolean } | null>(null)
  const [scenario, setScenario] = useState<'success' | 'error' | 'conflict'>('success')
  const [expectedRevisions, setExpectedRevisions] = useState(() => Object.fromEntries(items.map(item => [item.caseId, item.revision])))
  const permitted = ids.length > 0 && ids.length <= 100 && items.length === ids.length && items.every(item => canJudgeCase(item, viewerId))
  const valid = permitted && verdict !== null && reason.trim().length > 0 && !failure?.conflict
  const save = () => {
    if (!valid || !verdict) return
    const response = judgeCases(ids, verdict, reason.trim(), { expectedRevisions, scenario })
    if (response.ok) { setResult(response.value); setFailure(null) }
    else { setFailure({ error: response.error, conflict: response.conflict }); setStep('edit') }
  }
  return <WorkspaceDialog open onOpenChange={onOpenChange} title={result ? `판정 ${result.id}` : `${items.length}개 항목 판정`} description="샘플 작업 공간에 사람 판정을 저장합니다. 실제 서버로 전송하지 않습니다."
    footer={<>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>{result ? '닫기' : '취소'}</Button>
      {!result && step === 'confirm' && <Button variant="secondary" onClick={() => setStep('edit')}>사유 수정</Button>}
      {!result && step === 'edit' && <Button variant="secondary" disabled={!valid} onClick={valid ? () => setStep('confirm') : undefined}>판정 완료</Button>}
      {!result && step === 'confirm' && <Button variant="secondary" disabled={!valid} onClick={valid ? save : undefined}>확인 후 저장</Button>}
      {result ? <Button asChild><a href={`#/report?selected=${encodeURIComponent(result.id)}`}>보고서 다운로드</a></Button> : <Button disabled>보고서 다운로드</Button>}
    </>}>
    <div data-case="verdict-body">
      {result ? <>
        <p data-ws="notice" role="status">판정이 저장되었습니다. 보고서에서 저장된 근거를 확인할 수 있습니다.</p>
        <StatusTag preset={result.verdict}>{result.verdict === 'normal' ? '정상' : '이상'}</StatusTag>
        <p>{result.reason}</p><p data-ws="muted">{result.reviewer} · {new Date(result.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      </> : <>
        <ul data-case="verdict-targets">{items.slice(0, 100).map(item => <li key={item.caseId}>{item.displayId} · {item.assignee}</li>)}</ul>
        {ids.length > 100 && <p role="alert" data-ws="error">한 번에 최대 100건까지 판정할 수 있습니다. 선택 범위를 줄여 주세요.</p>}
        {!permitted && <p role="alert" data-ws="error">담당자이면서 처리 완료 전인 항목만 판정할 수 있습니다. 대상과 권한을 다시 확인해 주세요.</p>}
        {failure && <div role="alert" data-ws="error"><p>{failure.error}</p>{failure.conflict && <Button variant="secondary" onClick={() => { setExpectedRevisions(Object.fromEntries(items.map(item => [item.caseId, item.revision]))); setFailure(null); setScenario('success') }}>최신 상태 확인</Button>}</div>}
        {step === 'confirm' ? <div data-ws="notice"><h3>최종 판정을 저장할까요?</h3><p>{items.length}건 · {verdict === 'normal' ? '정상' : '이상'}</p><p>{reason.trim()}</p><p>저장하면 해당 항목은 처리 완료로 바뀝니다.</p></div> : <>
          <fieldset disabled={!permitted} data-case="verdict-choices"><legend>사람 판정</legend>
            <label><input type="radio" name="case-verdict" value="normal" checked={verdict === 'normal'} onChange={() => setVerdict('normal')} />정상</label>
            <label><input type="radio" name="case-verdict" value="abnormal" checked={verdict === 'abnormal'} onChange={() => setVerdict('abnormal')} />이상</label>
          </fieldset>
          <label>판정 사유<Textarea value={reason} disabled={!permitted} maxLength={2000} onChange={event => setReason(event.target.value)} placeholder="판정의 근거를 입력하세요" /></label>
          {import.meta.env.DEV && <details><summary>개발용 저장 결과</summary><label>저장 결과<select value={scenario} onChange={event => setScenario(event.target.value as typeof scenario)}><option value="success">성공</option><option value="error">실패</option><option value="conflict">다른 검토자 변경</option></select></label></details>}
        </>}
      </>}
    </div>
  </WorkspaceDialog>
}
