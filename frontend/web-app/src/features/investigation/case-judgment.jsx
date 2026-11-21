import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ActionButton, ConfirmHoldButton, PrimaryButton } from '../../components/radar/primary-button';
import { canJudgePreviewCase, canStartPreviewReview, judgmentReasonLabels, judgmentTextLimit, validJudgmentDetails } from './case-judgment-data';
import { enableBackdropDismissal } from '../../lib/radar/overlay-dismissal.js';
import { VerdictTag, verdictLabels } from '../../components/radar/semantic-tags';
import './case-judgment.css';

function JudgmentTargets({ row }) {
  const related = row.kind === 'Episode' ? row.overlappingAlerts ?? [] : [];
  const targets = related.length ? related : [row];
  return <div className="case-judgment-target-group">
    {related.length > 0 && <p className="case-judgment-target-label"><code>{row.code}</code> · 거래가 겹치는 Alert</p>}
    <ul className="case-judgment-targets" aria-label={related.length ? '거래가 겹치는 Alert' : '판정 대상'}>
      {targets.map(target => <li key={target.code}>
        <code>{target.code}</code>{target.pattern && <span> · {target.pattern}</span>}
      </li>)}
    </ul>
  </div>;
}

function JudgmentDetails({ evidence, observations, reason }) {
  return <dl className="case-judgment-details">
    <div><dt>확인한 근거 자료</dt><dd>{evidence}</dd></div>
    <div><dt>관찰한 사실</dt><dd>{observations}</dd></div>
    <div><dt>판정 사유</dt><dd>{reason}</dd></div>
  </dl>;
}

export function CaseJudgment({ row, startReview, save, onSavedClose, onReport, selectedTransactions = [] }) {
  const dialog = useRef(null);
  const title = useRef(null);
  const [verdict, setVerdict] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [references, setReferences] = useState([]);
  const [manualEvidence, setManualEvidence] = useState('');
  const [observations, setObservations] = useState('');
  const [rationale, setRationale] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const pending = row.status === '처리 전';
  const actionLabel = pending ? '처리 중 상태로 변환' : '판정';
  const eligible = canJudgePreviewCase(row);
  const actionEnabled = pending ? canStartPreviewReview(row) : eligible && !result;
  const reasonLabel = judgmentReasonLabels[reasonCategory];
  const relatedCodes = [...new Set((row.related ?? []).map(record => record.code).filter(Boolean))];
  const evidence = [references.join(', '), manualEvidence.trim()].filter(Boolean).join('\n');
  const details = { evidence, observations, rationale };
  const valid = eligible && (verdict === 'normal' || verdict === 'abnormal') && Boolean(reasonLabel)
    && validJudgmentDetails(details);
  useEffect(() => {
    enableBackdropDismissal(dialog.current);
  }, []);

  const focusTitle = () => {
    const body = dialog.current?.querySelector('.case-judgment-body');
    if (body) body.scrollTop = 0;
    title.current?.focus();
  };

  function open() {
    if (pending) {
      startReview(row.code);
      return;
    }
    setReferences(selectedTransactions.filter(code => relatedCodes.includes(code)));
    dialog.current.showModal();
    focusTitle();
  }

  function close() {
    if (result) return onSavedClose();
    setVerdict('');
    setReasonCategory('');
    setReferences([]);
    setManualEvidence('');
    setObservations('');
    setRationale('');
    setConfirm(false);
    setError('');
  }

  function submit(event) {
    event.preventDefault();
    if (!valid || confirm || result) return;
    setConfirm(true);
    requestAnimationFrame(focusTitle);
  }

  function commit() {
    if (!valid || !confirm || result) return;
    const response = save(row.code, verdict, details, reasonCategory);
    if (response.ok) {
      setResult(response.value);
      requestAnimationFrame(focusTitle);
    } else {
      setError(response.error);
    }
  }

  return <>
    <PrimaryButton tone="brand" className="case-judgment-trigger" disabled={!actionEnabled}
      aria-haspopup={pending ? undefined : 'dialog'} aria-controls={pending ? undefined : 'case-judgment-dialog'}
      onHold={open}>{actionLabel}</PrimaryButton>
    <dialog id="case-judgment-dialog" className="glass-dialog case-judgment-dialog glass" ref={dialog} onClose={close}
      aria-labelledby="case-judgment-title">
      <form className="case-judgment-form" onSubmit={submit}>
        <header className="case-judgment-header">
          <h2 id="case-judgment-title" ref={title} tabIndex={-1}>
            {result ? '판정 완료' : confirm ? '판정 내용 확인' : `${row.kind} 판정`}
          </h2>
          <ActionButton className="icon-button" surface="floating" aria-label="판정 창 닫기" onClick={() => dialog.current.close()}>
            <X className="icon" aria-hidden="true" />
          </ActionButton>
        </header>
        <div className="case-judgment-body">
          <JudgmentTargets row={row} />
          {result ? <div className="case-judgment-summary">
            <p role="status">{result.id}에 판정이 저장되었습니다.</p>
            <p><VerdictTag verdict={result.verdict} /></p>
            <p><strong>{reasonLabel}</strong></p>
            <JudgmentDetails {...result} />
          </div> : confirm ? <div className="case-judgment-summary">
            <p><VerdictTag verdict={verdict} /></p>
            <p><strong>{reasonLabel}</strong></p>
            <JudgmentDetails evidence={evidence} observations={observations.trim()} reason={rationale.trim()} />
            <p className="case-judgment-note">저장하면 이 업무가 처리 완료로 이동합니다.</p>
          </div> : <>
            <fieldset className="case-judgment-verdict">
              <legend className="visually-hidden">판정 결과</legend>
              {['normal', 'abnormal'].map(value => <label key={value}>
                <input type="radio" name="case-verdict" value={value} checked={verdict === value} required
                  onChange={() => setVerdict(value)} />{verdictLabels[value]}
              </label>)}
            </fieldset>
            <label className="case-judgment-field">
              <span>판정 사유 유형</span>
              <span className="case-judgment-select">
                <select value={reasonCategory} required onChange={event => setReasonCategory(event.target.value)}>
                  <option value="" disabled>사유 선택</option>
                  {Object.entries(judgmentReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <ChevronDown className="icon icon-compact" aria-hidden="true" />
              </span>
            </label>
            <fieldset className="case-judgment-evidence">
              <legend>확인한 근거 자료</legend>
              {relatedCodes.length > 0 && <div className="case-judgment-references">
                {relatedCodes.map(code => <label key={code}>
                  <input type="checkbox" checked={references.includes(code)} onChange={event => {
                    const checked = event.target.checked;
                    setReferences(current => checked ? [...current, code] : current.filter(value => value !== code));
                  }} /><code>{code}</code>
                </label>)}
              </div>}
              <label className="case-judgment-field">
                <span>{relatedCodes.length ? '추가 근거 자료' : '근거 자료 설명'}</span>
                <textarea rows={2} maxLength={judgmentTextLimit} required={!references.length} value={manualEvidence}
                  placeholder="대조한 거래 원장이나 증빙 자료를 입력하세요"
                  onChange={event => setManualEvidence(event.target.value)} />
              </label>
            </fieldset>
            <label className="case-judgment-field">
              <span>관찰한 사실</span>
              <textarea rows={3} maxLength={judgmentTextLimit} required value={observations}
                placeholder="자료에서 확인한 거래 시각, 금액, 상대 계좌 등을 적어 주세요"
                onChange={event => setObservations(event.target.value)} />
            </label>
            <label className="case-judgment-field">
              <span>판정 사유</span>
              <textarea rows={3} maxLength={judgmentTextLimit} required value={rationale}
                placeholder="관찰한 사실이 선택한 판정을 뒷받침하는 이유를 적어 주세요"
                onChange={event => setRationale(event.target.value)} />
            </label>
          </>}
          {error && <p role="alert">{error}</p>}
        </div>
        <footer className="case-judgment-actions">
          <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>{result ? '닫기' : '취소'}</ActionButton>
          {result ? <PrimaryButton as="a" tone="brand" href={`/report?selected=${encodeURIComponent(result.id)}`}
            onClick={event => {
              if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onReport(result.id);
            }}>보고서 보기</PrimaryButton> : <>
              {confirm && <ActionButton shape="pill" surface="floating" onClick={() => {
                setConfirm(false);
                setError('');
                requestAnimationFrame(focusTitle);
              }}>내용 수정</ActionButton>}
              {confirm
                ? <ConfirmHoldButton disabled={!valid} doneLabel="판정 확인" onHold={commit}>길게 눌러 판정 저장</ConfirmHoldButton>
                : <PrimaryButton type="submit" tone="brand" disabled={!valid}>내용 확인</PrimaryButton>}
            </>}
        </footer>
      </form>
    </dialog>
  </>;
}
