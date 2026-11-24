import React from 'react';
import { Clock } from 'lucide-react';
import { CardHeader } from '../../components/card-header';
import { Panel } from '../../components/panel';
import { ActionButton } from '../../components/primary-button';
import { RecordCard } from '../../components/record-card';
import MagicBento from '../../components/react-bits/MagicBento';
import { CaseActorTag, CountTag, ModelScoreTag, PatternTag, ReviewStatusTag, reviewStates, StatusTag, VerdictTag } from '../../components/semantic-tags';
import { readWorkspaceGap } from '../dashboard/workspace-metrics';
import './preview-case-card.css';
import { Box, Heading, Text } from '../../components/layout-primitives';

const amount = new Intl.NumberFormat('ko-KR');
const formatDate = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
const formatCompletionTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium',
});

function TransactionPeriod({ related }) {
  const dates = related.map(transaction => transaction.date?.getTime()).filter(Number.isFinite);
  if (!dates.length) return '—';
  const start = formatDate.format(Math.min(...dates));
  const end = formatDate.format(Math.max(...dates));
  return <><Text as="time" dateTime={start}>{start}</Text>{start !== end && <> ~ <Text as="time" dateTime={end}>{end}</Text></>}</>;
}

function CaseCompletionTag({ completedAt }) {
  const instant = Date.parse(completedAt);
  if (!Number.isFinite(instant)) return null;
  const kst = formatCompletionTime.format(instant);
  const label = `처리 완료 ${kst} KST`;
  return <StatusTag preset="neutral" className="case-completion-tag">
    <Clock aria-hidden="true" />
    <Text as="time" dateTime={completedAt} title={label} aria-label={label}>{kst.slice(5, 16)}</Text>
  </StatusTag>;
}

function Field({ label, children }) {
  return <Box><Box as="dt">{label}</Box><Box as="dd">{children}</Box></Box>;
}

function EmptyState({ children, announce = false }) {
  return <Text className="case-progress-empty" role={announce ? 'status' : undefined}>{children}</Text>;
}

export function CaseProgressLanes({ renderLane, notice }) {
  return <Box className="case-progress-board">
    {notice}
    <Box className="case-progress-lanes" style={{ '--case-progress-columns': reviewStates.length }}>
      {reviewStates.map(renderLane)}
    </Box>
  </Box>;
}

export function CaseProgressBoard({ rows, reduced, theme, orderRows, showAssignee = true, pageSize }) {
  const [limits, setLimits] = React.useState({});
  const isEmpty = rows.length === 0;
  return <CaseProgressLanes
    notice={isEmpty && <EmptyState announce>조회 조건에 해당하는 업무가 없습니다.</EmptyState>}
    renderLane={({ label, preset, value }) => {
        const matching = rows.filter(row => row.status === value);
        const cards = orderRows ? orderRows(matching) : matching;
        const limit = limits[preset] ?? pageSize ?? cards.length;
        return <Panel className="case-progress-lane" data-review={preset} key={preset} aria-label={label}>
          <Heading className="case-progress-heading">
            <StatusTag preset={preset}>{label}</StatusTag>
            <CountTag count={Math.min(limit, cards.length)} total={cards.length} />
          </Heading>
          {cards.length > 0 ? <MagicBento key={reduced} className="case-progress-cards preview-tilt-cards"
            items={cards.slice(0, limit).map(row => ({ id: row.code, content: <PreviewCaseCard
              row={row} showReviewStatus={false} showAssignee={showAssignee} /> }))}
            columns={1} rowHeight={0} gap={readWorkspaceGap()} theme={theme}
            disableAnimations={reduced} intro={false} textAutoHide={false}
            enableBorderGlow={false} enableSpotlight={false} enableStars={false} clickEffect={false} />
            : !isEmpty && <EmptyState>이 상태의 업무가 없습니다.</EmptyState>}
          {limit < cards.length && <ActionButton shape="pill" aria-label={`${label} 업무 더 보기`}
            onClick={() => setLimits(previous => ({ ...previous, [preset]: limit + pageSize }))}>더 보기</ActionButton>}
        </Panel>;
    }} />;
}

export function EpisodeAlertSummary({ codes, complete = Boolean(codes) }) {
  if (!complete && !codes?.length) return <Text as="span">샘플에 소속 Alert 정보 없음</Text>;
  if (!codes.length) return <Text as="span">소속 Alert 0건</Text>;
  return <Text as="span" className="semantic-tag-group">
    <Text as="span">{complete ? `${codes.length}건` : `추가 연결 ${codes.length}건 · 기존 소속 정보 없음`}</Text>
    {codes.map(code => <Text as="code" key={code}>{code}</Text>)}
  </Text>;
}

export function PreviewCaseCard({ row, selectedTransaction, className = '', selection, showAdd = true, sharedEvidence, drag,
  showReviewStatus = true, showAssignee = true }) {
  const { code, kind, score, status, pattern, assigned, elapsed, open, related } = row;
  const isEpisode = kind === 'Episode';
  const transaction = selectedTransaction ?? related[0];
  const source = transaction?.from?.code ?? transaction?.account;
  const destination = transaction?.to?.code ?? transaction?.counterparty;
  const flow = source && destination
    ? <><Text as="code">{source}</Text> → <Text as="code">{destination}</Text>
      {!selectedTransaction && related.length > 1 ? ` 외 ${related.length - 1}` : ''}</>
    : '—';
  const totals = Object.entries(row.amountByCurrency ?? {})
    .map(([currency, value]) => `${amount.format(value)} ${currency}`);
  const verdict = row.verdict;
  return <RecordCard className={`case-glow preview-case-card ${className}`} label={code}
    selected={selection?.checked} verdict={verdict} drag={drag} opensRecord>
    <CardHeader code={code} selection={selection} showAdd={showAdd} draggableCard={Boolean(drag)} />
    <Box className="preview-case-card-body">
      <Box className="semantic-tag-group">
        <VerdictTag verdict={verdict} />
        {open && elapsed >= 3 && <StatusTag preset={elapsed > 7 ? 'elapsedOver1w' : 'elapsedUnder1w'}>{elapsed}일 경과</StatusTag>}
        {showReviewStatus && <ReviewStatusTag status={status} />}
        <ModelScoreTag score={score} />
        {showAssignee && <CaseActorTag>{assigned ? '내 담당' : '다른 담당자'}</CaseActorTag>}
        {status === '처리 완료' && <CaseCompletionTag completedAt={row.completedAt} />}
      </Box>
      <Box as="dl">
        {sharedEvidence && <Field label="공통 근거">거래 {sharedEvidence.transactions}건 · 계좌 {sharedEvidence.accounts}개</Field>}
        <Field label="패턴"><PatternTag emphasis="solid">{pattern}</PatternTag></Field>
        <Field label="계좌 흐름">{flow}</Field>
        <Field label="거래 기간"><TransactionPeriod related={related} /></Field>
        <Field label="거래 건수">{related.length}건</Field>
        <Field label="거래 금액">{totals.join(' · ') || '—'}</Field>
        {isEpisode && (sharedEvidence
          ? <Field label="소속 Alert"><EpisodeAlertSummary codes={row.linkedAlertCodes} complete={row.linkedAlertCodesComplete} /></Field>
          : <Field label="Alert 건수">{row.linkedAlerts}건</Field>)}
        {isEpisode && <Field label="관련 계좌">{row.relatedAccounts}개</Field>}
      </Box>
    </Box>
  </RecordCard>;
}
