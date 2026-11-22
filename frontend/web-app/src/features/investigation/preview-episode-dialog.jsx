import React, { useId, useState } from 'react';
import { DialogFrame } from '../../components/dialog-parts';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { QueryCheck } from '../../components/selection-check';
import { Textarea } from '../../components/ui/textarea';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { EpisodeAlertSummary } from './preview-case-card';
import { canTransferAlert, nextPreviewEpisodeCode, previewEpisodeWillDissolve } from './preview-episode-transfer';

export function PreviewEpisodeDialog({ cases, row, save, onClose, unlink = false, bundle, onRelationRequest }) {
  const titleId = useId();
  const fixedAlertCodes = bundle?.alerts ?? (!unlink && row ? [row.code] : undefined);
  const [pickedAlertCodes, setPickedAlertCodes] = useState([]);
  const selected = fixedAlertCodes ?? pickedAlertCodes;
  const [target, setTarget] = useState(bundle?.target ?? '');
  const [creating, setCreating] = useState(Boolean(bundle?.alerts.length >= 2 && !bundle.target));
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedNewCode, setConfirmedNewCode] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const alerts = cases.filter(item => unlink ? row.linkedAlertCodes?.includes(item.code) : canTransferAlert(item));
  const episodes = cases.filter(item => item.kind === 'Episode' && item.open);
  const visibleAlerts = fixedAlertCodes ? alerts.filter(item => fixedAlertCodes.includes(item.code)) : alerts;
  const targetEpisode = episodes.find(item => item.code === target);
  const useNewEpisode = creating && selected.length >= 2;
  const newEpisodeCode = useNewEpisode ? nextPreviewEpisodeCode(cases, selected[0]) : '';
  const valid = Boolean(reason.trim() && selected.length && (unlink || newEpisodeCode || targetEpisode));
  const dissolves = unlink && previewEpisodeWillDissolve(row, selected.length);
  const label = unlink ? 'Alert 연결 해제' : 'Episode로 묶기';

  // 서버 저장은 응답을 기다린다. 프리뷰 저장은 바로 끝난다.
  async function submit(event) {
    event.preventDefault();
    if (!valid || result) return;
    if (!confirmed) {
      setConfirmedNewCode(newEpisodeCode);
      setConfirmed(true);
      return;
    }
    const response = await save({ alertCodes: selected, episodeCode: unlink ? row.code : useNewEpisode ? '' : target,
      expectedNewCode: confirmedNewCode, reason, unlink });
    if (response.ok) setResult(response.code);
    else setError(response.error);
  }

  return <DialogFrame id={bundle ? 'case-bundle-dialog' : undefined} ref={node => {
    if (node && !node.open) node.showModal();
  }} className="case-judgment-dialog" titleId={titleId} closeLabel="Episode 편집 창 닫기"
    title={bundle ? `${row.kind} 판정 · Episode 편입` : label}
    onClose={() => onClose(Boolean(result))} onSubmit={submit}
    actions={(!result || !unlink) && <>
      {!result && onRelationRequest && !requestSent && <ActionButton shape="pill" surface="floating"
        onClick={() => onRelationRequest(reason.trim().slice(0, 2000), () => setRequestSent(true))}>관리자에게 요청 보내기</ActionButton>}
      {confirmed && !result && <ActionButton shape="pill" surface="floating"
        onClick={() => { setConfirmed(false); setError(''); }}>내용 수정</ActionButton>}
      {!result && <PrimaryButton type="submit" tone="brand" disabled={!valid}>{confirmed ? label : '내용 확인'}</PrimaryButton>}
      {result && !unlink && <PrimaryButton as="a" href={`/episodes/${result}?tab=related${location.search.includes('data=sample') ? '&data=sample' : ''}`}>Episode 열기</PrimaryButton>}
    </>}>
    <div className="case-judgment-body">
      {result ? <p role="status">{dissolves ? 'Episode 해체 완료' : unlink ? '연결 해제 완료' : useNewEpisode ? '새 Episode 생성 완료' : 'Episode 편입 완료'} · <code>{result}</code></p>
        : confirmed ? <div className="case-judgment-summary">
          <p>{dissolves ? '남는 Alert가 2건 미만입니다. 모든 Alert를 복원하고 Episode를 해체합니다.'
            : unlink ? '선택한 Alert의 연결을 해제합니다.'
              : `선택한 Alert 전체를 ${useNewEpisode ? `새 Episode ${confirmedNewCode}` : target}에 편입합니다.`}</p>
          <ul>{selected.map(code => <li key={code}><code>{code}</code></li>)}</ul>
          <p>{reason.trim()}</p>
        </div> : <>
          {!unlink && <div className="case-judgment-dropdowns">
            <GlideSelect ariaLabel="편입 방식" value={useNewEpisode ? 'new' : 'existing'}
              options={[
                { value: 'existing', label: '기존 Episode에 편입' },
                ...(selected.length >= 2 ? [{ value: 'new', label: '새 Episode 생성' }] : []),
              ]}
              onChange={value => setCreating(value === 'new')} />
            {useNewEpisode ? <dl className="case-judgment-details">
              <div><dt>생성 예정 ID</dt><dd><code>{newEpisodeCode}</code></dd></div>
            </dl> : <div className="case-judgment-field">
              <span>대상 Episode ID</span>
              <GlideSelect ariaLabel="대상 Episode" placeholder="Episode ID 선택"
                value={target} onChange={setTarget} options={episodes.map(item => item.code)}
                disabled={!episodes.length} />
              {!episodes.length && <p>편입할 수 있는 진행 중 Episode가 없습니다.</p>}
            </div>}
          </div>}
          {!unlink && !useNewEpisode && targetEpisode && <dl className="case-judgment-details">
            <div><dt>대상 Episode의 소속 Alert</dt><dd><EpisodeAlertSummary codes={targetEpisode.linkedAlertCodes}
              complete={targetEpisode.linkedAlertCodesComplete} /></dd></div>
          </dl>}
          <fieldset className="case-judgment-evidence">
            <legend>{fixedAlertCodes ? '편입할 Alert' : 'Alert 선택'}</legend>
            {visibleAlerts.map(item => <QueryCheck key={item.code} label={<code>{item.code}</code>} ariaLabel={item.code}
              checked={selected.includes(item.code)} disabled={Boolean(fixedAlertCodes)}
              onChange={checked => setPickedAlertCodes(previous => checked
                ? [...previous, item.code] : previous.filter(code => code !== item.code))} />)}
            {!visibleAlerts.length && <p>선택 가능한 Alert가 없습니다.</p>}
          </fieldset>
          <label className="case-judgment-field">변경 사유
            <Textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          <p>검수용 변경은 이 탭에 저장됩니다.</p>
        </>}
      {error && <p role="alert">{error}</p>}
      {requestSent && <p role="status">관리자에게 연관 업무 검토 요청을 보냈습니다.</p>}
    </div>
  </DialogFrame>;
}
