import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ScanLine, ShieldCheck, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShell, Appearance, type Theme, type Accent } from './ui/AppShell'
import { Dashboard } from './Dashboard'
import { selectDashboard, snapshot, type Scope, type DashboardData } from './dashboard-data'
import { WorkspaceProvider } from './WorkspaceProvider'
import { withinSampleBudget } from './workspace-data'
import { useWorkspace } from './workspace-store'
import { WorkspaceUtilities, type Preferences } from './WorkspaceUtilities'
import './styles/app.css'
import './styles/workspace.css'

const RulesPage = lazy(() => import('./features/RulesPage').then(m => ({ default: m.RulesPage })))
const InvestigationPage = lazy(() => import('./features/InvestigationPage').then(m => ({ default: m.InvestigationPage })))
const CasePage = lazy(() => import('./features/CasePage').then(m => ({ default: m.CasePage })))
const ReportPage = lazy(() => import('./features/ReportPage').then(m => ({ default: m.ReportPage })))

type PreviewState = 'ready' | 'loading' | 'empty' | 'error'
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback); window.addEventListener('popstate', callback)
  return () => { window.removeEventListener('hashchange', callback); window.removeEventListener('popstate', callback) }
}
function navigate(path: string, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', `${window.location.pathname}${window.location.search}#${path}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
function readStorage(key: string, session = false) {
  try { return (session ? window.sessionStorage : window.localStorage).getItem(key) } catch { return null }
}
function saveStorage(key: string, value: string | null, session = false) {
  try { const storage = session ? window.sessionStorage : window.localStorage; if (value === null) storage.removeItem(key); else storage.setItem(key, value) } catch { /* A blocked store keeps this session in memory. */ }
}
function readAppearance() {
  try {
    const stored = JSON.parse(readStorage('aml-next-appearance') ?? '{}')
    return { theme: (['light', 'dark', 'solarized-light', 'solarized-dark'].includes(stored?.theme) ? stored.theme : 'light') as Theme,
      accent: (['sky', 'violet', 'pink', 'lime'].includes(stored?.accent) ? stored.accent : 'sky') as Accent,
      fontSize: (['small', 'default', 'large'].includes(stored?.fontSize) ? stored.fontSize : 'default') as Preferences['fontSize'] }
  } catch { return { theme: 'light' as Theme, accent: 'sky' as Accent, fontSize: 'default' as const } }
}
function validDate(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : fallback
}
export function App() { return <WorkspaceProvider><WorkspaceBudget /></WorkspaceProvider> }
function WorkspaceBudget() {
  const workspace = useWorkspace()
  if (!withinSampleBudget(workspace)) return <div data-ui="aml-app" data-theme="light" data-accent="sky"><main data-ws="empty"><h1>조회 범위를 좁혀 주세요</h1><p>대용량 데이터는 서버에서 나눈 조회 결과가 필요합니다. 전체 원장을 화면에 불러올 수 없습니다.</p></main></div>
  return <WorkspaceApp />
}

function WorkspaceApp() {
  const workspace = useWorkspace()
  const [utility, setUtility] = useState<'notifications' | 'settings' | 'account' | null>(null)
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const route = parseRoute(hash)
  const isDashboard = route.pathname.startsWith('/dashboard')
  const [signedIn, setSignedIn] = useState(() => readStorage('aml-next-session', true) === 'sample-staff-7')
  const [appearance, setAppearance] = useState(readAppearance)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [state, setState] = useState<PreviewState>(() => {
    const value = new URLSearchParams(window.location.search).get('state')
    return value === 'empty' || value === 'loading' || value === 'error' ? value : 'ready'
  })
  const [hasData, setHasData] = useState(state === 'ready' || state === 'empty')
  const [retained, setRetained] = useState<{ hash: string; data: DashboardData } | null>(null)
  const scope: Scope = route.pathname === '/dashboard/all' ? 'all' : 'mine'
  const first = validDate(route.searchParams.get('start'), '2026-11-09')
  const last = validDate(route.searchParams.get('end'), snapshot.date)
  const [start, end] = first <= last ? [first, last] : ['2026-11-09', snapshot.date]
  const query = route.searchParams.get('q') ?? ''
  // A failed query retains its exact result. A new URL projects the cached fixture anew.
  const visibleState = state === 'error' && retained && retained.hash !== hash ? 'ready' : state
  const data = useMemo(() => !isDashboard ? null : visibleState === 'error' && retained ? retained.data : selectDashboard(scope, start, end, query, visibleState === 'empty', workspace.records, workspace.transactions), [isDashboard, visibleState, retained, scope, start, end, query, workspace.records, workspace.transactions])
  const loginRoute = route.pathname === '/login'
  useEffect(() => {
    if (!signedIn && !loginRoute) navigate('/login', true)
    else if (signedIn && !supportedRoute(route.pathname)) navigate('/dashboard/mine', true)
  }, [signedIn, loginRoute, route.pathname])
  useEffect(() => {
    if (state !== 'loading' || new URLSearchParams(window.location.search).get('state') === 'loading') return
    const timer = window.setTimeout(() => { setState('ready'); setHasData(true) }, 350)
    return () => window.clearTimeout(timer)
  }, [state])
  function updateAppearance(value: Partial<typeof appearance>) {
    const next = { ...appearance, ...value }; setAppearance(next); saveStorage('aml-next-appearance', JSON.stringify(next))
  }
  function signOut(expired = false) { saveStorage('aml-next-session', null, true); setUtility(null); setRetained(null); setState('ready'); setHasData(true); workspace.resetWorkspace?.(); setSignedIn(false); navigate(expired ? '/login?expired=1' : '/login', true) }
  function signIn() { saveStorage('aml-next-session', 'sample-staff-7', true); setSignedIn(true); navigate('/dashboard/mine', true) }
  function updateFilter(next: { start?: string; end?: string; q?: string; state?: string }) {
    const target = new URL(route)
    if (!isDashboard && !route.pathname.startsWith('/rules') && route.pathname !== '/report' && !route.pathname.startsWith('/investigate')) { target.pathname = route.pathname.startsWith('/episodes') ? '/investigate/episodes' : '/investigate/alerts'; target.search = '' }
    if (isDashboard) { target.searchParams.set('start', start); target.searchParams.set('end', end) }
    Object.entries(next).forEach(([key, value]) => { if (value) target.searchParams.set(key, value); else target.searchParams.delete(key) })
    if ('q' in next || 'start' in next || 'end' in next) ['page', 'ownerPage', 'accountPage', 'transactionPage'].forEach(key => target.searchParams.delete(key))
    navigate(`${target.pathname}${target.search}`)
  }
  function preview(value: string) {
    if (value === 'expired') { signOut(true); return }
    if (!isDashboard) { setState('ready'); const next = new URL(route); next.searchParams.set('state', value); navigate(`${next.pathname}${next.search}`); return }
    if (value === 'error' && hasData && data) setRetained({ hash, data })
    setState(value as PreviewState)
    if (value === 'ready' || value === 'empty') setHasData(true)
  }
  const featureRoute = new URL(route)
  if (!isDashboard && state === 'loading') featureRoute.searchParams.set('state', 'loading')
  const featureState = featureRoute.searchParams.get('state') ?? 'ready'
  const currentCaseId = Number(route.pathname.match(/^\/(?:alerts|episodes)\/(\d+)$/)?.[1])
  const opened = new Set(workspace.openedCaseIds ?? [])
  const openRecords = workspace.records.filter(c => opened.has(c.caseId))
  const unread = workspace.notifications.reduce((n, item) => n + (item.read ? 0 : 1), 0)
  const feature = route.pathname.startsWith('/rules') ? <RulesPage route={featureRoute} />
    : route.pathname.startsWith('/investigate') ? <InvestigationPage route={featureRoute} />
    : route.pathname === '/report' ? <ReportPage route={featureRoute} />
    : <CaseState state={featureState} onRetry={() => { const next = new URL(route); next.searchParams.delete('state'); navigate(`${next.pathname}${next.search}`) }}><CasePage route={featureRoute} /></CaseState>

  const appearanceControls = <Appearance {...appearance} onTheme={theme => updateAppearance({ theme })} onAccent={accent => updateAppearance({ accent })} />
  return <div data-ui="aml-app" data-theme={appearance.theme} data-accent={appearance.accent} data-font-size={appearance.fontSize}>
    {!signedIn || loginRoute ? <Login expired={route.searchParams.get('expired') === '1'} onLogin={signIn} appearance={appearanceControls} /> : <AppShell {...appearance} scope={scope} pathname={route.pathname} openRecords={openRecords} unreadCount={unread} onNotifications={() => setUtility('notifications')} onSettings={() => setUtility('settings')} onAccount={() => setUtility('account')} onCloseCase={id => { workspace.closeCase?.(id); if (id === currentCaseId) navigate('/dashboard/mine') }} filters={route.search} sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} onLogout={() => signOut()} appearance={appearanceControls} query={query} onSearch={q => updateFilter({ q })} actions={<>
      {import.meta.env.DEV && <label data-part="preview-control"><span>검수 상태</span><select aria-label="검수 상태" value={isDashboard ? visibleState : featureState} onChange={e => preview(e.target.value)}><option value="ready">기본</option><option value="loading">로딩</option><option value="empty">빈 결과</option><option value="error">재조회 오류</option><option value="expired">세션 만료</option></select></label>}
      <Button variant="ghost" size="icon-sm" aria-label="새로고침" disabled={state === 'loading'} onClick={() => { if (!isDashboard) { const next = new URL(route); next.searchParams.delete('state'); navigate(`${next.pathname}${next.search}`) } setState('loading') }}><RefreshCw /></Button>
    </>}>{isDashboard ? <Dashboard data={data!} scope={scope} start={start} end={end} query={query} state={visibleState === 'error' && !hasData ? 'initial-error' : visibleState} onRetry={() => { setState('ready'); setHasData(true) }} onRange={(start, end) => updateFilter({ start, end })} onClearSearch={() => updateFilter({ q: '' })} onClear={() => { setState('ready'); updateFilter({ q: '', start: '2026-11-09', end: snapshot.date }) }} /> : <Suspense fallback={<p role="status" data-ws="empty">화면을 불러오는 중입니다.</p>}>{feature}</Suspense>}</AppShell>}
    {signedIn && !loginRoute && <WorkspaceUtilities active={utility} onClose={() => setUtility(null)} preferences={appearance} onPreferences={value => updateAppearance(value)} onLogout={() => signOut()} />}
  </div>
}

function parseRoute(hash: string) {
  try { return new URL(hash.slice(1) || '/login', 'http://aml.local') }
  catch { return new URL('/dashboard/mine', 'http://aml.local') }
}
function supportedRoute(path: string) { return /^\/(?:login|dashboard\/(?:mine|all)|rules(?:\/new|\/[^/]+\/backtest)?|investigate\/(?:ledger|alerts|episodes)|(?:alerts|episodes)\/\d+|report)$/.test(path) }
function CaseState({ state, onRetry, children }: { state: string; onRetry: () => void; children: React.ReactNode }) {
  if (state === 'loading') return <section data-ws="empty" role="status">조사 업무를 불러오는 중입니다.</section>
  if (state === 'empty') return <section data-ws="empty"><h2>표시할 조사 업무가 없습니다</h2><Button variant="secondary" onClick={onRetry}>다시 조회</Button></section>
  return <>{state === 'error' && <div role="alert" data-ws="notice">재조회에 실패했습니다. 마지막 조사 내용을 유지합니다.<Button variant="ghost" onClick={onRetry}>다시 시도</Button></div>}{children}</>
}

export function Login({ expired, onLogin, appearance }: { expired: boolean; onLogin: () => void; appearance: React.ReactNode }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!busy) return; const timer = window.setTimeout(onLogin, 250); return () => window.clearTimeout(timer) }, [busy, onLogin])
  return <main data-part="login-main"><div data-part="login-appearance">{appearance}</div><section data-part="login-card">
    <div data-part="login-mark"><ScanLine /><strong>AML RADAR</strong></div><h1>로그인</h1><p data-part="muted">의심 거래를 확인하고 담당 업무를 이어가세요.</p>
    {expired && <p role="status" data-part="notice">세션이 만료되었습니다. 다시 로그인해 주세요.</p>}
    <form aria-label="로그인" noValidate onSubmit={e => { e.preventDefault(); if (busy) return; const values = new FormData(e.currentTarget); const id = String(values.get('id') ?? '').trim(); const password = String(values.get('password') ?? ''); if (!id || !password) setError('아이디와 비밀번호를 입력해 주세요.'); else if (id !== 'demo' || password !== 'radar-demo') setError('샘플 계정 정보를 확인해 주세요.'); else { setError(''); setBusy(true) } }}>
      <label>아이디<input name="id" autoComplete="username" placeholder="아이디 입력" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} disabled={busy} /></label>
      <label>비밀번호<input name="password" type="password" autoComplete="current-password" placeholder="비밀번호 입력" aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} disabled={busy} /></label>
      {error && <p id="login-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</Button>
    </form><div data-part="sample-login"><p><ShieldCheck />샘플 환경 · 실제 인증 없이 화면을 확인합니다.</p><p data-part="muted">아이디 demo · 비밀번호 radar-demo</p><Button variant="secondary" disabled={busy} onClick={() => setBusy(true)}>샘플 계정으로 입장</Button></div>
    {busy && <p role="status">로그인 중입니다.</p>}
  </section></main>
}
