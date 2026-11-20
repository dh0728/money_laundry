import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'
import '../../styles/theme.css'
import { AntReviewSite } from './AntReviewSite'
import { installWiringBridge } from '@/lib/wiringBridge'
// Trusted source bindings only; the parent never supplies selectors.
installWiringBridge(Object.fromEntries([
  ['dashboard', ['dashboard.kpis', 'dashboard.patterns', 'dashboard.work']],
  ['alerts', ['review.alerts.list']], ['episodes', ['review.episodes.list']],
  ['case', ['case.header.status', 'case.header.risk', 'case.header.assignee', 'case.overview.judgment', 'case.overview.model', 'case.overview.evidence', 'case.overview.connections.list', 'case.overview.progress.history', 'case.graph', 'case.review', 'case.transaction.detail']],
  ['transactions', ['ledger.owners', 'ledger.accounts', 'ledger.transactions', 'ledger.detail']],
  ['notifications', ['notifications.list']], ['account', ['account.profile']],
].flatMap(([route, ids]) => (ids as string[]).map(id => [id, { route: route as string, selectors: [] }]))))
createRoot(document.getElementById('root')!).render(<StrictMode><AntReviewSite /></StrictMode>)
