import React, { useState } from 'react';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { DialogFooter } from '../../components/dialog-parts';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { LinkTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { activeReviewStatuses, previewCaseAssignee, requestAdmin, requestCases, requestStaff, workRequestTypes, workRequestUserName } from './preview-work-requests';
import './case-judgment.css';
import { Box, Text } from '../../components/layout-primitives';

// 서버 연결에서는 결과가 나중에 온다.
const showFailure = (result, setError) => result instanceof Promise
  ? void result.then(settled => { if (!settled.ok) setError(settled.error); })
  : !result.ok && setError(result.error);

export const requestStateLabels = {
  pending: '처리 대기', approved: '승인', declined: '반려', completed: '처리 완료', 'needs-discussion': '협의 필요', cancelled: '취소',
};

function StaffSelect({ label, value, onChange, except }) {
  return <GlideSelect fullWidth ariaLabel={label} placeholder={label + ' 선택'} value={value}
    options={requestStaff.filter(staff => staff.username !== except)
      .map(staff => ({ value: staff.username, label: staff.name }))} onChange={onChange} />;
}

function ReviewStatusSelect({ value, onChange, except }) {
  return <Box className="case-judgment-field">
    <Text as="span">변경할 처리 상태</Text>
    <GlideSelect fullWidth ariaLabel="변경할 처리 상태" placeholder="처리 상태 선택" value={value} onChange={onChange}
      options={activeReviewStatuses.filter(status => status !== except).map(status => ({ value: status, label: status }))} />
  </Box>;
}

export function WorkRequestForm({ actor, cases, initialCode, relation, onSend }) {
  const [typeKey, setTypeKey] = useState(relation ? 'relationReview' : '');
  const [code, setCode] = useState(initialCode);
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState(relation?.reason ?? '');
  const [deadline, setDeadline] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [error, setError] = useState('');
  const type = workRequestTypes[typeKey];
  const eligible = requestCases(cases, type, actor);
  const row = eligible.find(item => item.code === code);
  const admin = actor.role === 'ADMIN';
  const pickRecipient = admin && type?.effect === 'assign';
  const target = pickRecipient ? recipient : row && previewCaseAssignee(row);
  const sendsChange = admin && type?.effect;
  const setsReviewStatus = admin && ['reopen', 'status'].includes(type?.effect);
  return <Box as="form" className="work-request-frame" onSubmit={event => {
    event.preventDefault();
    showFailure(onSend({ typeKey, code: row?.code, recipient: target, reason, deadline, reviewStatus, relatedCodes: relation?.codes }), setError);
  }}>
    <Box className="work-request-form settings-content scroll-area">
      {relation ? <Box className="case-judgment-target-group">
        <Text as="strong">연관 업무 검토 요청</Text>
        <Text>기준 업무 · <Text as="code">{initialCode}</Text></Text>
        <Text>비교 후보 · <Text as="code">{relation.codes.join(', ')}</Text></Text>
      </Box> : <Box className="case-judgment-field">
        <Text as="span">요청 유형</Text>
        <GlideSelect fullWidth ariaLabel="요청 유형" placeholder="요청 유형 선택" value={typeKey}
          onChange={value => { setTypeKey(value); setRecipient(''); setReviewStatus(''); setError(''); }}
          options={Object.entries(workRequestTypes).filter(([key, type]) => type.role === actor.role && key !== 'relationReview')
            .map(([value, type]) => ({ value, label: type.label }))} />
      </Box>}
      {type && <>
        {!relation && <Box className="case-judgment-field">
          <Text as="span">대상 업무</Text>
          <GlideSelect fullWidth ariaLabel="대상 업무" placeholder={eligible.length ? 'Alert 또는 Episode 선택' : '선택 가능한 업무 없음'}
            value={row?.code ?? ''} disabled={!eligible.length}
            options={eligible.map(item => ({ value: item.code, label: `${item.code} · ${verdictLabels[item.verdict]}` }))}
            onChange={value => { setCode(value); setRecipient(''); setReviewStatus(''); setError(''); }} />
        </Box>}
        {row && <Text className="semantic-tag-group"><Text as="span">{row.status}</Text><VerdictTag verdict={row.verdict} /></Text>}
        {pickRecipient && row ? <Box className="case-judgment-field">
          <Text as="span">새 담당자</Text>
          <StaffSelect label="새 담당자" value={recipient} onChange={setRecipient} except={previewCaseAssignee(row)} />
        </Box> : <Text>받는 사람 · {admin ? target && workRequestUserName(target) : requestAdmin().name}</Text>}
        {setsReviewStatus && row && <ReviewStatusSelect value={reviewStatus} onChange={setReviewStatus} except={row.status} />}
        {type.deadline && <Box as="label" className="case-judgment-field">처리 기한
          <Input type="date" required value={deadline} onChange={event => setDeadline(event.target.value)} />
        </Box>}
        <Box as="label" className="case-judgment-field">사유 및 확인할 근거
          <Textarea required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
        </Box>
        {sendsChange && <Text className="case-judgment-note">보내는 즉시 Sample 업무에 반영됩니다.</Text>}
      </>}
      {error && <Text role="alert">{error}</Text>}
    </Box>
    <DialogFooter>
      <PrimaryButton type="submit" tone="brand" disabled={!row || !reason.trim() || (pickRecipient && !recipient)
        || (type?.deadline && !deadline) || (setsReviewStatus && !reviewStatus)}>요청 보내기</PrimaryButton>
    </DialogFooter>
  </Box>;
}

export function WorkRequestDetail({ item, actor, currentAssignee, onRespond, onOpenCase }) {
  const [action, setAction] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [reviewStatus, setReviewStatus] = useState('처리 중');
  const [error, setError] = useState('');
  const admin = actor.role === 'ADMIN';
  const needsAssignee = admin && item.type === 'changeAssignee' && action === 'approved';
  const canCancel = item.state === 'pending' && item.sender === actor.username && !item.appliedAt;
  const canRespond = item.recipient === actor.username && item.state === 'pending';
  return <Box className="work-request-frame">
    <Box className="work-request-form settings-content scroll-area">
      <Box className="semantic-tag-group">
        <Text as="strong">{workRequestTypes[item.type].label}</Text><Text as="span">{requestStateLabels[item.state]}</Text>
      </Box>
      <Text>{workRequestUserName(item.sender)} → {workRequestUserName(item.recipient)}</Text>
      <Box><LinkTag code={item.code} aria-label={item.code + ' 열기'} data-work-code={undefined} onClick={() => onOpenCase(item.code)} /></Box>
      {item.related?.map(candidate => <Box as="section" key={candidate.code} className="case-judgment-summary">
        <Box className="semantic-tag-group">
          <LinkTag code={candidate.code} aria-label={candidate.code + ' 열기'} data-work-code={undefined} onClick={() => onOpenCase(candidate.code)} />
          <VerdictTag verdict={candidate.verdict} />
        </Box>
        <Text>{candidate.status} · {workRequestUserName(candidate.assignee)}</Text>
        <Text className="work-request-message">공통 거래 · {candidate.transactions.join(', ') || '없음'}</Text>
        <Text className="work-request-message">공통 계좌 · {candidate.accounts.join(', ') || '없음'}</Text>
      </Box>)}
      {item.deadline && <Text>처리 기한 · <Text as="time" dateTime={item.deadline}>{item.deadline}</Text></Text>}
      <Text className="work-request-message">{item.reason}</Text>
      {item.before && <Box className="case-judgment-summary">
        <Text className="semantic-tag-group">변경 전 · {item.before.status}<VerdictTag verdict={item.before.verdict} /></Text>
        {item.reviewStatus && <Text>변경 후 · {item.reviewStatus}</Text>}
        {item.assignee && <Text>담당자 · {workRequestUserName(item.before.assignee)} → {workRequestUserName(item.assignee)}</Text>}
        {item.before.judgment && <Text className="work-request-message">이전 판정 사유 · {item.before.judgment.reason}</Text>}
      </Box>}
      {item.note && <Text className="work-request-message">처리 내용 · {item.note}</Text>}
      {canRespond && <Box as="form" id="work-request-response" className="work-request-form" onSubmit={event => {
        event.preventDefault();
        showFailure(onRespond({ id: item.id, action, note, assignee, reviewStatus }), setError);
      }}>
        <GlideSelect fullWidth ariaLabel="처리 방법" value={action} placeholder="처리 방법 선택" onChange={setAction}
          options={(admin ? ['approved', 'declined'] : ['completed', 'needs-discussion'])
            .map(value => ({ value, label: requestStateLabels[value] }))} />
        {needsAssignee && <StaffSelect label="새 담당자" value={assignee} onChange={setAssignee} except={currentAssignee} />}
        {admin && item.type === 'reopen' && action === 'approved' &&
          <ReviewStatusSelect value={reviewStatus} onChange={setReviewStatus} />}
        <Box as="label" className="case-judgment-field">처리 내용
          <Textarea required maxLength={2000} value={note} onChange={event => setNote(event.target.value)} />
        </Box>
      </Box>}
      {error && <Text role="alert">{error}</Text>}
    </Box>
    {(canCancel || canRespond) && <DialogFooter>
      {canCancel && <ActionButton shape="pill" surface="floating" onClick={() => {
        showFailure(onRespond({ id: item.id, action: 'cancelled' }), setError);
      }}>요청 취소</ActionButton>}
      {canRespond && <PrimaryButton type="submit" form="work-request-response" tone="brand"
        disabled={!action || !note.trim() || (needsAssignee && !assignee)}>처리 결과 보내기</PrimaryButton>}
    </DialogFooter>}
  </Box>;
}
