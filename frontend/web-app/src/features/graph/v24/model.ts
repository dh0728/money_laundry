// v24 domain.ts · v23-domain.ts · Agent.tsx에서 그래프가 쓰는 부분만 옮김.
// 그래프 부품(Graph·FlowDetail·OwnerGraph)은 이 모양을 받는다. API 응답은 adapter.ts가 이 모양으로 바꾼다.

export type GraphViewMode = 'account' | 'owner'

export type GraphNode = {
  key: string; account: string; bank: string; entity: string; x: number; y: number
  core: boolean; bridge: boolean; hub: boolean; hubDegree: number; hop: number; synthetic: boolean
}
/** at은 'YYYY-MM-DD HH:mm'(서울 시각) */
export type GraphTransaction = {
  id: string; at: string; usd: number; amount: number; currency: string; format: string; from: string; to: string; label: 0 | 1
  /** web-app: 모델 판정. label과 다르면 사람이 바꾼 것이다 */
  modelLabel?: 0 | 1
  /** web-app: 사람이 판정을 바꾼 기록(FE 제안) */
  relabel?: { reason: string; at: string; actor: string }
}
export type GraphEdge = {
  key: string; s: string; t: string; label: 0 | 1; count: number; usd: number; currency: string; format: string
  first: string; last: string; bridgePath: boolean; synthetic: boolean; transactions: GraphTransaction[]
}
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[]; blocks: number[] }

export const usd = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) + '$'
export const compactUsd = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M$` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K$` : `${Math.round(n)}$`

// BFS: 선택 계좌에서 hop 이내 계좌
export function neighborhood(model: GraphModel, key: string, hop: number) {
  const seen = new Set([key]); let layer = [key]
  for (let i = 0; i < hop; i++) {
    const next: string[] = []
    for (const e of model.edges) {
      if (layer.includes(e.s) && !seen.has(e.t)) { seen.add(e.t); next.push(e.t) }
      if (layer.includes(e.t) && !seen.has(e.s)) { seen.add(e.s); next.push(e.s) }
    }
    layer = next
  }
  return seen
}

// 금액(USD) → 선 굵기. 보이는 엣지들의 min~max를 로그 척도로 1~12px에 매핑한다. min===max면 3px.
export const widthFor = (value: number, min: number, max: number) => {
  const lo = Math.log(Math.max(min, 1e-9)), hi = Math.log(Math.max(max, 1e-9))
  if (!(hi - lo > 1e-9)) return 3
  const v = Math.min(max, Math.max(min, value))
  const t = (Math.log(Math.max(v, 1e-9)) - lo) / (hi - lo)
  return 1 + t * (12 - 1)
}

export const minutes = (at: string) => {
  const [d, t] = at.split(' '); const [Y, M, D] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number)
  return Date.UTC(Y, M - 1, D, h, m) / 60000
}
export const timeLabel = (value: number) => {
  const d = new Date(value * 60000), p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
// 시간축 단계: 거래가 처음 시작된 시각들(중복 제거, 오름차순)
export const timelineEvents = (edges: GraphEdge[]) => [...new Set(edges.flatMap(e => e.transactions.map(t => minutes(t.at))))].sort((a, b) => a - b)
export function stepTimeline(events: number[], current: number, direction: 1 | -1) {
  if (!events.length) return current
  if (direction > 0) return events.find(v => v > current) ?? current
  const shown = events.filter(v => v <= current)
  if (!shown.length) return current
  return shown.length === 1 ? events[0] - 1 : shown[shown.length - 2]
}

const currencyMarkers: Record<string, string> = {
  'US Dollar': '$', USD: '$', Euro: '€', EUR: '€', 'Pound Sterling': '£', GBP: '£', 'Japanese Yen': '¥', JPY: '¥',
  'Swiss Franc': 'CHF', CHF: 'CHF', 'Brazil Real': 'BRL', Yuan: 'CNY', Ruble: 'RUB',
}
export function formatMoney(amount: number, currency: string) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}${currencyMarkers[currency] ?? currency}`
}
export function formatGraphMoney(edge: { usd: number; currency: string; transactions?: Array<{ amount: number; currency: string }> }) {
  const currency = edge.transactions?.[0]?.currency ?? edge.currency
  return edge.transactions?.length && edge.transactions.every(transaction => transaction.currency === currency)
    ? formatMoney(edge.transactions.reduce((sum, transaction) => sum + transaction.amount, 0), currency)
    : formatMoney(edge.usd, 'USD')
}

// v24 Agent.tsx: 떠 있는 상세 창이 본문 영역 밖으로 나가지 않게 하는 경계
const rightLimit = () => {
  const main = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.app-main')
  if (!main) return globalThis.innerWidth ?? 1440
  return Math.floor(main.getBoundingClientRect().right - (main.offsetWidth - main.clientWidth))
}
export const readPanelBounds = () => ({
  width: globalThis.innerWidth ?? 1440,
  height: globalThis.innerHeight ?? 900,
  contentRight: rightLimit(),
  headerBottom: typeof document === 'undefined' ? 60 : Math.ceil(document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 60),
})
