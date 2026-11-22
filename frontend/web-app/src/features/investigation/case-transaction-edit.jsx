import React, { useEffect, useId, useRef, useState } from 'react';
import { ActionButton, ConfirmHoldButton } from '../../components/primary-button';
import { DialogFrame } from '../../components/dialog-parts';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { Textarea } from '../../components/ui/textarea';
import { enableBackdropDismissal } from '../../lib/overlay-dismissal';
import { CountTag } from '../../components/semantic-tags';
import { membershipReasonLimit } from './case-membership-data';
import './case-judgment.css';
import './case-transaction-edit.css';

const formatCount = new Intl.NumberFormat('ko-KR');

function editBlockedMessage(row) {
  if (row.status === '처리 완료' || row.open === false) return '처리 완료한 Alert의 근거 거래는 보존됩니다.';
  if (!row.assigned) return '담당 분석가에게 거래 편집 권한이 있습니다.';
  return '이 화면은 조회 전용입니다.';
}

export function CaseTransactionEdit({ row, selected = [], destinations = [], canEdit, blockedReason, onApply, onClear }) {
  const id = useId();
  const dialog = useRef(null);
  const trigger = useRef(null);
  const title = useRef(null);
  const [operation, setOperation] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const codes = [...new Set(selected)];
  const hasSelection = codes.length > 0;
  const targets = destinations.map(entry => typeof entry === 'string' ? { code: entry } : entry)
    .filter(target => target.code !== row.code);
  const target = operation === 'transfer' ? targets.find(item => item.code === destination) : null;
  const note = reason.trim();
  const valid = canEdit && hasSelection && Boolean(note) && note.length <= membershipReasonLimit
    && (operation === 'exclude' || Boolean(target));
  const countLabel = `${formatCount.format(codes.length)}건`;
  useEffect(() => {
    if (hasSelection) enableBackdropDismissal(dialog.current);
  }, [hasSelection]);

  function open() {
    setOperation('');
    setDestination('');
    setReason('');
    setError('');
    dialog.current.showModal();
    title.current.focus();
  }

  function close() {
    if (dialog.current?.open) dialog.current.close();
  }

  function clear() {
    close();
    onClear();
  }

  function apply() {
    if (!valid) return;
    setError('');
    try {
      const result = onApply({ codes, targetCode: target?.code ?? null, reason: note });
      if (result.ok) close();
      else setError(result.error ?? '변경을 적용하지 못했습니다. 선택한 항목을 확인해 주세요.');
    } catch {
      setError('변경을 적용하지 못했습니다. 선택한 항목을 확인해 주세요.');
    }
  }

  if (!hasSelection) return null;
  return <>
    <ActionButton ref={trigger} className="screen-primary case-transaction-edit-trigger glass" shape="pill" surface="floating"
      aria-haspopup="dialog" aria-controls={id} onClick={open}>선택 항목 편집 · {countLabel}</ActionButton>
    <DialogFrame ref={dialog} id={id} titleId={`${id}-title`} titleRef={title} title="선택 항목 편집" closeLabel="편집 창 닫기"
      className="case-judgment-dialog case-transaction-edit-dialog"
      onClose={() => trigger.current?.focus({ preventScroll: true })}
      actions={<>
        <ActionButton shape="pill" surface="ghost" onClick={clear}>선택 해제</ActionButton>
        {canEdit && <ConfirmHoldButton tone={operation === 'exclude' ? 'negative' : 'brand'}
          disabled={!valid} doneLabel="적용 완료" resetAfter={250}
          onHold={apply}>{operation === 'exclude' ? '길게 눌러 적용' : '적용'}</ConfirmHoldButton>}
      </>}>
      <div className="case-judgment-body">
        <div className="case-judgment-target-group">
          <p className="case-judgment-target-label semantic-tag-group"><code>{row.code}</code> · 선택 거래
            <CountTag count={codes.length} /></p>
          <ul className="case-judgment-targets case-transaction-edit-targets" aria-label="선택 거래 ID">
            {codes.map(code => <li key={code}><code>{code}</code></li>)}
          </ul>
        </div>
        {canEdit ? <>
          <fieldset className="case-judgment-verdict">
            <legend>편집 방식</legend>
            <label>
              <input type="radio" name={`${id}-operation`} value="exclude" checked={operation === 'exclude'}
                onChange={() => { setOperation('exclude'); setError(''); }} />
              이 Alert에서 제외
            </label>
            <label>
              <input type="radio" name={`${id}-operation`} value="transfer" checked={operation === 'transfer'}
                disabled={!targets.length} onChange={() => { setOperation('transfer'); setError(''); }} />
              다른 Alert로 이동
            </label>
            {!targets.length && <p className="case-judgment-note">이동할 수 있는 Alert가 없습니다.</p>}
          </fieldset>
          {operation === 'transfer' && <div className="case-judgment-dropdowns">
            <span>이동할 Alert</span>
            <GlideSelect ariaLabel="이동할 Alert" placeholder="Alert 선택" value={destination}
              options={targets.map(({ code, pattern }) => ({ value: code, label: pattern ? `${code} · ${pattern}` : code }))}
              onChange={value => { setDestination(value); setError(''); }} />
          </div>}
          <label className="case-judgment-field">
            <span>변경 사유</span>
            <Textarea rows={3} maxLength={membershipReasonLimit} required value={reason}
              placeholder="이 거래들을 제외하거나 이동하는 이유를 입력하세요"
              onChange={event => { setReason(event.target.value); setError(''); }} />
          </label>
          {error && <p className="case-transaction-edit-error" role="alert">{error}</p>}
        </> : <p className="case-judgment-note">{blockedReason ?? editBlockedMessage(row)}</p>}
      </div>
    </DialogFrame>
  </>;
}
