import React, { useEffect, useRef, useState } from 'react';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { Textarea } from '../../components/ui/textarea';
import { ActionButton, ConfirmHoldButton, PrimaryButton } from '../../components/primary-button';
import { DialogFrame } from '../../components/dialog-parts';
import { Callout } from '../../components/Callout';
import { canJudgePreviewCase, canStartPreviewReview, judgmentReasonLabels, judgmentTextLimit, validJudgmentDetails } from './case-judgment-data';
import { enableBackdropDismissal } from '../../lib/overlay-dismissal.js';
import { CountTag, ModelScoreTag, PatternTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import './case-judgment.css';

function JudgmentTarget({ row, showVerdict = false }) {
  return <li className="semantic-tag-group">
    <code>{row.code}</code>
    {row.pattern && <PatternTag>{row.pattern}</PatternTag>}
    {Number.isFinite(row.score) && <ModelScoreTag score={row.score} />}
    {showVerdict && row.verdict && <VerdictTag verdict={row.verdict} />}
  </li>;
}

function JudgmentTargets({ row }) {
  const related = row.kind === 'Episode' ? row.overlappingAlerts ?? [] : [];
  return <div className="case-judgment-target-group">
    <ul className="case-judgment-targets" aria-label="판정 대상"><JudgmentTarget row={row} /></ul>
    {related.length > 0 && <>
      <p className="case-judgment-target-label semantic-tag-group">거래가 겹치는 Alert <CountTag count={related.length} /></p>
      <ul className="case-judgment-targets" aria-label="거래가 겹치는 Alert">
        {related.map(target => <JudgmentTarget key={target.code} row={target} showVerdict />)}
      </ul>
    </>}
  </div>;
}

function JudgmentDetails({ evidence, observations, reason }) {
  return <dl className="case-judgment-details">
    {evidence && <div><dt>확인한 근거 자료</dt><dd>{evidence}</dd></div>}
    {observations && <div><dt>관찰한 사실</dt><dd>{observations}</dd></div>}
    <div><dt>판정 사유</dt><dd>{reason}</dd></div>
  </dl>;
}

export function CaseJudgment({ row, actor, startReview, save, onSavedClose, onReport, onBundle, onTransfer, bundleBlocked, onRelationRequest }) {
  const dialog = useRef(null);
  const title = useRef(null);
  const [verdict, setVerdict] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [rationale, setRationale] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const pending = row.status === '처리 전';
  const canStart = canStartPreviewReview(row, actor);
  const actionLabel = pending && !onBundle && !bundleBlocked ? '처리 중 상태로 변환' : '판정';
  const eligible = canJudgePreviewCase(row, actor);
  const actionEnabled = Boolean(bundleBlocked || onBundle) || (pending ? canStart : eligible && !result);
  const reasonLabel = judgmentReasonLabels[reasonCategory];
  const details = { rationale };
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
    if (onBundle) {
      onBundle();
      return;
    }
    if (pending && !bundleBlocked) {
      startReview(row.code);
      return;
    }
    dialog.current.showModal();
    focusTitle();
  }

  function close() {
    if (result) return onSavedClose();
    setVerdict('');
    setReasonCategory('');
    setRationale('');
    setConfirm(false);
    setError('');
    setRequestSent(false);
  }

  function submit(event) {
    event.preventDefault();
    if (!valid || confirm || result) return;
    setConfirm(true);
    requestAnimationFrame(focusTitle);
  }

  async function commit() {
    if (!valid || !confirm || result) return;
    const response = await save(row.code, verdict, details, reasonCategory);
    if (response.ok) {
      setResult(response.value);
      requestAnimationFrame(focusTitle);
    } else {
      setError(response.error);
    }
  }

  return <>
    <PrimaryButton tone="brand" className="case-judgment-trigger" disabled={!actionEnabled}
      aria-haspopup={pending && !onBundle && !bundleBlocked ? undefined : 'dialog'}
      aria-controls={onBundle ? 'case-bundle-dialog' : pending && !bundleBlocked ? undefined : 'case-judgment-dialog'}
      onHold={open}>{actionLabel}</PrimaryButton>
    <DialogFrame id="case-judgment-dialog" className="case-judgment-dialog" ref={dialog} onClose={close} onSubmit={submit}
      titleId="case-judgment-title" titleRef={title} closeLabel="판정 창 닫기"
      title={result ? '판정 완료' : confirm ? '판정 내용 확인' : `${row.kind} 판정`}
      actions={<>
        {bundleBlocked && canStart && <ActionButton shape="pill" surface="floating"
          onClick={() => startReview(row.code)}>처리 중으로 변경</ActionButton>}
        {onRelationRequest && !requestSent && <ActionButton shape="pill" surface="floating"
          onClick={() => onRelationRequest(rationale.trim(), () => setRequestSent(true))}>관리자에게 요청 보내기</ActionButton>}
        {result ? <PrimaryButton as="a" tone="brand" href={`/report?selected=${encodeURIComponent(result.id)}`}
          onClick={event => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onReport(result.id);
          }}>보고서 보기</PrimaryButton> : eligible && <>
            {confirm && <ActionButton shape="pill" surface="floating" onClick={() => {
              setConfirm(false);
              setError('');
              requestAnimationFrame(focusTitle);
            }}>내용 수정</ActionButton>}
            {confirm
              ? <ConfirmHoldButton disabled={!valid} doneLabel="판정 확인" onHold={commit}>판정 저장</ConfirmHoldButton>
              : <PrimaryButton type="submit" tone="brand" disabled={!valid}>내용 확인</PrimaryButton>}
          </>}
      </>}>
      <div className="case-judgment-body">
        {bundleBlocked && <Callout className="case-judgment-bundle-notice">
          <strong>Episode 편입 전 확인</strong><br />
          {bundleBlocked}
        </Callout>}
        {requestSent && <p role="status">관리자에게 연관 업무 검토 요청을 보냈습니다.</p>}
        <JudgmentTargets row={row} />
        {result ? <div className="case-judgment-summary">
          <p role="status">{result.id}에 판정이 저장되었습니다.</p>
          <p><VerdictTag verdict={result.verdict} /></p>
          <p><strong>{reasonLabel}</strong></p>
          <JudgmentDetails {...result} />
        </div> : confirm ? <div className="case-judgment-summary">
          <p><VerdictTag verdict={verdict} /></p>
          <p><strong>{reasonLabel}</strong></p>
          <JudgmentDetails reason={rationale.trim()} />
          <p className="case-judgment-note">저장하면 이 업무가 처리 완료로 이동합니다.</p>
        </div> : eligible && <>
          <div className="case-judgment-dropdowns">
            <GlideSelect ariaLabel="처리 방식" placeholder="처리 방식 선택" value={verdict}
              options={[
                { value: 'normal', label: row.kind === 'Alert' ? '정상 종결' : '정상' },
                { value: 'abnormal', label: row.kind === 'Alert' ? '단독 의심 종결' : '이상' },
                ...(onTransfer ? [{ value: 'transfer', label: '기존 Episode에 편입' }] : []),
              ]}
              onChange={value => {
                if (value === 'transfer') {
                  dialog.current.close();
                  onTransfer();
                } else {
                  setVerdict(value);
                }
              }} />
            <GlideSelect ariaLabel="판정 사유 유형" placeholder="판정 사유 유형 선택"
              value={reasonCategory} onChange={setReasonCategory}
              options={Object.entries(judgmentReasonLabels).map(([value, label]) => ({ value, label }))} />
          </div>
          <label className="case-judgment-field">
            <span>판정 사유</span>
            <Textarea rows={3} maxLength={judgmentTextLimit} required value={rationale}
              placeholder="판정 이유를 입력해 주세요"
              onChange={event => setRationale(event.target.value)} />
          </label>
        </>}
        {error && <p role="alert">{error}</p>}
      </div>
    </DialogFrame>
  </>;
}
