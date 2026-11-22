import React, { useState } from 'react';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { DialogFooter } from '../../components/dialog-parts';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { LinkTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { activeReviewStatuses, previewCaseAssignee, requestAdmin, requestCases, requestStaff, workRequestTypes, workRequestUserName } from './preview-work-requests';
import './case-judgment.css';

// 서버 연결에서는 결과가 나중에 온다.
const showFailure = (result, setError) => result instanceof Promise
  ? void result.then(settled => { if (!settled.ok) setError(settled.error); })
  : !result.ok && setError(result.error);

export const requestStateLabels = {
  pending: '처리 대기', approved: '승인', declined: '반려', completed: '처리 완료', 'needs-discussion': '협의 필요', cancelled: '취소',
};

function StaffSelect({ label, value, onChange, except }) {
  return <GlideSelect ariaLabel={label} placeholder={label + ' 선택'} value={value}
    options={requestStaff.filter(staff => staff.username !== except)
      .map(staff => ({ value: staff.username, label: staff.name }))} onChange={onChange} />;
}

function ReviewStatusSelect({ value, onChange, except }) {
  return <div className="case-judgment-field">
    <span>변경할 처리 상태</span>
    <GlideSelect ariaLabel="변경할 처리 상태" placeholder="처리 상태 선택" value={value} onChange={onChange}
      options={activeReviewStatuses.filter(status => status !== except).map(status => ({ value: status, label: status }))} />
  </div>;
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
  return <form className="work-request-frame" onSubmit={event => {
    event.preventDefault();
    showFailure(onSend({ typeKey, code: row?.code, recipient: target, reason, deadline, reviewStatus, relatedCodes: relation?.codes }), setError);
  }}>
    <div className="work-request-form settings-content scroll-area">
      {relation ? <div className="case-judgment-target-group">
        <strong>연관 업무 검토 요청</strong>
        <p>기준 업무 · <code>{initialCode}</code></p>
        <p>비교 후보 · <code>{relation.codes.join(', ')}</code></p>
      </div> : <div className="case-judgment-field">
        <span>요청 유형</span>
        <GlideSelect ariaLabel="요청 유형" placeholder="요청 유형 선택" value={typeKey}
          onChange={value => { setTypeKey(value); setRecipient(''); setReviewStatus(''); setError(''); }}
          options={Object.entries(workRequestTypes).filter(([key, type]) => type.role === actor.role && key !== 'relationReview')
            .map(([value, type]) => ({ value, label: type.label }))} />
      </div>}
      {type && <>
        {!relation && <div className="case-judgment-field">
          <span>대상 업무</span>
          <GlideSelect ariaLabel="대상 업무" placeholder={eligible.length ? 'Alert 또는 Episode 선택' : '선택 가능한 업무 없음'}
            value={row?.code ?? ''} disabled={!eligible.length}
            options={eligible.map(item => ({ value: item.code, label: `${item.code} · ${verdictLabels[item.verdict]}` }))}
            onChange={value => { setCode(value); setRecipient(''); setReviewStatus(''); setError(''); }} />
        </div>}
        {row && <p className="semantic-tag-group"><span>{row.status}</span><VerdictTag verdict={row.verdict} /></p>}
        {pickRecipient && row ? <div className="case-judgment-field">
          <span>새 담당자</span>
          <StaffSelect label="새 담당자" value={recipient} onChange={setRecipient} except={previewCaseAssignee(row)} />
        </div> : <p>받는 사람 · {admin ? target && workRequestUserName(target) : requestAdmin().name}</p>}
        {setsReviewStatus && row && <ReviewStatusSelect value={reviewStatus} onChange={setReviewStatus} except={row.status} />}
        {type.deadline && <label className="case-judgment-field">처리 기한
          <Input type="date" required value={deadline} onChange={event => setDeadline(event.target.value)} />
        </label>}
        <label className="case-judgment-field">사유 및 확인할 근거
          <Textarea required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
        </label>
        {sendsChange && <p className="case-judgment-note">보내는 즉시 Sample 업무에 반영됩니다.</p>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
    <DialogFooter>
      <PrimaryButton type="submit" tone="brand" disabled={!row || !reason.trim() || (pickRecipient && !recipient)
        || (type?.deadline && !deadline) || (setsReviewStatus && !reviewStatus)}>요청 보내기</PrimaryButton>
    </DialogFooter>
  </form>;
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
  return <div className="work-request-frame">
    <div className="work-request-form settings-content scroll-area">
      <div className="semantic-tag-group">
        <strong>{workRequestTypes[item.type].label}</strong><span>{requestStateLabels[item.state]}</span>
      </div>
      <p>{workRequestUserName(item.sender)} → {workRequestUserName(item.recipient)}</p>
      <div><LinkTag code={item.code} aria-label={item.code + ' 열기'} data-work-code={undefined} onClick={() => onOpenCase(item.code)} /></div>
      {item.related?.map(candidate => <section key={candidate.code} className="case-judgment-summary">
        <div className="semantic-tag-group">
          <LinkTag code={candidate.code} aria-label={candidate.code + ' 열기'} data-work-code={undefined} onClick={() => onOpenCase(candidate.code)} />
          <VerdictTag verdict={candidate.verdict} />
        </div>
        <p>{candidate.status} · {workRequestUserName(candidate.assignee)}</p>
        <p className="work-request-message">공통 거래 · {candidate.transactions.join(', ') || '없음'}</p>
        <p className="work-request-message">공통 계좌 · {candidate.accounts.join(', ') || '없음'}</p>
      </section>)}
      {item.deadline && <p>처리 기한 · <time dateTime={item.deadline}>{item.deadline}</time></p>}
      <p className="work-request-message">{item.reason}</p>
      {item.before && <div className="case-judgment-summary">
        <p className="semantic-tag-group">변경 전 · {item.before.status}<VerdictTag verdict={item.before.verdict} /></p>
        {item.reviewStatus && <p>변경 후 · {item.reviewStatus}</p>}
        {item.assignee && <p>담당자 · {workRequestUserName(item.before.assignee)} → {workRequestUserName(item.assignee)}</p>}
        {item.before.judgment && <p className="work-request-message">이전 판정 사유 · {item.before.judgment.reason}</p>}
      </div>}
      {item.note && <p className="work-request-message">처리 내용 · {item.note}</p>}
      {canRespond && <form id="work-request-response" className="work-request-form" onSubmit={event => {
        event.preventDefault();
        showFailure(onRespond({ id: item.id, action, note, assignee, reviewStatus }), setError);
      }}>
        <GlideSelect ariaLabel="처리 방법" value={action} placeholder="처리 방법 선택" onChange={setAction}
          options={(admin ? ['approved', 'declined'] : ['completed', 'needs-discussion'])
            .map(value => ({ value, label: requestStateLabels[value] }))} />
        {needsAssignee && <StaffSelect label="새 담당자" value={assignee} onChange={setAssignee} except={currentAssignee} />}
        {admin && item.type === 'reopen' && action === 'approved' &&
          <ReviewStatusSelect value={reviewStatus} onChange={setReviewStatus} />}
        <label className="case-judgment-field">처리 내용
          <Textarea required maxLength={2000} value={note} onChange={event => setNote(event.target.value)} />
        </label>
      </form>}
      {error && <p role="alert">{error}</p>}
    </div>
    {(canCancel || canRespond) && <DialogFooter>
      {canCancel && <ActionButton shape="pill" surface="floating" onClick={() => {
        showFailure(onRespond({ id: item.id, action: 'cancelled' }), setError);
      }}>요청 취소</ActionButton>}
      {canRespond && <PrimaryButton type="submit" form="work-request-response" tone="brand"
        disabled={!action || !note.trim() || (needsAssignee && !assignee)}>처리 결과 보내기</PrimaryButton>}
    </DialogFooter>}
  </div>;
}
