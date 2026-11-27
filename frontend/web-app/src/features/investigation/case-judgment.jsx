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
import { Box, LineBreak, Text } from '../../components/layout-primitives';

function JudgmentTarget({ row, showVerdict = false }) {
  return <Box as="li" className="semantic-tag-group">
    <Text as="code">{row.code}</Text>
    {row.pattern && <PatternTag>{row.pattern}</PatternTag>}
    {Number.isFinite(row.score) && <ModelScoreTag score={row.score} />}
    {showVerdict && row.verdict && <VerdictTag verdict={row.verdict} />}
  </Box>;
}

function JudgmentTargets({ row }) {
  const related = row.kind === 'Episode' ? row.overlappingAlerts ?? [] : [];
  return <Box className="case-judgment-target-group">
    <Box as="ul" className="case-judgment-targets" aria-label="판정 대상"><JudgmentTarget row={row} /></Box>
    {related.length > 0 && <>
      <Text className="case-judgment-target-label semantic-tag-group">거래가 겹치는 Alert <CountTag count={related.length} /></Text>
      <Box as="ul" className="case-judgment-targets" aria-label="거래가 겹치는 Alert">
        {related.map(target => <JudgmentTarget key={target.code} row={target} showVerdict />)}
      </Box>
    </>}
  </Box>;
}

function JudgmentDetails({ evidence, observations, reason }) {
  return <Box as="dl" className="case-judgment-details">
    {evidence && <Box><Box as="dt">확인한 근거 자료</Box><Box as="dd">{evidence}</Box></Box>}
    {observations && <Box><Box as="dt">관찰한 사실</Box><Box as="dd">{observations}</Box></Box>}
    <Box><Box as="dt">판정 사유</Box><Box as="dd">{reason}</Box></Box>
  </Box>;
}

export function CaseJudgment({ row, actor, startReview, save, onSavedClose, onReport, onBundle, onTransfer, bundleBlocked, onRelationRequest,
  nextCase, onOpenNext, onOpenList }) {
  const dialog = useRef(null);
  const title = useRef(null);
  const [verdict, setVerdict] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [rationale, setRationale] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [starting, setStarting] = useState(false);
  const pending = row.status === '처리 전';
  const canStart = canStartPreviewReview(row, actor);
  const actionLabel = pending && !onBundle && !bundleBlocked ? '조사 시작' : '판정';
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

  // 조사 시작 요청이 끝날 때까지 버튼을 막아 같은 요청을 여러 번 보내지 않는다.
  function begin() {
    if (starting) return;
    setStarting(true);
    Promise.resolve(startReview(row.code)).finally(() => setStarting(false));
  }

  function open() {
    if (onBundle) {
      onBundle();
      return;
    }
    if (pending && !bundleBlocked) {
      begin();
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

  const reportLink = result && {
    as: 'a', href: `/report?selected=${encodeURIComponent(result.id)}`,
    onClick: event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onReport(result.id);
    },
  };

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
    <PrimaryButton tone="brand" className="case-judgment-trigger" disabled={!actionEnabled || starting}
      aria-busy={starting || undefined}
      aria-haspopup={pending && !onBundle && !bundleBlocked ? undefined : 'dialog'}
      aria-controls={onBundle ? 'case-bundle-dialog' : pending && !bundleBlocked ? undefined : 'case-judgment-dialog'}
      onHold={open}>{actionLabel}</PrimaryButton>
    <DialogFrame id="case-judgment-dialog" className="case-judgment-dialog" ref={dialog} onClose={close} onSubmit={submit}
      titleId="case-judgment-title" titleRef={title} closeLabel="판정 창 닫기"
      title={result ? '판정 완료' : confirm ? '판정 내용 확인' : `${row.kind} 판정`}
      actions={<>
        {bundleBlocked && canStart && <ActionButton shape="pill" surface="floating" disabled={starting}
          onClick={begin}>조사 시작</ActionButton>}
        {onRelationRequest && !requestSent && <ActionButton shape="pill" surface="floating"
          onClick={() => onRelationRequest(rationale.trim(), () => setRequestSent(true))}>관리자에게 요청 보내기</ActionButton>}
        {result ? <>
          {/* 판정을 마치면 대시보드를 거치지 않고 다음 건이나 보던 목록으로 바로 간다. */}
          {onOpenList && <ActionButton shape="pill" surface="floating" onClick={onOpenList}>{row.kind} 목록으로</ActionButton>}
          {nextCase && onOpenNext
            ? <>
              <ActionButton shape="pill" surface="floating" {...reportLink}>보고서 보기</ActionButton>
              <PrimaryButton tone="brand" onClick={() => onOpenNext(nextCase.code)}>다음 건 열기</PrimaryButton>
            </>
            : <PrimaryButton tone="brand" {...reportLink}>보고서 보기</PrimaryButton>}
        </> : eligible && <>
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
      <Box className="case-judgment-body">
        {bundleBlocked && <Callout className="case-judgment-bundle-notice">
          <Text as="strong">Episode 편입 전 확인</Text><LineBreak />
          {bundleBlocked}
        </Callout>}
        {requestSent && <Text role="status">관리자에게 연관 업무 검토 요청을 보냈습니다.</Text>}
        <JudgmentTargets row={row} />
        {result ? <Box className="case-judgment-summary">
          <Text role="status"><Text as="code">{result.id}</Text>에 판정이 저장되었습니다.</Text>
          {/* 버튼에는 이름만 두고, 어느 건으로 가는지는 본문에 다른 코드와 같은 모양으로 보여 준다. */}
          {onOpenNext && (nextCase ? <Text>다음 건 · <Text as="code">{nextCase.code}</Text></Text>
            : <Text>남은 내 업무가 없습니다.</Text>)}
          <Text><VerdictTag verdict={result.verdict} /></Text>
          <Text><Text as="strong">{reasonLabel}</Text></Text>
          <JudgmentDetails {...result} />
        </Box> : confirm ? <Box className="case-judgment-summary">
          <Text><VerdictTag verdict={verdict} /></Text>
          <Text><Text as="strong">{reasonLabel}</Text></Text>
          <JudgmentDetails reason={rationale.trim()} />
          <Text className="case-judgment-note">저장하면 이 업무가 처리 완료로 이동합니다.</Text>
        </Box> : eligible && <>
          <Box className="case-judgment-dropdowns">
            <GlideSelect fullWidth ariaLabel="처리 방식" placeholder="처리 방식 선택" value={verdict}
              options={[
                { value: 'normal', label: row.kind === 'Alert' ? '정상 종결' : '정상' },
                { value: 'abnormal', label: row.kind === 'Alert' ? '단독 의심 종결' : '이상' },
                ...(onTransfer ? [{ value: 'transfer', label: '기존 Episode에 편입' },
                  ...(row.kind === 'Alert' ? [{ value: 'create', label: '새 Episode 만들기' }] : [])] : []),
              ]}
              onChange={value => {
                if (value === 'transfer' || value === 'create') {
                  dialog.current.close();
                  onTransfer(value === 'create');
                } else {
                  setVerdict(value);
                }
              }} />
            <GlideSelect fullWidth ariaLabel="판정 사유 유형" placeholder="판정 사유 유형 선택"
              value={reasonCategory} onChange={setReasonCategory}
              options={Object.entries(judgmentReasonLabels).map(([value, label]) => ({ value, label }))} />
          </Box>
          <Box as="label" className="case-judgment-field">
            <Text as="span">판정 사유</Text>
            <Textarea rows={3} maxLength={judgmentTextLimit} required value={rationale}
              placeholder="판정 이유를 입력해 주세요"
              onChange={event => setRationale(event.target.value)} />
          </Box>
        </>}
        {error && <Text role="alert">{error}</Text>}
      </Box>
    </DialogFrame>
  </>;
}
