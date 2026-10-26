import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Modal, Radio, Space, Spin, Table, Tabs, Tag, Typography } from 'antd'
import { fetchReviewCase, fetchReviewCases, submitReviewCommand, type ReviewCommand, type ReviewCase, type ReviewApiMember as ReviewMember } from '@/api/liveReview'
import { fetchLedgerTransactions, type LedgerTransaction } from '@/api/liveLedger'
import { buildAlertClose, wholeAlertSelection } from '@/api/reviewCommands'
import { canEditOpen, useCurrentUser } from '@/app/session'
import { TooltipProvider } from '@/components/ui/tooltip'
import { caseEvidence } from '@/features/alerts/caseEvidence'
import { toReviewGraphModel } from '@/features/graph/liveAdapter'
import { useAsync } from '@/lib/useAsync'
import { useViewState, useWorkspace } from '@/lib/workspaceState'
import { isWiringEmbed } from '@/lib/wiringBridge'
const Graph = lazy(() => import('@/features/graph/v24/Graph'))
const { Text, Title } = Typography
const stamp = (at: string) => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
const stateName: Record<string, string> = { PENDING: '미판정', DECIDED: '판정됨', EXCLUDED: '조사 제외', TRANSFERRED: '이관됨' }

export function AntInvestigation({ caseId, onOpen, onBack, refreshList, onOpenLedger }: { caseId: number; onOpen: (id: number) => void; onBack: () => void; refreshList: () => Promise<unknown>; onOpenLedger?: (id: number) => void }) {
  const detail = useAsync(() => fetchReviewCase(caseId), [caseId], { key: 'ant/case' })
  if (detail.state.status === 'loading') return <Spin aria-label="사건 조회 중" />
  if (detail.state.status === 'error') return <Alert type="error" title="사건을 조회하지 못했습니다." description={detail.state.message} action={<Button onClick={detail.retry}>다시 조회</Button>} />
  return <InvestigationBody key={caseId} item={detail.state.data} onOpen={onOpen} onBack={onBack} onOpenLedger={onOpenLedger} refresh={async () => { await detail.refresh(); await refreshList() }} />
}

function InvestigationBody({ item, onOpen, onBack, refresh, onOpenLedger }: { item: ReviewCase; onOpen: (id: number) => void; onBack: () => void; refresh: () => Promise<void>; onOpenLedger?: (id: number) => void }) {
  const user = useCurrentUser()
  const workspace = useWorkspace()
  const graphModel = useMemo(() => toReviewGraphModel(item), [item])
  const [tab, setTab] = useViewState(`ant/${item.caseId}/tab`, 'overview')
  const [comment, setComment] = useViewState(`case/${item.kind}/${item.caseId}/comment`, '')
  const [known, setKnown] = useViewState<Record<number, LedgerTransaction>>(`ant/${item.caseId}/verified-transactions`, {})
  const [decision, setDecision] = useState<'NORMAL' | 'SUSPICIOUS' | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [txId, setTxId] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [confirm, setConfirm] = useState(false)
  const evidence = caseEvidence(item.groups ?? [])
  const code = item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`
  const editable = canEditOpen(user, item.assigneeId, item.status) && (item.kind !== 'ALERT' || item.episodeId == null)
  const subject = evidence.members.filter(member => member.reviewRole === 'SUBJECT')
  useEffect(() => {
    if (!isWiringEmbed()) return
    const focus = (event: Event) => {
      const id = (event as CustomEvent).detail
      if (id === 'case.graph') setTab('graph')
      else if (id === 'case.review') { setNotesOpen(false); setTab('review') }
      else if (id === 'case.transaction.detail') setTxId(evidence.members[0]?.txId ?? null)
      else if (typeof id === 'string' && id.startsWith('case.')) setTab('overview')
    }
    window.addEventListener('aml-wiring-focus', focus)
    return () => window.removeEventListener('aml-wiring-focus', focus)
  }, [item.caseId, evidence.members, setTab])
  const ledger = useAsync(async () => {
    for (let page = 0; ; page++) {
      const result = await fetchLedgerTransactions({ query: String(txId), page, size: 20 })
      const found = result.content.find(row => row.txId === txId)
      if (found) {
        const original = evidence.members.find(member => member.txId === txId)?.transaction
        if (original && (original.fromAccountId !== found.fromAccountId || original.toAccountId !== found.toAccountId)) throw new Error('사건과 거래 내역의 양쪽 계좌가 다릅니다. 동일 거래인지 확인이 필요합니다.')
        return found
      }
      if (!result.content.length || page + 1 >= result.totalPages) throw new Error('정확히 일치하는 거래를 찾지 못했습니다.')
    }
  }, [txId], { key: `ant/${item.caseId}/transaction`, enabled: txId != null })
  const ownerName = (account: string, id: number, side: 'from' | 'to') => item.accounts?.find(row => row.id === account)?.ownerName ?? known[id]?.[side === 'from' ? 'fromOwnerName' : 'toOwnerName'] ?? '소유주 미제공'
  async function openSource(alertId: number) {
    try {
      const result = await fetchReviewCases({ kind: 'ALERT', query: String(alertId), size: 100 })
      const found = result.content.find(row => row.alertId === alertId)
      if (!found) throw new Error('원본 Alert 조회 식별자를 확인하지 못했습니다.')
      onOpen(found.caseId)
    } catch (e) { setError(e instanceof Error ? e.message : '연결을 확인하지 못했습니다.') }
  }
  async function send(action: 'COMMENT' | 'DECIDE' | 'CLOSE') {
    if (pending.current || !editable || !comment.trim() || comment.trim().length > 4000) return
    if (action !== 'COMMENT' && !decision && !(item.kind === 'EPISODE' && action === 'CLOSE')) return
    if (action !== 'COMMENT' && !subject.length) return
    const selections = (item.groups ?? []).map(group => ({ caseId: item.caseId, revision: item.revision, groupId: group.groupId,
      txIds: group.members.filter(member => selected.includes(member.txId) && member.reviewRole === 'SUBJECT' && member.state === 'PENDING').map(member => member.txId) })).filter(group => group.txIds.length)
    if (item.kind === 'EPISODE' && action === 'DECIDE' && !selections.length) return
    const command: ReviewCommand = action === 'COMMENT' ? { action, comment: comment.trim(), selections: [wholeAlertSelection(item)] }
      : item.kind === 'ALERT' ? buildAlertClose(item, decision!, comment)
      : { action, comment: comment.trim(), decision: action === 'DECIDE' ? decision : null, selections: action === 'DECIDE' ? selections : (item.groups ?? []).map(group => ({ caseId: item.caseId, revision: item.revision, groupId: group.groupId, txIds: [] })) }
    const submitted = comment
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await submitReviewCommand(command, crypto.randomUUID())
      setNotice('요청은 처리됐습니다. 최신 기록을 확인하고 있습니다.')
      try { await refresh(); setNotice('최신 사건과 이력을 다시 조회했습니다.'); if (workspace.get(`case/${item.kind}/${item.caseId}/comment`, '') === submitted) setComment('') }
      catch { setError('저장 응답은 받았지만 최신 결과 조회에 실패했습니다. 자동 재전송하지 않습니다.'); setNotice('') }
    } catch (e) { setError(e instanceof Error ? e.message : '처리 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.') }
    finally { pending.current = false; setBusy(false) }
  }
  const notes = <Form layout="vertical"><Form.Item label="조사 의견"><Input.TextArea aria-label="조사 의견" value={comment} onChange={event => setComment(event.target.value)} maxLength={4000} autoSize={{ minRows: 5, maxRows: 12 }} disabled={busy} /></Form.Item>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Text type="secondary">의견만 저장하면 최종 판정이나 종결을 바꾸지 않습니다. 미저장 의견은 화면 이동 중 유지되지만 새로고침하면 사라집니다.</Text>
      {!editable && <Alert type="info" title="현재 사건은 읽기 전용입니다." description="본인 담당의 진행 중 사건만 처리할 수 있습니다. 편입 원본은 연결 Episode에서 확인하세요." />}
      <Button onClick={() => void send('COMMENT')} loading={busy} disabled={!editable || busy || !comment.trim()}>의견만 저장</Button>
      <Form.Item label="최종 판단 — 직접 선택"><Radio.Group value={decision} onChange={event => setDecision(event.target.value)} disabled={busy || !editable} options={[{ value: 'NORMAL', label: '정상으로 종결' }, { value: 'SUSPICIOUS', label: '단독 의심으로 종결' }]} /></Form.Item>
      <Text type="secondary">{item.kind === 'EPISODE' ? 'Episode는 거래 표에서 미판정 조사 대상을 선택하고 의견·판정을 입력해야 범위 판정할 수 있습니다. 전체 종결은 모든 대상의 판정 후 가능합니다.' : '종결에는 조사 대상 거래·의견·명시적 판단 선택이 필요합니다.'}</Text>
      <Button danger disabled={!editable || busy || !comment.trim() || !decision || !subject.length || (item.kind === 'EPISODE' && !selected.length)} onClick={() => setConfirm(true)}>{item.kind === 'ALERT' ? '최종 종결 확인' : '선택 거래 판정 확인'}</Button>
      {item.kind === 'EPISODE' && <Button disabled={!editable || busy || !comment.trim() || !subject.length || subject.some(row => row.state === 'PENDING')} onClick={() => void send('CLOSE')}>기존 판정으로 Episode 종결 요청</Button>}
    </Space></Form>
  const table = <Table<ReviewMember> data-wiring-id="case.overview.evidence" rowKey="txId" dataSource={evidence.members} scroll={{ x: 950 }} pagination={{ pageSize: 10, showSizeChanger: false }} rowSelection={item.kind === 'EPISODE' ? { selectedRowKeys: selected, onChange: keys => setSelected(keys as number[]), getCheckboxProps: member => ({ disabled: !editable || busy || member.reviewRole !== 'SUBJECT' || member.state !== 'PENDING' }) } : undefined} columns={[
    { title: '거래', key: 'tx', render: (_, member) => <Button type="link" onClick={() => setTxId(member.txId)}>T-{member.txId} 원거래 확인</Button> },
    { title: '거래 시각', render: (_, member) => stamp(member.transaction.occurredAt) },
    { title: '금액·통화', render: (_, member) => `${Number(member.transaction.amountPaid ?? 0).toLocaleString('ko-KR')} ${member.transaction.paymentCurrency}` },
    { title: '송금 소유주 / 계좌', render: (_, member) => <>{ownerName(member.transaction.fromAccountId, member.txId, 'from')}<br /><Text code>{member.transaction.fromAccountId}</Text></> },
    { title: '수취 소유주 / 계좌', render: (_, member) => <>{ownerName(member.transaction.toAccountId, member.txId, 'to')}<br /><Text code>{member.transaction.toAccountId}</Text></> },
    { title: '조사 역할·상태', render: (_, member) => `${member.reviewRole === 'SUBJECT' ? '판정 대상' : '참고 거래'} · ${stateName[member.state]}` },
  ]} locale={{ emptyText: '현재 소속 근거 거래가 없습니다.' }} />
  return <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
    <Space wrap><Button onClick={onBack}>조사 출발점으로 돌아가기</Button><Title level={3} style={{ margin: 0 }}>{code}</Title><Tag>{item.kind === 'ALERT' ? '단일 탐지 조사' : '묶음 조사'}</Tag><Tag data-wiring-id="case.header.status">{item.status === 'OPEN' ? '진행 중' : '종결'}</Tag><Text data-wiring-id="case.header.assignee">담당 {item.assigneeName}</Text><Button onClick={() => setNotesOpen(true)}>조사하며 의견 작성</Button></Space>
    {error && <Alert type="error" title={error} />}{notice && <Alert type="info" title={notice} />}
    {item.episodeId != null && <Alert type="info" title={`이 Alert는 E-${item.episodeId}에 편입된 원본입니다.`} action={<Button onClick={() => onOpen(item.episodeId!)}>연결 Episode 조사</Button>} />}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'overview', label: '개요', children: <Space orientation="vertical" style={{ width: '100%' }}><Descriptions data-wiring-id="case.overview.judgment" bordered column={{ xs: 1, md: 3 }} items={[
        { key: 'risk', label: '이진 의심 점수', children: <Text data-wiring-id="case.header.risk">{item.summary.riskScore}</Text> }, { key: 'type', label: '대표 유형', children: item.summary.primaryType }, { key: 'age', label: '경과', children: `${item.ageDays}일` },
        { key: 'subject', label: '조사 대상', children: `${item.summary.subjectCount}건 · 판정 대상` }, { key: 'evidence', label: '현재 소속 근거 거래', children: `${evidence.members.length}건 · 판정 대상과 참고 거래` }, { key: 'seed', label: '씨앗 거래', children: `${item.summary.seedCount}건` },
      ]} /><Alert data-wiring-id="case.overview.model" type="info" title="유형 패턴 없음은 정상 판정이 아닙니다." description="이진 의심 점수·유형 확률·보조 룰·사람의 판정은 다릅니다. 룰 적중 결과와 실행 ID/모델 버전은 이 사건 응답으로 확인할 수 없습니다. 합성 모델 값이며 실제 AI 검증 결과가 아닙니다." />
        {item.kind === 'EPISODE' && <Card data-wiring-id="case.overview.connections.list" title="원본 Alert와 묶음의 타당성"><Space orientation="vertical">{(item.groups ?? []).map(group => <div key={group.groupId}><Button type="link" onClick={() => void openSource(group.sourceAlertId!)}>A-{group.sourceAlertId} 원본 조사</Button>거래 {group.members.length}건 · {group.members.every(row => row.state === 'DECIDED') ? '판정됨' : '미판정 포함'}</div>)}<Text>아래 기록의 실제 편입 사유와 공유 계좌/소유주를 대조하세요. 분리된 그래프를 임의의 연결 근거나 자동 묶음으로 해석하지 않습니다.</Text></Space></Card>}
        <Card title="근거 거래 — 거래 ID로 직접 확인">{table}</Card><Card data-wiring-id="case.overview.progress.history" title="조사 이력">{item.history?.length ? item.history.map(event => <p key={event.eventId}><Text>{stamp(event.businessAt)} · {event.action === 'COMMENT' ? '의견' : event.action === 'TRANSFER' ? '편입' : event.action === 'ASSIGN' ? '배정' : '처리 기록'}</Text><br />{event.comment}</p>) : <Empty description="제공된 조사 이력이 없습니다." />}</Card></Space> },
      { key: 'graph', label: '그래프', children: <Card data-wiring-id="case.graph" title="계좌·소유주 관계와 자금 흐름"><Alert type="info" title="조회된 사건 범위의 거래 관계입니다. GNN의 판단 이유나 사건 밖 간접 경로를 뜻하지 않습니다." /><Suspense fallback={<Spin aria-label="그래프 준비 중" />}><TooltipProvider><Graph model={graphModel} label={code} nonSuspiciousLabel="이진 모델 비의심 또는 미분석" panelExtra={focus => <Space wrap>{evidence.members.filter(member => focus.kind === 'node' ? [member.transaction.fromAccountId, member.transaction.toAccountId].includes(focus.key) : [member.transaction.fromAccountId, member.transaction.toAccountId].includes(focus.s) && [member.transaction.fromAccountId, member.transaction.toAccountId].includes(focus.t)).map(member => <Button key={member.txId} onClick={() => setTxId(member.txId)}>T-{member.txId} 원거래 확인</Button>)}</Space>} /></TooltipProvider></Suspense></Card> },
      { key: 'transactions', label: '거래', children: table }, { key: 'review', label: '의견과 판단', children: <Card data-wiring-id="case.review" title="의견 기록과 명시적 판단">{notes}</Card> },
    ]} />
    <Drawer closable={{ 'aria-label': '닫기' }} title="조사 중 의견 — 배치 검수 제안" open={notesOpen} onClose={() => setNotesOpen(false)} size="large" destroyOnHidden>{notesOpen && notes}</Drawer>
    <Drawer closable={{ 'aria-label': '닫기' }} title={txId == null ? '거래 상세' : `T-${txId} 거래 상세`} open={txId != null} size="large" onClose={() => setTxId(null)} destroyOnHidden>
      <Text>조사 출발점 {code} · T-{txId}</Text>
      {ledger.state.status === 'loading' ? <Spin aria-label="정확한 거래 조회 중" /> : ledger.state.status === 'error' ? <Alert type="error" title={ledger.state.message} action={<Button onClick={ledger.retry}>다시 조회</Button>} /> : <><Descriptions data-wiring-id="case.transaction.detail" bordered column={1} items={[
        { key: 'id', label: '거래 ID', children: `T-${ledger.state.data.txId}` }, { key: 'from', label: '송금 소유주', children: ledger.state.data.fromOwnerName ?? '미제공' }, { key: 'to', label: '수취 소유주', children: ledger.state.data.toOwnerName ?? '미제공' },
        { key: 'accounts', label: '송금 → 수취 계좌', children: `${ledger.state.data.fromAccountId} → ${ledger.state.data.toAccountId}` }, { key: 'at', label: '거래 시각', children: stamp(ledger.state.data.occurredAt) }, { key: 'amount', label: '송금액', children: `${ledger.state.data.amountPaid.toLocaleString('ko-KR')} ${ledger.state.data.paymentCurrency}` },
      ]} />{onOpenLedger && <Button onClick={() => { if (txId != null) onOpenLedger(txId) }}>거래 내역에서 조사 범위 넓히기</Button>}<Button onClick={() => { const row = ledger.state.status === 'success' ? ledger.state.data : null; if (row) setKnown(previous => ({ ...previous, [row.txId]: row })); setTxId(null) }}>사건 조사로 돌아가기</Button></>}
    </Drawer>
    <Modal title={item.kind === 'ALERT' ? '최종 종결 확인' : '선택 거래 판정 확인'} open={confirm} onCancel={() => setConfirm(false)} onOk={() => { setConfirm(false); void send(item.kind === 'ALERT' ? 'CLOSE' : 'DECIDE') }} okText="판단 요청" cancelText="취소"><p>{code} · {item.kind === 'ALERT' ? `현재 판정 대상 전체 ${subject.length}건` : `선택 ${selected.length}건`}에 {decision === 'NORMAL' ? '정상' : '의심'} 판정을 요청합니다. 합성 검수에서는 실제 저장이 차단됩니다.</p></Modal>
  </Space>
}
