// 새 UI 확인용 mock 데이터. Figma 시안에 적힌 값을 그대로 옮겼고 API 는 아직 연결하지 않는다.
import type { WorkStatus } from './components/tags'

export type CaseCardData = {
  id: string
  tone: 'caution' | 'danger' | 'neutral'
  /** 목록 화면의 판정 전 카드는 본문만 옅은 파랑이다 */
  bodyTint?: boolean
  patterns: string[]
  morePatterns?: number
  rows: { label: string; value: string }[]
  score: 'high' | 'medium' | 'low'
  verdict?: 'abnormal' | 'normal'
  reviewer?: string
  judgedAt?: string
  assignee?: string
}

const P3 = ['FAN-OUT 82%', 'SC-GA 11%', 'CYCLE 4%']
const patternsOf = (count: number) => P3.slice(0, count)

// ── 대시보드(내 담당) 보드 ────────────────────────────────────────────────
const boardAlert = (n: string, patternCount: number, more?: number): CaseCardData => ({
  id: `A-261111-${n}`, tone: 'caution', patterns: patternsOf(patternCount), morePatterns: more, score: 'high',
  rows: [{ label: '거래 건수', value: '12건' }, { label: '거래 금액', value: '123,456 USD' }],
})
const boardEpisode = (n: string, patternCount: number, more?: number): CaseCardData => ({
  id: `E-261111-${n}`, tone: 'caution', patterns: patternsOf(patternCount), morePatterns: more, score: 'high',
  rows: [{ label: '거래 금액', value: '456,789 USD' }, { label: 'Alert 건수', value: '4건' }],
})

export const myBoard: { status: WorkStatus; count: string; cards: CaseCardData[] }[] = [
  { status: 'unread', count: '6건', cards: [boardAlert('000001', 1), boardEpisode('000001', 3), boardEpisode('000002', 3, 1), boardAlert('000002', 2), boardAlert('000003', 3)] },
  { status: 'pending', count: '8건', cards: [boardAlert('000004', 3, 1), boardAlert('000005', 3), boardEpisode('000003', 1), boardAlert('000006', 1), boardAlert('000007', 3)] },
  { status: 'inProgress', count: '5건', cards: [boardAlert('000008', 3), boardEpisode('000004', 3), boardAlert('000009', 2), boardAlert('000010', 3, 1), boardAlert('000011', 3)] },
  { status: 'done', count: '12건', cards: [boardAlert('000012', 3), boardEpisode('000005', 3, 1), boardAlert('000013', 2), boardAlert('000014', 3), boardEpisode('000006', 3)] },
]

// ── 대시보드(전체) 업무 현황 ──────────────────────────────────────────────
const fullRows = [
  { label: '계좌 흐름', value: '47c0b93e → 8f2a1d07' }, { label: '거래 기간', value: '2023-09-01 ~ 2023-09-05' },
  { label: '거래 건수', value: '8건' }, { label: '거래 금액', value: '80,300 USD' },
  { label: 'Alert 건수', value: '3건' }, { label: '관련 계좌', value: '12개' },
]
const workCard = (id: string): CaseCardData => ({ id, tone: 'caution', patterns: P3, morePatterns: 1, rows: fullRows, score: 'high', assignee: '담당자-김OO' })
export const workBoard: { label: string; tone: 'brand' | 'positive'; count: string; cards: CaseCardData[] }[] = [
  { label: '열린 Alert', tone: 'brand', count: '3건', cards: [workCard('A-261111-000301')] },
  { label: '열린 Episode', tone: 'brand', count: '2건', cards: [workCard('E-261111-000401')] },
  { label: '처리 완료', tone: 'positive', count: '2건', cards: [workCard('A-261111-000304')] },
]

// ── 조사 > Alert 목록 ────────────────────────────────────────────────────
export type AlertRow = {
  id: string
  patterns: string[]
  score: 'high' | 'medium' | 'low'
  assignee: string
  status?: WorkStatus
  elapsed?: { days: string; level: 'low' | 'mid' | 'high' }
  accounts: string
  period: string
  tx: string
  amount: string
}
const alertRow = (n: number, patterns: string[], status: WorkStatus | undefined, elapsed: AlertRow['elapsed'], accounts: string, period: string, tx: string, amount: string, assignee = '담당자-김OO'): AlertRow =>
  ({ id: `A-261111-${String(n).padStart(6, '0')}`, patterns, score: 'high', assignee, status, elapsed, accounts, period, tx, amount })
const over: AlertRow['elapsed'] = { days: '1234', level: 'high' }

export const alertRows: AlertRow[] = [
  alertRow(1, ['Fan-out 93%', 'Scatter-gather 41%'], 'unread', over, '47c0b93e → 8f2a1d07 외 6', '2026-09-20 ~ 2026-09-23', '14건', '128,400 USD'),
  alertRow(2, ['Fan-out 73%'], 'inProgress', over, 'c41f3f2a → 5e7d9d04 → c41f3f2a', '2026-09-21 ~ 2026-09-22', '6건', '54,000 USD'),
  alertRow(3, ['Fan-out 87%', 'Scatter-gather 33%'], 'pending', over, 'f3900c58 → 2b6e11a9 외 3', '2026-09-18 ~ 2026-09-24', '9건', '41,750 USD'),
  alertRow(4, ['Fan-out 64%'], 'inProgress', undefined, '9a14c3d2 → 7e0f5b61 외 4', '2026-09-23 ~ 2026-09-24', '11건', '96,200 USD'),
  alertRow(5, ['Fan-out 79%', 'Scatter-gather 22%'], 'pending', over, '3d7a90e4 → 47c0b93e 외 2', '2026-09-22 ~ 2026-09-23', '5건', '18,900 USD'),
  alertRow(6, ['Fan-out 54%'], undefined, undefined, 'b8e2f117 → 0c5d3a88 외 5', '2026-09-24 ~ 2026-09-25', '8건', '33,600 USD', '담당자-A'),
  alertRow(7, ['Fan-in 81%', 'Cycle 36%'], 'inProgress', { days: '5일', level: 'mid' }, 'a1c90e22 → 6b4d18f0 외 4', '2026-09-19 ~ 2026-09-22', '7건', '72,150 USD'),
  alertRow(8, ['Cycle 88%'], 'unread', { days: '2일', level: 'mid' }, '11d8a6c3 → 9f0e2b47', '2026-09-24 ~ 2026-09-25', '4건', '21,300 USD'),
  alertRow(9, ['Bipartite 76%', 'Fan-out 31%'], 'pending', over, '5e7d9d04 → c41f3f2a 외 3', '2026-09-17 ~ 2026-09-21', '10건', '88,640 USD'),
  alertRow(10, ['Gather-scatter 91%', 'Stack 27%'], 'inProgress', over, '0c5d3a88 → b8e2f117 외 7', '2026-09-15 ~ 2026-09-20', '16건', '154,800 USD'),
  alertRow(11, ['Stack 69%'], 'unread', { days: '3일', level: 'mid' }, '7e0f5b61 → 9a14c3d2 외 2', '2026-09-23 ~ 2026-09-24', '5건', '19,450 USD'),
  alertRow(12, ['Random 84%', 'Fan-in 38%'], 'pending', over, '2b6e11a9 → f3900c58 외 5', '2026-09-14 ~ 2026-09-18', '12건', '63,220 USD'),
]

// 카드 보기: 같은 Alert 을 판정 끝난 모습 / 판정 전 모습으로 나란히 보여 주는 시안을 따른다
const listRows = (row: AlertRow) => [
  { label: '계좌 흐름', value: row.accounts }, { label: '거래 기간', value: row.period },
  { label: '거래 건수', value: row.tx }, { label: '거래 금액', value: row.amount },
]
const cardPatterns = (index: number) => (index % 2 === 0 ? ['FAN-OUT 82%', 'SC-GA 11%'] : ['FAN-OUT 82%'])
export const alertCards: CaseCardData[] = alertRows.slice(0, 6).flatMap((row, index): CaseCardData[] => {
  const abnormal = index % 3 === 0
  const judged: CaseCardData = {
    id: row.id, tone: abnormal ? 'danger' : 'neutral', patterns: cardPatterns(index), rows: listRows(row),
    score: abnormal ? 'high' : 'medium', verdict: abnormal ? 'abnormal' : 'normal', reviewer: '검수자-김OO', judgedAt: '2023-09-08',
  }
  const open: CaseCardData = abnormal
    ? { ...judged, id: `A-261111-${String(index + 101).padStart(6, '0')}` }
    : { id: `A-261111-${String(index + 101).padStart(6, '0')}`, tone: 'caution', bodyTint: true, patterns: cardPatterns(index), rows: listRows(row), score: 'high', assignee: '담당자-김OO' }
  return [judged, open]
})

// ── 조사 > Episode 목록 ──────────────────────────────────────────────────
export type EpisodeRow = Omit<AlertRow, 'tx'> & { alerts: string; relatedAccounts: string; tx: string }
export const episodeRows: EpisodeRow[] = [
  { id: 'E-261111-000001', patterns: ['Fan-out 88%', 'Scatter-gather 36%', 'Cycle 71%'], score: 'high', assignee: '담당자-김OO', status: 'inProgress', elapsed: over, accounts: '공유 계좌 4 · 자금 흐름 연속 3', period: '2026-09-18 ~ 2026-09-24', alerts: '3건', relatedAccounts: '14개', tx: '27건', amount: '212,300 USD' },
  { id: 'E-261111-000002', patterns: ['Fan-out 76%', 'Scatter-gather 19%'], score: 'high', assignee: '담당자-김OO', status: 'inProgress', elapsed: over, accounts: '공유 계좌 2 · 자금 흐름 연속 2', period: '2026-09-20 ~ 2026-09-23', alerts: '2건', relatedAccounts: '9개', tx: '12건', amount: '87,500 USD' },
]
const episodeCard = (n: string, base: Pick<CaseCardData, 'tone' | 'score' | 'verdict' | 'bodyTint'>, patternCount: number, values: [string, string, string, string, string, string]): CaseCardData => ({
  id: `E-261111-${n}`, ...base, patterns: patternsOf(patternCount),
  rows: ['계좌 흐름', '거래 기간', '거래 건수', '거래 금액', 'Alert 건수', '관련 계좌'].map((label, index) => ({ label, value: values[index] })),
  ...(base.verdict ? { reviewer: '검수자-김OO', judgedAt: '2023-09-08' } : {}),
})
export const episodeCards: CaseCardData[] = [
  episodeCard('000001', { tone: 'danger', score: 'high', verdict: 'abnormal' }, 3, ['공유 계좌 4 · 자금 흐름 연속 3', '2026-09-18 ~ 2026-09-24', '27건', '212,300 USD', '3건', '14개']),
  episodeCard('000002', { tone: 'neutral', score: 'medium', verdict: 'normal' }, 2, ['공유 계좌 2 · 자금 흐름 연속 2', '2026-09-20 ~ 2026-09-23', '12건', '87,500 USD', '2건', '9개']),
  episodeCard('000004', { tone: 'neutral', score: 'high', verdict: 'normal' }, 3, ['공유 계좌 3 · 직접 거래 2', '2026-09-15 ~ 2026-09-22', '19건', '64,100 USD', '4건', '11개']),
  episodeCard('000005', { tone: 'danger', score: 'high', verdict: 'abnormal' }, 2, ['공유 계좌 1 · 자금 흐름 연속 1', '2026-09-22 ~ 2026-09-25', '8건', '29,800 USD', '2건', '6개']),
  episodeCard('000006', { tone: 'caution', score: 'high', bodyTint: true }, 2, ['공유 계좌 5 · 직접 거래 4', '2026-09-10 ~ 2026-09-21', '31건', '154,200 USD', '5건', '18개']),
  episodeCard('000009', { tone: 'caution', score: 'high', bodyTint: true }, 3, ['공유 계좌 6 · 자금 흐름 연속 5', '2026-09-01 ~ 2026-09-18', '45건', '276,900 USD', '6건', '21개']),
]

// ── 조사 > 소유주·계좌·거래 ───────────────────────────────────────────────
export const owners = ['소유주-001', '소유주-002', '소유주-005', '소유주-003', '소유주-004']
export const accounts = ['ACC-1001', 'ACC-1002', 'ACC-1003']
export const transactions = ['T-50001', 'T-50002', 'T-50003', 'T-50004', 'T-50005']
const linkedAlert = (id: string): CaseCardData => ({
  id, tone: 'caution', patterns: ['FAN-OUT 82%'], score: 'high', assignee: '담당자-김OO',
  rows: [{ label: '계좌 흐름', value: '선택 거래 포함 · 47c0b93e → 8f2a1d07' }, { label: '거래 기간', value: '2026-09-24 ~ 2026-09-25' }, { label: '거래 건수', value: '7건' }, { label: '거래 금액', value: '61,300 USD' }],
})
const linkedEpisode = (id: string): CaseCardData => ({
  id, tone: 'caution', patterns: ['FAN-OUT 82%', 'SC-GA 11%'], score: 'high', assignee: '담당자-김OO',
  rows: [{ label: '계좌 흐름', value: '선택 거래가 속한 Episode' }, { label: '거래 기간', value: '2026-09-20 ~ 2026-09-23' }, { label: '거래 건수', value: '12건' }, { label: '거래 금액', value: '87,500 USD' }],
})
export const linkedCases: CaseCardData[] = [linkedAlert('A-261111-000007'), linkedEpisode('E-261111-000002'), linkedAlert('A-261111-000015'), linkedEpisode('E-261111-000007')]

// ── 상세 > 관련 탭 후보 ───────────────────────────────────────────────────
const candidate = (id: string, patternCount: number, more: number | undefined, flow: string, period: string, tx: string, amount: string): CaseCardData => ({
  id, tone: 'caution', patterns: patternsOf(patternCount), morePatterns: more, score: 'high',
  rows: [{ label: '계좌 흐름', value: flow }, { label: '거래 기간', value: period }, { label: '거래 건수', value: tx }, { label: '거래 금액', value: amount }],
})
export const relatedCandidates = (base: string): CaseCardData[] => [
  candidate('A-261111-001051', 2, undefined, '공유 계좌 3 · 자금 흐름 연속 3', `${base} 종료 2일 5시간 뒤 A-261111-001051 시작`, '8건', '80,300 USD'),
  candidate(base.startsWith('E-') ? 'A-261111-001069' : 'E-261111-000008', 3, 1, '공유 계좌 1 · 자금 흐름 연속 1', `A-261111-001069 종료 3일 7시간 뒤 ${base} 시작`, '3건', '22,300 USD'),
  candidate('A-261111-001077', 2, undefined, '공유 소유주 1', `${base}와 기간 겹침 2일`, '4건', '12,800 USD'),
  candidate(base.startsWith('E-') ? 'A-261111-001058' : 'E-261111-000009', 3, 1, '직접 거래 1', `${base} 종료 3일 8시간 뒤 A-261111-001058 시작`, '6건', '18,400 USD'),
]

// ── 상세 > 분석 탭 표 ─────────────────────────────────────────────────────
export type TxRow = { id: string; alert: string; time: string; from: string; to: string; amount: string; method: string; score: 'high' | 'medium' | 'low'; reason: string; reasonTone: 'danger' | 'caution' }
const tx = (id: string, alert: string, time: string, from: string, to: string, amount: string, method: string, score: TxRow['score'], reason: string): TxRow =>
  ({ id, alert, time, from, to, amount, method, score, reason, reasonTone: reason === '씨앗' ? 'danger' : 'caution' })
export const txRows: TxRow[] = [
  tx('T-230903-04183012', 'A-261111-000003', '09-03 18:40', '7a19e0b4 · BK-012', 'c41f3f2a · BK-070', '9,800 USD', 'ACH', 'high', '씨앗'),
  tx('T-230903-04183140', 'A-261111-000003', '09-03 19:05', 'b02c5d71 · BK-21174', 'c41f3f2a · BK-070', '12,400 USD', 'ACH', 'high', '씨앗'),
  tx('T-230903-04183266', 'A-261111-000001', '09-03 19:30', '1e88a3c9 · BK-012', 'c41f3f2a · BK-070', '8,900 USD', 'ACH', 'medium', '직접 경로 · 상류'),
  tx('T-230903-04183391', 'A-261111-000001', '09-03 19:55', 'd5f07e26 · BK-001', 'c41f3f2a · BK-070', '11,200 USD', 'Wire', 'high', '씨앗'),
  tx('T-230903-04183507', 'A-261111-000001', '09-03 20:20', '93b6c1a0 · BK-070', 'c41f3f2a · BK-070', '9,500 USD', 'ACH', 'medium', '직접 경로 · 상류'),
  tx('T-230903-04183902', 'A-261111-000007', '09-03 21:40', 'c41f3f2a · BK-070', '5e7d9d04 · BK-21174', '31,000 USD', 'Wire', 'low', '직접 경로 · 하류'),
  tx('T-230903-04184733', 'A-261111-000007', '09-04 00:30', 'c41f3f2a · BK-070', '28ac4b6f · BK-012', '30,400 USD', 'Wire', 'medium', '직접 경로 · 하류'),
  tx('T-230904-04185120', 'A-261111-000007', '09-04 01:15', '5e7d9d04 · BK-21174', '9f0e2b47 · BK-044', '23,200 USD', 'ACH', 'low', '주변 맥락'),
]

export type AccountRow = { name: string; core: boolean; role: string; inflow: [string, string]; outflow: [string, string]; net: string; concentration: string; fastOut: string; baseline: string; newPeers?: string; outside?: string; past?: string }
const acc = (name: string, core: boolean, role: string, inflow: [string, string], outflow: [string, string], net: string, rest: Partial<AccountRow> = {}): AccountRow =>
  ({ name, core, role, inflow, outflow, net, concentration: '—', fastOut: '—', baseline: '—', ...rest })
export const accountRows: AccountRow[] = [
  acc('c41f3f2a · 소유주 A · BK-070', true, '중계', ['65,700 USD', '7건'], ['54,500 USD', '2건'], '11,200 USD', { concentration: '83.0%', fastOut: '82.9%', baseline: '건수 ×6.2 · 금액 ×8.4', newPeers: '새 상대방 5곳', outside: '4건' }),
  acc('5e7d9d04 · 소유주 B · BK-21174', true, '중계', ['33,100 USD', '2건'], ['30,400 USD', '1건'], '2,700 USD', { concentration: '93.7%', fastOut: '91.8%', baseline: '건수 ×3.1 · 금액 ×4.0', newPeers: '새 상대방 1곳', outside: '2건' }),
  acc('28ac4b6f · 소유주 C · BK-012', true, '중계', ['23,500 USD', '1건'], ['23,200 USD', '2건'], '300 USD', { concentration: '100.0%', fastOut: '98.7%', baseline: '기준선 부족 · 관측 12일', newPeers: '새 상대방 2곳' }),
  acc('7a19e0b4 · 소유주 D · BK-012', false, '송금', ['0 USD', '0건'], ['17,400 USD', '2건'], '-17,400 USD'),
  acc('1e88a3c9 · 소유주 D · BK-012', false, '송금', ['0 USD', '0건'], ['15,200 USD', '2건'], '-15,200 USD'),
  acc('b02c5d71 · 소유주 E · BK-21174', false, '중계', ['12,500 USD', '1건'], ['12,720 USD', '2건'], '-220 USD', { past: '과거 사건 1건' }),
  acc('d5f07e26 · 소유주 F · BK-001', false, '송금', ['0 USD', '0건'], ['11,300 USD', '1건'], '-11,300 USD'),
  acc('93b6c1a0 · 소유주 G · BK-070', false, '송금', ['0 USD', '0건'], ['9,500 USD', '1건'], '-9,500 USD'),
]

// 관련 탭 > 연결 근거
export const linkEvidence = (base: string) => [
  { kind: '공유 계좌', target: '5e7d9d04 · 소유주-310 · BK-174', detail: `${base} 경유 → A-261111-001051 경유 · 흐름 연속`, strength: '강' },
  { kind: '공유 계좌', target: 'c41f3f2a · 소유주-873 · BK-070', detail: `${base} 경유 → A-261111-001051 출발 · 흐름 연속`, strength: '강' },
  { kind: '공유 계좌', target: 'f3900c58 · 소유주-695 · BK-220', detail: `${base} 도착 → A-261111-001051 경유 · 흐름 연속`, strength: '강' },
  { kind: '시간', target: `${base} 종료 2일 5시간 뒤 A-261111-001051 시작`, detail: '09-02 22:10 ~ 09-04 02:10 / 09-06 07:50 ~ 09-07 08:30', strength: '보조' },
]
