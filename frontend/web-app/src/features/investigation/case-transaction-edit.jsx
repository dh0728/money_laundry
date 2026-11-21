import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ActionButton, ConfirmHoldButton } from '../../components/radar/primary-button';
import { enableBackdropDismissal } from '../../lib/radar/overlay-dismissal';
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
    <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`}
      className="glass-dialog case-judgment-dialog case-transaction-edit-dialog glass"
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <div className="case-judgment-form">
        <header className="case-judgment-header">
          <h2 ref={title} tabIndex={-1} id={`${id}-title`}>선택 항목 편집</h2>
          <ActionButton className="icon-button" shape="circle" surface="floating" aria-label="편집 창 닫기" onClick={close}>
            <X className="icon" aria-hidden="true" />
          </ActionButton>
        </header>
        <div className="case-judgment-body">
          <div className="case-judgment-target-group">
            <p><code>{row.code}</code> · 선택 거래 {countLabel}</p>
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
            {operation === 'transfer' && <label className="case-judgment-field">
              <span>이동할 Alert</span>
              <span className="case-judgment-select">
                <select value={destination} required onChange={event => { setDestination(event.target.value); setError(''); }}>
                  <option value="" disabled>Alert 선택</option>
                  {targets.map(item => <option key={item.code} value={item.code}>{item.code}{item.pattern ? ` · ${item.pattern}` : ''}</option>)}
                </select>
                <ChevronDown className="icon icon-compact" aria-hidden="true" />
              </span>
            </label>}
            <label className="case-judgment-field">
              <span>변경 사유</span>
              <textarea rows={3} maxLength={membershipReasonLimit} required value={reason}
                placeholder="이 거래들을 제외하거나 이동하는 이유를 입력하세요"
                onChange={event => { setReason(event.target.value); setError(''); }} />
            </label>
            {error && <p className="case-transaction-edit-error" role="alert">{error}</p>}
          </> : <p className="case-judgment-note">{blockedReason ?? editBlockedMessage(row)}</p>}
        </div>
        <footer className="case-judgment-actions">
          <ActionButton shape="pill" surface="ghost" onClick={clear}>선택 해제</ActionButton>
          <ActionButton shape="pill" surface="floating" onClick={close}>{canEdit ? '취소' : '닫기'}</ActionButton>
          {canEdit && <ConfirmHoldButton tone={operation === 'exclude' ? 'negative' : 'brand'}
            disabled={!valid} doneLabel="길게 눌러 적용" resetAfter={250}
            onHold={apply}>길게 눌러 적용</ConfirmHoldButton>}
        </footer>
      </div>
    </dialog>
  </>;
}
