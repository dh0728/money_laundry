import React, { useEffect, useId, useRef, useState } from 'react';
import { fetchAiReport } from '@/api/aiReport';
import { ActionButton } from '../../components/primary-button';
import { DialogFrame } from '../../components/dialog-parts';
import { enableBackdropDismissal } from '../../lib/overlay-dismissal';
import { Box, Heading, Text } from '../../components/layout-primitives';
import { judgmentNumber, narrativeSections } from './case-ai-report';
import './case-judgment.css';

// 보고서 작성 화면의 판정 미리보기. '이상' 판정이면 저장된 AI 분석 보고서(API.md §14)를 PDF 와 같은 순서로 보여 준다.
// 판정할 때 서버가 미리 만들어 두므로 보통 바로 뜨고, 만드는 중이면 끝날 때까지 기다린다.

const kst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });

/** 판정 하나의 AI 보고서를 읽는다. 샘플 모드·'정상' 판정은 부르지 않는다. */
export function useAiReport(row, { live = import.meta.env.VITE_API_MODE === 'live', fetch = fetchAiReport } = {}) {
  const id = row ? judgmentNumber(row.id) : null;
  const applicable = Boolean(row) && row.verdict === 'abnormal' && id != null;
  const [state, setState] = useState({ key: null, status: 'idle' });
  const key = row ? `${row.id}` : null;
  async function load(regenerate = false) {
    setState({ key, status: 'loading' });
    try {
      setState({ key, status: 'ready', report: await fetch(id, regenerate) });
    } catch (error) {
      setState({ key, status: 'failed', error: error?.message || 'AI 보고서를 만들지 못했습니다.' });
    }
  }
  useEffect(() => {
    if (!applicable || !live) return;
    let current = true;
    setState({ key, status: 'loading' });
    fetch(id).then(report => { if (current) setState({ key, status: 'ready', report }); },
      error => { if (current) setState({ key, status: 'failed', error: error?.message || 'AI 보고서를 만들지 못했습니다.' }); });
    return () => { current = false; };
  }, [key, applicable, live, fetch, id]);
  if (!row) return { status: 'idle' };
  if (!applicable) return { status: 'not-applicable' };
  if (!live) return { status: 'sample' };
  return { ...(state.key === key ? state : { status: 'loading' }), regenerate: () => load(true) };
}

/** 저장된 보고서 본문: 분석 요지, 서술 1)~7), 확인 필요 사항, 근거 사실 목록 */
export function AiReportBody({ report }) {
  return <Box className="case-judgment-body" data-ai-report={report.reportId}>
    {narrativeSections.map(([key, label]) => {
      const sentences = report.narrative?.[key] ?? [];
      if (!sentences.length) return null;
      return <Box as="section" key={key} aria-label={label}>
        <Heading level={3}>{label}</Heading>
        <Box as="ul">{sentences.map(sentence => <Box as="li" key={sentence.text}>
          {sentence.text} <Text as="span" className="case-judgment-note">[{sentence.sources.join(', ')}]</Text>
        </Box>)}</Box>
      </Box>;
    })}
    {report.needsBankCheck?.length > 0 && <Box as="section" aria-label="금융회사 확인 필요 사항">
      <Heading level={3}>금융회사 확인 필요 사항</Heading>
      <Box as="ul">{report.needsBankCheck.map(item => <Box as="li" key={item}>{item}</Box>)}</Box>
    </Box>}
    <Box as="details">
      <Box as="summary">근거 사실 목록 ({report.facts?.length ?? 0}개)</Box>
      <Box as="ul">{(report.facts ?? []).map(fact => <Box as="li" key={fact.id}><Text as="code">{fact.id}</Text> {fact.text}</Box>)}</Box>
    </Box>
    <Text className="case-judgment-note">
      보고서 {report.reportId} · {report.model} · {kst.format(new Date(report.createdAt))} KST · 법정 STR 작성 참고용(제출용 아님) · 모델 추정은 담당자 판정과 별개
    </Text>
  </Box>;
}

/**
 * 판정 미리보기 팝업. row 가 생기면 열리고, 닫히면 onClose 를 부른다.
 * @param onDownload 이 판정 하나만 PDF 로 받는다
 */
export function AiReportPreview({ row, onClose, onDownload, downloading = false }) {
  const id = useId();
  const dialog = useRef(null);
  const title = useRef(null);
  const state = useAiReport(row);
  useEffect(() => {
    if (!row || !dialog.current) return;
    enableBackdropDismissal(dialog.current);
    if (!dialog.current.open) dialog.current.showModal();
    title.current?.focus();
  }, [row]);
  if (!row) return null;
  return <DialogFrame ref={dialog} id={id} titleId={`${id}-title`} titleRef={title}
    title={`${row.id} · AI 분석 보고서 미리보기`} closeLabel="미리보기 닫기" className="case-judgment-dialog"
    onClose={onClose}
    actions={<>
      {state.status === 'failed' && <ActionButton shape="pill" surface="ghost" onClick={state.regenerate}>다시 만들기</ActionButton>}
      <ActionButton shape="pill" disabled={downloading || state.status === 'loading'} onClick={() => onDownload(row)}>PDF 다운로드</ActionButton>
    </>}>
    {state.status === 'ready' ? <AiReportBody report={state.report} /> : <Box className="case-judgment-body">
      {state.status === 'loading' && <Text className="case-judgment-note" role="status">보고서를 불러오는 중입니다. 판정 직후라 아직 만드는 중이면 끝날 때까지 기다립니다.</Text>}
      {state.status === 'failed' && <Text className="case-judgment-note" role="alert">AI 보고서를 만들지 못했습니다. ({state.error})</Text>}
      {state.status === 'not-applicable' && <Text className="case-judgment-note">'이상'으로 판정한 건만 AI 분석 보고서를 만듭니다. PDF에는 판정 기록만 들어갑니다.</Text>}
      {state.status === 'sample' && <Text className="case-judgment-note">샘플 모드에서는 AI 보고서를 만들지 않습니다.</Text>}
    </Box>}
  </DialogFrame>;
}
