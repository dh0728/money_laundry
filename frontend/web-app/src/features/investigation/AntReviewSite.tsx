import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { Alert, Breadcrumb, Button, Card, ConfigProvider, Descriptions, Input, Layout, Result, Select, Space, Spin, Statistic, Table, Tag, Tooltip, Typography, theme } from 'antd'
import koKR from 'antd/locale/ko_KR'
import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import { ArrowLeftRight, Bell, CircleUser, FolderSearch, LayoutDashboard, ListChecks, Moon, Settings, Siren, Sun } from 'lucide-react'
import { restoreSession } from '@/api/auth'
import { fetchReviewCases, type ReviewCase, type ReviewKind } from '@/api/liveReview'
import { fetchLedgerTransactions, type LedgerTransaction } from '@/api/liveLedger'
import { fetchNotifications, setNotificationsRead } from '@/api/notifications'
import { fixture } from '@/lib/apiMode'
import { isWiringEmbed } from '@/lib/wiringBridge'
import { useAsync } from '@/lib/useAsync'
import { useViewState, useWorkspace } from '@/lib/workspaceState'
import { WorkspaceProvider } from '@/lib/WorkspaceProvider'
import { CurrentUserContext, MOCK_USER, useCurrentUser } from '@/app/session'
import { AntInvestigation } from './AntInvestigation'
dayjs.locale('ko')
const { Text, Title } = Typography
const menus = [
  { key: 'dashboard', label: '대시보드', icon: LayoutDashboard }, { key: 'alerts', label: 'Alert 목록', icon: Siren },
  { key: 'episodes', label: 'Episode 목록', icon: FolderSearch }, { key: 'transactions', label: '거래 내역', icon: ArrowLeftRight },
  { key: 'notifications', label: '알림', icon: Bell }, { key: 'rules', label: '룰엔진', icon: ListChecks },
  { key: 'settings', label: '설정', icon: Settings }, { key: 'account', label: '계정', icon: CircleUser },
]
const subscribe = (listener: () => void) => { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }
const snapshot = () => window.location.hash || '#dashboard'
async function allCases(kind: ReviewKind) {
  const rows: ReviewCase[] = []
  for (let page = 0; ; page++) {
    const result = await fetchReviewCases({ kind, page, size: 20 })
    rows.push(...result.content)
    if (!result.content.length || page + 1 >= result.totalPages) return rows
  }
}
async function allTransactions() {
  const rows: LedgerTransaction[] = []
  for (let page = 0; ; page++) {
    const result = await fetchLedgerTransactions({ page, size: 20 })
    rows.push(...result.content)
    if (!result.content.length || page + 1 >= result.totalPages) return rows
  }
}
export function AntReviewSite() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    if (!isWiringEmbed()) return
    const sync = (event: Event) => { const next = (event as CustomEvent).detail; if (next === 'light' || next === 'dark') setDark(next === 'dark') }
    window.addEventListener('aml-wiring-theme-set', sync)
    return () => window.removeEventListener('aml-wiring-theme-set', sync)
  }, [])
  useLayoutEffect(() => { document.documentElement.classList.toggle('dark', dark); document.documentElement.style.colorScheme = dark ? 'dark' : 'light' }, [dark])
  if (!fixture) return <Result status="403" title="합성 검수 전용 화면입니다." subTitle="VITE_API_MODE=fixture로 로컬 개발 서버에서만 실행할 수 있습니다. 실제 API에는 연결하지 않습니다." />
  return <ConfigProvider locale={koKR} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><WorkspaceProvider><ReviewShell dark={dark} setDark={setDark} /></WorkspaceProvider></ConfigProvider>
}
function ReviewShell({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  const route = useSyncExternalStore(subscribe, snapshot)
  const workspace = useWorkspace()
  const [page, rawId] = route.slice(1).split('/')
  const [history, setHistory] = useViewState<string[]>('ant/navigation', [])
  const [search, setSearch] = useState('')
  const [notificationSearch, setNotificationSearch] = useState('')
  const session = useAsync(restoreSession, [], { key: 'ant/session' })
  const data = useAsync(async () => ({ alerts: await allCases('ALERT'), episodes: await allCases('EPISODE'), transactions: await allTransactions() }), [], { key: 'ant/data' })
  const notifications = useAsync(() => fetchNotifications('', '', '', 0), [], { key: 'notifications/ant' })
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (data.state.status === 'success' && [...data.state.data.alerts, ...data.state.data.episodes].some(item => workspace.get(`case/${item.kind}/${item.caseId}/comment`, '').trim())) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [data.state, workspace])
  const title = menus.find(item => item.key === page)?.label ?? '대시보드'
  const [feedback, setFeedback] = useState('')
  const current = data.state.status === 'success' ? [...data.state.data.alerts, ...data.state.data.episodes].find(item => item.caseId === Number(rawId)) : undefined
  function navigate(next: string) { if (next === route) return; setHistory(previous => [...previous.slice(-29), route]); window.location.hash = next }
  function open(id: number) {
    const found = data.state.status === 'success' ? [...data.state.data.alerts, ...data.state.data.episodes].find(item => item.caseId === id) : undefined
    if (found) navigate(`#${found.kind === 'ALERT' ? 'alerts' : 'episodes'}/${id}`)
    else setFeedback('조회된 사건 목록에서 해당 ID를 확인하지 못했습니다.')
  }
  function back() { const previous = history.at(-1); setHistory(history.slice(0, -1)); window.location.hash = previous ?? '#dashboard' }
  const { token } = theme.useToken()
  if (session.state.status === 'loading') return <Spin aria-label="검수 계정 조회 중" />
  if (session.state.status === 'error') return <Result status="warning" title="검수 계정을 확인하지 못했습니다." subTitle={session.state.message} extra={<Button onClick={session.retry}>다시 조회</Button>} />
  const user = session.state.data
  const body = data.state.status === 'loading' ? <Spin aria-label="업무 데이터 조회 중" /> : data.state.status === 'error' ? <Alert type="error" title="업무 데이터 조회 실패" description={data.state.message} action={<Button onClick={data.retry}>다시 조회</Button>} /> : (() => {
    const { alerts, episodes, transactions } = data.state.data
    if (rawId && (page === 'alerts' || page === 'episodes')) return current ? <AntInvestigation caseId={current.caseId} onOpen={open} onBack={back} refreshList={data.refresh} onOpenLedger={id => navigate(`#transactions/${id}`)} /> : <Result status="404" title="조회된 목록에서 사건을 찾지 못했습니다." extra={<Button onClick={back}>출발점으로</Button>} />
    if (page === 'alerts' || page === 'episodes') return <CaseQueue kind={page === 'alerts' ? 'ALERT' : 'EPISODE'} rows={page === 'alerts' ? alerts : episodes} open={open} />
    if (page === 'transactions') return <Ledger key={rawId ?? 'all'} initialTxId={Number(rawId) || null} rows={transactions} cases={[...alerts, ...episodes]} open={open} back={back} />
    if (page === 'notifications') return <Space orientation="vertical" style={{ width: '100%' }}><Space wrap><Input.Search enterButton="검색" aria-label="알림 검색" placeholder="알림·사건 검색" value={notificationSearch} onChange={e => setNotificationSearch(e.target.value)} /><Button onClick={notifications.retry}>새로고침</Button><Button disabled={notifications.state.status !== 'success' || !notifications.state.data.content.some(item => !item.read)} onClick={async () => { if (notifications.state.status === 'success') { await setNotificationsRead(notifications.state.data.content.filter(item => !item.read).map(item => item.id), true); notifications.retry() } }}>현재 페이지 모두 읽음</Button></Space>{notifications.state.status === 'loading' ? <Spin /> : notifications.state.status === 'error' ? <Alert type="error" title={notifications.state.message} /> : <Table data-wiring-id="notifications.list" rowKey="id" dataSource={notifications.state.data.content.filter(item => `${item.code} ${item.title} ${item.description}`.includes(notificationSearch))} columns={[
      { title: '확인', render: (_, item) => <Tag>{item.read ? '읽음' : '새 알림'}</Tag> }, { title: '알림', dataIndex: 'title' }, { title: '내용', dataIndex: 'description' }, { title: '사건', render: (_, item) => <Button type="link" disabled={item.caseId == null} onClick={() => { if (item.caseId != null) open(item.caseId) }}>{item.code} 조사</Button> },
    ]} locale={{ emptyText: '현재 검색 조건에 맞는 합성 알림이 없습니다.' }} />}</Space>
    if (page === 'settings') return <Card title="화면 설정"><Space><Text>공식 기본 테마</Text><Button onClick={() => setDark(!dark)}>{dark ? '라이트 모드' : '다크 모드'}</Button></Space><p>업무 데이터나 의견을 브라우저 저장소에 보관하지 않습니다. 새로고침 시 미저장 의견이 사라집니다.</p></Card>
    if (page === 'account') return <Descriptions data-wiring-id="account.profile" bordered items={[{ key: 'name', label: '합성 계정', children: user.name }, { key: 'role', label: '역할', children: user.role === 'STAFF' ? '조사자' : '관리자' }]} />
    if (page === 'rules') return <Result status="info" title="룰 운영 계약은 이번 Ant 검수에 연결하지 않았습니다." subTitle="기존 룰 기능/코드는 보존됩니다. 이 화면은 룰 적중·저장·백테스트가 실제 동작한다는 증거가 아닙니다." />
    const analyzed = transactions.filter(row => row.isSuspicious != null)
    const suspicious = analyzed.filter(row => row.isSuspicious)
    return <Space orientation="vertical" size="middle" style={{ width: '100%' }}><Space data-wiring-id="dashboard.kpis" wrap><Card><Statistic title="전체 Alert · 탐지 건" value={alerts.length} /></Card><Card><Statistic title="전체 Episode · 묶음" value={episodes.length} /></Card><Card><Statistic title="분석 거래" value={analyzed.length} suffix={`/ 전체 ${transactions.length}건`} /></Card><Card><Statistic title="이진 의심 거래" value={suspicious.length} /></Card></Space><Alert type="info" title="합성 업무 맥락 · 업무일 2026-10-15" description="Alert와 Episode는 조사 단위가 다릅니다. 같은 점수라도 경과·상태·담당과 원본 근거를 함께 확인하세요. 통합 자동 우선순위는 제공하지 않습니다." /><Table data-wiring-id="dashboard.patterns" size="small" rowKey="code" dataSource={Array.from({ length: 9 }, (_, code) => ({ code, name: ['유형 패턴 없음 (NON_PATTERN)', 'FAN-OUT', 'FAN-IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK'][code], count: suspicious.filter(row => row.typeClass === code).length }))} columns={[{ title: '의심 거래의 유형 분포 · 정상 여부와 독립', dataIndex: 'name' }, { title: `건수 · 분모 ${suspicious.length}건`, dataIndex: 'count' }]} pagination={false} /><CaseQueue kind="ALL" rows={[...alerts, ...episodes]} open={open} /></Space>
  })()
  return <CurrentUserContext.Provider value={{ ...MOCK_USER, userId: user.id, name: user.name, role: user.role, username: user.username }}><Layout style={{ minHeight: '100svh' }}>
    <Layout.Sider width={64} collapsedWidth={64} collapsed trigger={null} theme={dark ? 'dark' : 'light'} style={{ position: 'fixed', insetInlineStart: 0, top: 0, bottom: 0, overflow: 'auto', borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}><nav aria-label="주 메뉴"><Space orientation="vertical" style={{ width: '100%', alignItems: 'center', paddingBlock: token.padding }}>
      {menus.map(item => <Tooltip key={item.key} title={item.label} placement="right" trigger={['hover', 'focus']}><Button aria-label={item.label} aria-current={page === item.key ? 'page' : undefined} type={page === item.key ? 'primary' : 'text'} icon={<item.icon size={20} aria-hidden />} onClick={() => navigate(`#${item.key}`)} /></Tooltip>)}
    </Space></nav></Layout.Sider>
    <Layout style={{ marginInlineStart: 64 }}><Layout.Header style={{ height: 'auto', padding: token.padding, background: token.colorBgContainer }}><Space wrap style={{ display: 'flex', justifyContent: 'space-between' }}><Space><Text strong>AML RADAR</Text><Breadcrumb items={[{ title }, ...(current ? [{ title: current.kind === 'ALERT' ? `A-${current.alertId}` : `E-${current.caseId}` }] : [])]} /></Space><Space><Input.Search enterButton="검색" aria-label="사건 전역 검색" placeholder="A-3010 또는 E-153" value={search} onChange={e => setSearch(e.target.value)} onSearch={value => { if (data.state.status === 'success') { const q = value.trim().toUpperCase(); const found = [...data.state.data.alerts, ...data.state.data.episodes].find(item => (item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`) === q); if (found) open(found.caseId); else setFeedback('정확한 사건 번호와 일치하는 결과가 없습니다.') } }} /><Button aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'} icon={dark ? <Sun size={18} /> : <Moon size={18} />} onClick={() => setDark(!dark)} /></Space></Space></Layout.Header>
      <Layout.Content style={{ padding: token.paddingLG, minWidth: 0 }}><Space orientation="vertical" size="middle" style={{ width: '100%' }}><Alert type="warning" showIcon title="합성 데이터 검수 · 실제 저장 불가 · 화면 배치는 검수 제안" description="동일 로컬 FE 코드의 Ant 검수 경로입니다. 실제 dev/Backend/AI 검증 결과가 아닙니다. 미저장 의견은 새로고침하면 사라집니다." />{feedback && <Alert type="info" title={feedback} closable onClose={() => setFeedback('')} />}<Title level={2}>{title}</Title>{body}</Space></Layout.Content>
    </Layout></Layout></CurrentUserContext.Provider>
}
function CaseQueue({ rows, kind, open }: { rows: ReviewCase[]; kind: ReviewKind | 'ALL'; open: (id: number) => void }) {
  const [query, setQuery] = useViewState(`ant/queue/${kind}/query`, '')
  const [scope, setScope] = useViewState(`ant/queue/${kind}/scope`, 'ALL')
  const [status, setStatus] = useViewState(`ant/queue/${kind}/status`, 'ALL')
  const [page, setPage] = useViewState(`ant/queue/${kind}/page`, 1)
  const user = useCurrentUser()
  const filtered = rows.filter(item => (scope !== 'MINE' || item.assigneeId === user.userId) && (status === 'ALL' || item.status === status) && `${item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`} ${item.assigneeName} ${item.summary.primaryType}`.toLowerCase().includes(query.toLowerCase()))
  return <Card data-wiring-id={kind === 'ALL' ? 'dashboard.work' : kind === 'ALERT' ? 'review.alerts.list' : 'review.episodes.list'} title={kind === 'ALL' ? '조사할 업무 · Alert와 Episode 교차 진입' : kind === 'ALERT' ? '단일 탐지 건 조사' : '묶음 타당성과 원본별 판단 조사'}><Space orientation="vertical" style={{ width: '100%' }}><Space wrap><Input.Search enterButton="검색" aria-label="사건 목록 검색" value={query} placeholder="사건·담당·대표 유형" onChange={event => { setQuery(event.target.value); setPage(1) }} /><Select aria-label="담당 범위" value={scope} onChange={value => { setScope(value); setPage(1) }} options={[{ value: 'ALL', label: '기관 전체' }, { value: 'MINE', label: '내 담당' }]} /><Select aria-label="처리 상태" value={status} onChange={value => { setStatus(value); setPage(1) }} options={[{ value: 'ALL', label: '모든 상태' }, { value: 'OPEN', label: '진행 중' }, { value: 'CLOSED', label: '종결' }]} /></Space><Text type="secondary">현재 조건: {scope === 'ALL' ? '기관 전체' : '내 담당'} · {status === 'ALL' ? '모든 상태' : status === 'OPEN' ? '진행 중' : '종결'} · 검색 {query || '없음'} · {filtered.length}건. 위험 점수는 자동 업무 순위가 아닙니다.</Text><Table rowKey="caseId" dataSource={filtered} scroll={{ x: 850 }} pagination={{ current: Math.min(page, Math.max(1, Math.ceil(filtered.length / 10))), pageSize: 10, showSizeChanger: false, onChange: setPage }} columns={[
    { title: '조사 단위', render: (_, item) => <Button type="link" onClick={() => open(item.caseId)}>{item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`}</Button> }, { title: '종류', render: (_, item) => item.kind === 'ALERT' ? 'Alert · 단일 탐지' : 'Episode · 묶음' },
    { title: '상태', render: (_, item) => item.episodeId != null ? 'Episode 편입 원본' : item.status === 'OPEN' ? '진행 중' : '종결' }, { title: '이진 의심 점수', render: (_, item) => item.summary.riskScore }, { title: '경과', render: (_, item) => `${item.ageDays}일` }, { title: '담당', dataIndex: 'assigneeName' }, { title: '현재 소속 거래', render: (_, item) => `${item.summary.txCount}건` },
  ]} locale={{ emptyText: query || status !== 'ALL' || scope !== 'ALL' ? '현재 검색·필터에 맞는 합성 사건이 없습니다.' : '조회된 사건 데이터가 없습니다.' }} /></Space></Card>
}
function Ledger({ rows, cases, open, back, initialTxId }: { initialTxId: number | null; rows: LedgerTransaction[]; cases: ReviewCase[]; open: (id: number) => void; back: () => void }) {
  const [query, setQuery] = useViewState('ant/ledger/query', '')
  const [owner, setOwner] = useViewState<string | undefined>('ant/ledger/owner', undefined)
  const [account, setAccount] = useViewState<string | undefined>('ant/ledger/account', undefined)
  const [selected, setSelected] = useViewState<number | null>(`ant/ledger/${initialTxId ?? 'all'}/tx`, initialTxId)
  const owners = [...new Map(rows.flatMap(row => [[row.fromOwnerId, row.fromOwnerName], [row.toOwnerId, row.toOwnerName]] as const)).entries()]
  const accountIds = [...new Set(rows.filter(row => !owner || row.fromOwnerId === owner || row.toOwnerId === owner).flatMap(row => [row.fromAccountId, row.toAccountId]))]
  const filtered = rows.filter(row => (!owner || row.fromOwnerId === owner || row.toOwnerId === owner) && (!account || row.fromAccountId === account || row.toAccountId === account) && `${row.txId} ${row.fromOwnerName} ${row.toOwnerName} ${row.fromAccountId} ${row.toAccountId}`.includes(query))
  const active = rows.find(row => row.txId === selected)
  return <Space orientation="vertical" style={{ width: '100%' }}><Button onClick={back}>조사 출발점으로 돌아가기</Button><Space wrap><Input.Search enterButton="검색" aria-label="거래 검색" value={query} placeholder="거래·계좌·소유주" onChange={e => setQuery(e.target.value)} /><Select data-wiring-id="ledger.owners" aria-label="소유주 선택" placeholder="전체 소유주" style={{ minWidth: 180 }} allowClear value={owner} options={owners.map(([value, label]) => ({ value, label: label ?? value }))} onChange={value => { setOwner(value); setAccount(undefined) }} /><Select data-wiring-id="ledger.accounts" aria-label="계좌 선택" placeholder="전체 계좌" allowClear value={account} options={accountIds.map(value => ({ value, label: value }))} style={{ minWidth: 150 }} onChange={setAccount} /></Space><Text>기간·의심 여부 필터 없음 · 검색 {query || '없음'} · {filtered.length}건. 조회 범위 변경은 사건의 판정 범위를 바꾸지 않습니다.</Text>{selected != null && !filtered.some(row => row.txId === selected) && <Alert type="info" title={`출발 거래 T-${selected}는 현재 조회 조건 밖입니다. 상세 대상은 유지됩니다.`} />}<Table data-wiring-id="ledger.transactions" rowKey="txId" dataSource={filtered} scroll={{ x: 850 }} columns={[{ title: '거래', render: (_, row) => <Button type="link" onClick={() => setSelected(row.txId)}>T-{row.txId} 상세</Button> }, { title: '거래 시각', render: (_, row) => new Date(row.occurredAt).toLocaleString('ko-KR') }, { title: '금액·통화', render: (_, row) => `${row.amountPaid.toLocaleString('ko-KR')} ${row.paymentCurrency}` }, { title: '송금 → 수취 소유주', render: (_, row) => `${row.fromOwnerName ?? '미제공'} → ${row.toOwnerName ?? '미제공'}` }, { title: '모델 이진 상태', render: (_, row) => row.isSuspicious == null ? '미분석' : row.isSuspicious ? '모델 의심' : '모델 비의심' }]} locale={{ emptyText: '현재 조건에 맞는 합성 거래가 없습니다.' }} />{active && <Card data-wiring-id="ledger.detail" title={`T-${active.txId} 상세`}><Descriptions bordered column={1} items={[{ key: 'from', label: '송금 계좌', children: active.fromAccountId }, { key: 'to', label: '수취 계좌', children: active.toAccountId }, { key: 'type', label: '거래 유형', children: active.typeName ?? '미분석' }]} /><Space wrap>{cases.filter(item => item.kind === 'ALERT' ? active.alertIds.includes(item.alertId!) : active.episodeIds.includes(item.caseId)).map(item => <Button key={item.caseId} onClick={() => open(item.caseId)}>{item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`} 연결 조사</Button>)}</Space><Button onClick={() => setSelected(null)}>상세 닫기</Button></Card>}</Space>
}
