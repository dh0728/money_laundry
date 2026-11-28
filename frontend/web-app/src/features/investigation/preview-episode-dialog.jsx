import React, { lazy, Suspense, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Ban, TriangleAlert } from 'lucide-react';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { DialogFrame } from '../../components/dialog-parts';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { QueryRadio } from '../../components/query-controls';
import { SearchField } from '../../components/search-field';
import { Callout } from '../../components/Callout';
import { Textarea } from '../../components/ui/textarea';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { CountTag, ModelScoreTag, PatternTag, StatusTag } from '../../components/semantic-tags';
import { SortableTableHead, tableCount, useTableSelection, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { caseGroupColor, caseGroupShape, caseShapeClip } from '../graph/graph-case-groups';
import { currentPreviewUser } from '../auth/preview-session-user';
import { EpisodeAlertSummary } from './preview-case-card';
import { sharedCaseEvidence } from './case-graph-scope';
import { bundleConnection, canTransferAlert, nextPreviewEpisodeCode, previewEpisodeCompanions, previewEpisodeWillDissolve,
  transferBlockCounts, transferBlockReason } from './preview-episode-transfer';
import './episode-bundle-dialog.css';
import { Box, Text } from '../../components/layout-primitives';

const EpisodeBundleGraph = lazy(() => import('./episode-bundle-graph'));
const number = new Intl.NumberFormat('ko-KR');
const methodItems = [{ value: 'new', label: '새 Episode' }, { value: 'existing', label: '기존 Episode' }];
const amounts = row => Object.entries(row.amountByCurrency ?? {});
const baseColumns = [
  { name: 'ID', value: row => row.code },
  { name: '패턴', value: row => row.pattern },
  { name: '모델 점수', value: row => row.score },
  { name: '거래 건수', value: row => row.related.length },
  { name: '거래 금액', value: row => amounts(row)[0]?.[1] ?? null },
  { name: '경과일', value: row => row.open ? row.elapsed : null },
];
const sharedColumns = [
  { name: '공유 거래', value: row => row.sharedTransactions },
  { name: '공유 계좌', value: row => row.sharedAccounts },
];

// 업무마다 그래프 구분 칸(색·모양)을 준다. 빠진 업무의 칸은 비워 두었다가 다음에 고른 업무가 가장 앞의 빈 칸을 받는다.
function useGroupSlots(codes) {
  const memory = useRef(new Map());
  const key = codes.join(' ');
  return useMemo(() => {
    const wanted = key ? key.split(' ') : [];
    const slots = new Map([...memory.current].filter(([code]) => wanted.includes(code)));
    for (const code of wanted) {
      if (slots.has(code)) continue;
      const used = new Set(slots.values());
      let slot = 0;
      while (used.has(slot)) slot++;
      slots.set(code, slot);
    }
    memory.current = slots;
    return slots;
  }, [key]);
}

function GroupSwatch({ slot }) {
  if (slot === undefined) return null;
  return <Text as="i" className="episode-bundle-swatch" aria-hidden="true"
    style={{ '--case-graph-swatch-ink': caseGroupColor(slot), '--case-graph-swatch-clip': caseShapeClip(caseGroupShape(slot)) }} />;
}

function CodeChip({ code, slot, note }) {
  return <Text as="span" className="episode-bundle-chip"><GroupSwatch slot={slot} /><Text as="code">{code}</Text>
    {note && <Text as="span">{note}</Text>}</Text>;
}

function CandidateTable({ rows, shared, picked, slots, onChange, query, onQuery, total }) {
  const filtered = query.trim() ? rows.filter(row => [row.code, row.pattern]
    .some(value => String(value ?? '').toLowerCase().includes(query.trim().toLowerCase()))) : rows;
  const sorting = useTableSort(filtered);
  const selection = useTableSelection(sorting.rows, undefined, undefined, { selected: picked, change: onChange });
  const headings = shared ? [...baseColumns, ...sharedColumns] : baseColumns;
  return <><SearchField variant="compact" label="ID 또는 패턴 검색" placeholder="ID, 패턴" value={query}
    onChange={event => onQuery(event.target.value)} />
  <WorkflowTable label="묶을 Alert" summary={tableCount(filtered.length, total, '건', picked.size)} fill
    tableClassName="preview-case-table" selection={selection} compact tools={false}>
    <TableHeader><TableRow>
      <TableHead scope="col" aria-label="그래프 표식" />
      {headings.map(({ name, value }) => <SortableTableHead key={name} sorting={sorting} column={name} value={value}>{name}</SortableTableHead>)}
    </TableRow></TableHeader>
    <TableBody>
      {sorting.rows.map(row => {
        const totals = amounts(row);
        return <TableRow key={row.code} data-selected={picked.has(row.code) || undefined}>
          <TableCell><GroupSwatch slot={picked.has(row.code) ? slots.get(row.code) : undefined} /></TableCell>
          <TableRowHead><Text as="code">{row.code}</Text></TableRowHead>
          <TableCell><PatternTag emphasis="solid">{row.pattern}</PatternTag></TableCell>
          <TableCell><ModelScoreTag score={row.score} /></TableCell>
          <TableCell numeric>{row.related.length}건</TableCell>
          <TableCell numeric stacked>{totals.length
            ? totals.map(([currency, amount]) => <Text as="span" key={currency}>{number.format(amount)} {currency}</Text>) : '미제공'}</TableCell>
          <TableCell>{row.open ? `${row.elapsed}일` : '—'}</TableCell>
          {shared && <>
            <TableCell numeric>{row.sharedTransactions}건</TableCell>
            <TableCell numeric>{row.sharedAccounts}개</TableCell>
          </>}
        </TableRow>;
      })}
      {!sorting.rows.length && <TableRow><TableCell colSpan={headings.length + 1}>
        {rows.length ? '결과 없음' : '후보 없음'}
      </TableCell></TableRow>}
    </TableBody>
  </WorkflowTable></>;
}

/**
 * Episode로 묶기·편입·연결 해제 창. 어디서 열었는지에 따라 후보가 다르다.
 * - 목록(row 없음): 묶을 수 있는 내 Alert 전부. initialCodes는 표에서 체크한 행이다.
 * - Alert 상세: 지금 Alert는 고정, 계좌·거래를 공유하는 내 Alert가 후보. initialCodes는 관련 탭 그래프에 넣은 업무다.
 * - Episode 상세: 이 Episode에 편입할, 계좌·거래를 공유하는 내 Alert가 후보.
 * - unlink: Episode에 연결된 Alert에서 해제할 것을 고른다.
 */
export function PreviewEpisodeDialog({ cases, row, save, onClose, unlink = false, initialCodes = [], initialTarget = '', onRelationRequest }) {
  const titleId = useId();
  const mode = unlink ? 'unlink' : row?.kind === 'Episode' ? 'episode' : row?.kind === 'Alert' ? 'alert' : 'list';
  const base = mode === 'alert' ? row : undefined;
  const byCode = useMemo(() => new Map(cases.map(item => [item.code, item])), [cases]);
  const candidates = useMemo(() => {
    if (mode === 'unlink') return cases.filter(item => row.linkedAlertCodes?.includes(item.code));
    if (mode === 'list') return cases.filter(canTransferAlert);
    return previewEpisodeCompanions(cases, row).map(({ item, transactions, accounts }) =>
      ({ ...item, sharedTransactions: transactions.length, sharedAccounts: accounts.length }));
  }, [cases, mode, row]);
  const candidateCodes = useMemo(() => new Set(candidates.map(item => item.code)), [candidates]);
  // 미리 고른 업무 중 묶을 수 없는 Alert와 그 이유. 지금 보는 Alert도 포함한다.
  const blocked = mode === 'unlink' ? [] : [...new Set([base?.code, ...initialCodes].filter(Boolean))]
    .map(code => byCode.get(code)).filter(item => item?.kind === 'Alert' && !candidateCodes.has(item.code) && transferBlockReason(item))
    .map(item => ({ code: item.code, reason: transferBlockReason(item) }));
  const baseBlocked = blocked.some(item => item.code === base?.code);
  const excluded = useMemo(() => {
    if (mode === 'unlink') return [];
    const others = cases.filter(item => item.kind === 'Alert' && item.code !== row?.code && !canTransferAlert(item));
    if (mode === 'list') return transferBlockCounts(others);
    return transferBlockCounts(others.filter(item => {
      const { transactions, accounts } = sharedCaseEvidence(row, item);
      return transactions.length || accounts.length;
    }));
  }, [cases, mode, row]);
  const excludedTotal = excluded.reduce((sum, [, count]) => sum + count, 0);
  const [pickedCodes, setPickedCodes] = useState(() => initialCodes.filter(code => candidateCodes.has(code)));
  const picked = useMemo(() => new Set(pickedCodes), [pickedCodes]);
  const episodes = cases.filter(item => item.kind === 'Episode' && item.open);
  const [method, setMethod] = useState(mode === 'episode' || initialTarget ? 'existing' : 'new');
  const [target, setTarget] = useState(mode === 'episode' ? row.code : initialTarget);
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedNewCode, setConfirmedNewCode] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const selected = base && !baseBlocked ? [base.code, ...pickedCodes] : pickedCodes;
  const creating = mode !== 'unlink' && method === 'new';
  const targetEpisode = mode === 'unlink' || creating ? undefined : episodes.find(item => item.code === target);
  const needsCompanion = creating && selected.length < 2;
  const newEpisodeCode = creating && !needsCompanion ? nextPreviewEpisodeCode(cases, selected[0]) : '';
  const valid = Boolean(!baseBlocked && reason.trim() && selected.length && (mode === 'unlink' || newEpisodeCode || targetEpisode));
  const dissolves = mode === 'unlink' && previewEpisodeWillDissolve(row, selected.length);
  const label = mode === 'unlink' ? 'Alert 연결 해제' : mode === 'episode' ? 'Alert 편입' : 'Episode로 묶기';
  const fixture = currentPreviewUser()?.source === 'fixture';
  const showRequest = onRelationRequest && !requestSent && !result
    && (blocked.some(item => item.reason === '다른 담당자') || Boolean(targetEpisode && !targetEpisode.assigned));
  // 그래프에는 편입할 기존 Episode, 지금 보는 Alert, 고른 Alert 순으로 넣는다.
  const graphRows = [targetEpisode, base && !baseBlocked ? base : undefined, ...pickedCodes.map(code => byCode.get(code))].filter(Boolean);
  const slots = useGroupSlots(graphRows.map(item => item.code));
  const groups = graphRows.map(item => {
    const slot = slots.get(item.code) ?? 0;
    return { id: item.code, transactionIds: new Set(item.related.map(record => record.code)), color: caseGroupColor(slot), shape: caseGroupShape(slot) };
  });
  const connection = bundleConnection(graphRows);

  function changePicks(keys, checked) {
    setPickedCodes(previous => checked
      ? [...previous, ...keys.filter(code => !previous.includes(code))]
      : previous.filter(code => !keys.includes(code)));
  }

  // 서버 저장은 응답을 기다린다. 프리뷰 저장은 바로 끝난다.
  async function submit(event) {
    event.preventDefault();
    if (!valid || result) return;
    if (!confirmed) {
      setConfirmedNewCode(newEpisodeCode);
      setConfirmed(true);
      return;
    }
    const response = await save({ alertCodes: selected, episodeCode: mode === 'unlink' ? row.code : creating ? '' : target,
      expectedNewCode: confirmedNewCode, reason, unlink: mode === 'unlink' });
    if (response.ok) setResult(response.code);
    else setError(response.error);
  }

  return <DialogFrame ref={node => {
    if (node && !node.open) node.showModal();
  }} className={`case-judgment-dialog${result || confirmed ? '' : ' episode-bundle-dialog'}`} titleId={titleId}
    closeLabel="Episode 편집 창 닫기" title={label}
    onClose={() => onClose(Boolean(result))} onSubmit={submit}
    actions={(!result || mode !== 'unlink') && <>
      {showRequest && <ActionButton shape="pill" surface="floating"
        onClick={() => onRelationRequest(reason.trim().slice(0, 2000), () => setRequestSent(true))}>관리자에게 요청 보내기</ActionButton>}
      {confirmed && !result && <ActionButton shape="pill" surface="floating"
        onClick={() => { setConfirmed(false); setError(''); }}>내용 수정</ActionButton>}
      {!result && <PrimaryButton type="submit" tone="brand" disabled={!valid}>{confirmed ? label : '내용 확인'}</PrimaryButton>}
      {result && mode !== 'unlink' && <PrimaryButton as="a" href={`/episodes/${result}?tab=related${location.search.includes('data=sample') ? '&data=sample' : ''}`}>Episode 열기</PrimaryButton>}
    </>}>
    {result || confirmed ? <Box className="case-judgment-body">
      {result ? <Text role="status">{dissolves ? 'Episode 해체 완료' : mode === 'unlink' ? '연결 해제 완료' : creating ? '새 Episode 생성 완료' : 'Episode 편입 완료'} <Text as="code">{result}</Text></Text>
        : <Box className="case-judgment-summary">
          <Text className="episode-bundle-target">{dissolves ? 'Episode 해체(남는 Alert 2건 미만)' : mode === 'unlink' ? '연결 해제'
            : <><ArrowRight className="icon" aria-label="편입" />{creating && '새 Episode'}<Text as="code">{creating ? confirmedNewCode : target}</Text></>}</Text>
          <Box as="ul">{selected.map(code => <Box as="li" key={code}><Text as="code">{code}</Text></Box>)}</Box>
          <Text>{reason.trim()}</Text>
        </Box>}
      {error && <Text role="alert">{error}</Text>}
    </Box> : <Box className="episode-bundle-body">
      <Box className="episode-bundle-picker">
        {mode === 'episode' ? <Text className="episode-bundle-target"><ArrowRight className="icon" aria-label="대상" /><Text as="code">{row.code}</Text></Text>
          : mode !== 'unlink' && <QueryRadio label="편입 방식" items={methodItems} value={method} onChange={setMethod} />}
        {mode !== 'unlink' && (creating
          ? needsCompanion ? <Text role="status" className="case-judgment-note">2건 이상 선택</Text>
            : <Text className="episode-bundle-target"><ArrowRight className="icon" aria-label="생성 예정" /><Text as="code">{newEpisodeCode}</Text></Text>
          : <Box className="case-judgment-field">
            {mode !== 'episode' && <>
              <Text as="span">대상 Episode</Text>
              <GlideSelect fullWidth ariaLabel="대상 Episode" placeholder="선택"
                value={target} onChange={setTarget} options={episodes.map(item => item.code)} disabled={!episodes.length} />
              {!episodes.length && <Text className="case-judgment-note">진행 중 Episode 없음</Text>}
            </>}
            {targetEpisode && <Text>소속 <EpisodeAlertSummary codes={targetEpisode.linkedAlertCodes}
              complete={targetEpisode.linkedAlertCodesComplete} /></Text>}
          </Box>)}
        {blocked.length > 0 && <Callout className="case-judgment-bundle-notice">
          <Text as="strong" className="episode-bundle-target"><Ban className="icon" aria-hidden="true" />묶기 불가</Text>
          {blocked.map(item => <Text key={item.code} className="episode-bundle-target"><Text as="code">{item.code}</Text><StatusTag preset="neutral">{item.reason}</StatusTag></Text>)}
        </Callout>}
        <Box className="episode-bundle-candidates">
          <CandidateTable rows={candidates} shared={mode === 'alert' || mode === 'episode'} picked={picked} slots={slots}
            onChange={changePicks} query={query} onQuery={setQuery} total={candidates.length} />
        </Box>
        <Box className="episode-bundle-chips" aria-label="고른 Alert">
          <CountTag label={mode === 'unlink' ? '해제' : '선택'} count={selected.length} />
          {base && !baseBlocked && <CodeChip code={base.code} slot={slots.get(base.code)} note="기준" />}
          {pickedCodes.map(code => <CodeChip key={code} code={code} slot={slots.get(code)} />)}
        </Box>
        {excludedTotal > 0 && <Box className="episode-bundle-chips" aria-label="후보에서 빠진 Alert">
          <CountTag label="제외" count={excludedTotal} />
          {excluded.map(([text, count]) => <StatusTag key={text} preset="neutral">{text} {number.format(count)}</StatusTag>)}
        </Box>}
        <Box as="label" className="case-judgment-field">변경 사유
          <Textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} />
        </Box>
        {fixture && <Text className="case-judgment-note">이 탭에만 저장</Text>}
        {error && <Text role="alert">{error}</Text>}
        {requestSent && <Text role="status">요청 보냄</Text>}
      </Box>
      <Box className="episode-bundle-preview">
        <Box className="episode-bundle-connection" role="status">
          <Text as="strong">연결</Text>
          {graphRows.length < 2 ? <Text className="case-judgment-note">2건 이상 선택</Text> : <>
            <Box className="episode-bundle-chips">
              <CountTag label="공유 계좌" count={connection.accounts.length} unit="개" />
              <CountTag label="공유 거래" count={connection.transactions.length} />
            </Box>
            {connection.isolated.length > 0 && <Text className="episode-bundle-warning">
              <TriangleAlert className="icon" aria-hidden="true" />
              {connection.isolated.map(code => <Text as="code" key={code}>{code}</Text>)} 연결 없음
            </Text>}
          </>}
        </Box>
        <Suspense fallback={<Text className="preview-evidence-loading">불러오는 중</Text>}>
          <EpisodeBundleGraph rows={graphRows} groups={groups} />
        </Suspense>
      </Box>
    </Box>}
  </DialogFrame>;
}
