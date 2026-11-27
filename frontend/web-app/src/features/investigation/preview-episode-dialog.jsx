import React, { useId, useState } from 'react';
import { DialogFrame } from '../../components/dialog-parts';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { QueryCheck } from '../../components/selection-check';
import { Textarea } from '../../components/ui/textarea';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { EpisodeAlertSummary } from './preview-case-card';
import { canTransferAlert, nextPreviewEpisodeCode, previewEpisodeCompanions, previewEpisodeWillDissolve } from './preview-episode-transfer';
import { Box, Text } from '../../components/layout-primitives';

export function PreviewEpisodeDialog({ cases, row, save, onClose, unlink = false, bundle, onRelationRequest, startNew = false }) {
  const titleId = useId();
  // Alert 상세에서 열면 이 Alert는 고정하고, 계좌·거래를 공유하는 내 담당 Alert를 골라 함께 묶을 수 있다.
  const companionMode = !bundle && !unlink && row?.kind === 'Alert';
  const companions = companionMode ? previewEpisodeCompanions(cases, row) : [];
  const fixedAlertCodes = bundle?.alerts ?? (!unlink && row && !companionMode ? [row.code] : undefined);
  const [pickedAlertCodes, setPickedAlertCodes] = useState([]);
  const selected = companionMode ? [row.code, ...pickedAlertCodes] : fixedAlertCodes ?? pickedAlertCodes;
  const [target, setTarget] = useState(bundle?.target ?? '');
  const [creating, setCreating] = useState(startNew || Boolean(bundle?.alerts.length >= 2 && !bundle.target));
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
  const useNewEpisode = creating && (companionMode || selected.length >= 2);
  const needsCompanion = useNewEpisode && selected.length < 2;
  const newEpisodeCode = useNewEpisode && !needsCompanion ? nextPreviewEpisodeCode(cases, selected[0]) : '';
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
    <Box className="case-judgment-body">
      {result ? <Text role="status">{dissolves ? 'Episode 해체 완료' : unlink ? '연결 해제 완료' : useNewEpisode ? '새 Episode 생성 완료' : 'Episode 편입 완료'} · <Text as="code">{result}</Text></Text>
        : confirmed ? <Box className="case-judgment-summary">
          <Text>{dissolves ? '남는 Alert가 2건 미만입니다. 모든 Alert를 복원하고 Episode를 해체합니다.'
            : unlink ? '선택한 Alert의 연결을 해제합니다.'
              : `선택한 Alert 전체를 ${useNewEpisode ? `새 Episode ${confirmedNewCode}` : target}에 편입합니다.`}</Text>
          <Box as="ul">{selected.map(code => <Box as="li" key={code}><Text as="code">{code}</Text></Box>)}</Box>
          <Text>{reason.trim()}</Text>
        </Box> : <>
          {!unlink && <Box className="case-judgment-dropdowns">
            <GlideSelect fullWidth ariaLabel="편입 방식" value={useNewEpisode ? 'new' : 'existing'}
              options={[
                { value: 'existing', label: '기존 Episode에 편입' },
                ...(companionMode || selected.length >= 2 ? [{ value: 'new', label: '새 Episode 생성' }] : []),
              ]}
              onChange={value => setCreating(value === 'new')} />
            {useNewEpisode ? needsCompanion ? <Text role="status">새 Episode는 Alert 2건 이상이 필요합니다. 함께 묶을 Alert를 골라 주세요.</Text>
              : <Box as="dl" className="case-judgment-details">
                <Box><Box as="dt">생성 예정 ID</Box><Box as="dd"><Text as="code">{newEpisodeCode}</Text></Box></Box>
              </Box> : <Box className="case-judgment-field">
              <Text as="span">대상 Episode ID</Text>
              <GlideSelect fullWidth ariaLabel="대상 Episode" placeholder="Episode ID 선택"
                value={target} onChange={setTarget} options={episodes.map(item => item.code)}
                disabled={!episodes.length} />
              {!episodes.length && <Text>편입할 수 있는 진행 중 Episode가 없습니다.</Text>}
            </Box>}
          </Box>}
          {!unlink && !useNewEpisode && targetEpisode && <Box as="dl" className="case-judgment-details">
            <Box><Box as="dt">대상 Episode의 소속 Alert</Box><Box as="dd"><EpisodeAlertSummary codes={targetEpisode.linkedAlertCodes}
              complete={targetEpisode.linkedAlertCodesComplete} /></Box></Box>
          </Box>}
          {companionMode ? <Box as="fieldset" className="case-judgment-evidence">
            <Box as="legend">묶을 Alert</Box>
            <QueryCheck label={<Text as="code">{row.code}</Text>} ariaLabel={`${row.code} (지금 보는 Alert)`} checked disabled />
            {companions.map(({ item, accounts, transactions }) => <QueryCheck key={item.code} ariaLabel={item.code}
              label={<><Text as="code">{item.code}</Text> <Text as="span">{[
                transactions.length && `공유 거래 ${transactions.length}건`, accounts.length && `공유 계좌 ${accounts.length}개`,
              ].filter(Boolean).join(' · ')}</Text></>}
              checked={selected.includes(item.code)}
              onChange={checked => setPickedAlertCodes(previous => checked
                ? [...previous, item.code] : previous.filter(code => code !== item.code))} />)}
            {!companions.length && <Text>계좌·거래를 공유하는 내 담당 Alert가 없습니다.</Text>}
          </Box> : <Box as="fieldset" className="case-judgment-evidence">
            <Box as="legend">{fixedAlertCodes ? '편입할 Alert' : 'Alert 선택'}</Box>
            {visibleAlerts.map(item => <QueryCheck key={item.code} label={<Text as="code">{item.code}</Text>} ariaLabel={item.code}
              checked={selected.includes(item.code)} disabled={Boolean(fixedAlertCodes)}
              onChange={checked => setPickedAlertCodes(previous => checked
                ? [...previous, item.code] : previous.filter(code => code !== item.code))} />)}
            {!visibleAlerts.length && <Text>선택 가능한 Alert가 없습니다.</Text>}
          </Box>}
          <Box as="label" className="case-judgment-field">변경 사유
            <Textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} />
          </Box>
          <Text>검수용 변경은 이 탭에 저장됩니다.</Text>
        </>}
      {error && <Text role="alert">{error}</Text>}
      {requestSent && <Text role="status">관리자에게 연관 업무 검토 요청을 보냈습니다.</Text>}
    </Box>
  </DialogFrame>;
}
