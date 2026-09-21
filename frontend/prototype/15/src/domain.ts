import graphSource from './data/graph-blocks.json'

export type Risk = '고위험' | '중위험' | '저위험'
export type Kind = 'Alert' | 'Episode'

// 목록 필터에 노출하는 탐지 유형 10종(사용자 확정 순서)
export const patternOptions = ['NORMAL', 'FAN_OUT', 'FAN_IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK', 'NON_PATTERN'] as const
export type Pattern = (typeof patternOptions)[number]
// 팀원 데이터에서 블록을 가져온 유형(NORMAL 제외)
export const blockPatterns = ['FAN_OUT', 'FAN_IN', 'CYCLE', 'GATHER-SCATTER', 'SCATTER-GATHER', 'BIPARTITE', 'STACK', 'RANDOM', 'NON_PATTERN'] as const

export const TODAY = new Date(2026, 8, 16)

// 위험도 10단계 스케일: 무채색(회색) → 쨍한 레드(#ff0000, oklch(0.628 0.2577 29.23)). 브랜드 규칙상 red는 이상거래·오류·고위험에만 쓴다.
// bucket 0(0~9점) 채도 0(순수 회색) → bucket 9(90~100점) 순수 레드. 채도 곡선은 지수 1.6으로 낮은 bucket은 확실히 회색으로 남는다.
const RISK_RED_L = 0.628, RISK_RED_C = 0.2577, RISK_RED_H = 29.23
const RISK_GRAY_L = 0.74
export const riskSteps: string[] = Array.from({ length: 10 }, (_, i) => {
  const t = i / 9
  const l = RISK_GRAY_L + (RISK_RED_L - RISK_GRAY_L) * t
  const c = RISK_RED_C * Math.pow(t, 1.6)
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${RISK_RED_H})`
})
export const riskTone = (score: number): string => riskSteps[Math.min(9, Math.max(0, Math.floor(score / 10)))]
// 경과일(age) 히트: 0일(회색) → 7일 이상(순수 레드), 그 사이는 선형. Alert/Episode 목록 "경과" 셀 색상에 사용.
// 경과일: 0일 회색 → 5일 이상 순수 빨강. 예시 데이터의 최대 경과가 5일이라 7일 기준이면 끝까지 빨개지지 않는다
export const ageTone = (days: number): string => riskSteps[Math.min(9, Math.max(0, Math.round(days / 5 * 9)))]

// deprecated-compat: risk 3단계 배지 등 기존 호출부가 계속 컴파일되도록 남겨둔 파생값. 새 코드는 riskTone(score)를 직접 쓸 것.
export const riskColor: Record<Risk, string> = { '고위험': riskTone(92), '중위험': riskTone(67), '저위험': riskTone(34) }

export type RecordItem = {
  id: string; kind: Kind; risk: Risk; score: number; pattern: Pattern; probability: number
  amount: number; count: number; accounts: number; owner: string; status: string; date: string; age: number
  title: string; episodeId?: string; alertIds?: string[]
}
export type FilterField = 'risk' | 'owner' | 'status' | 'pattern' | 'age'
export type Filter = { field: FilterField; value: string }

export const usd = (n: number) => '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
export const compactUsd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`
export const riskFor = (score: number): Risk => score >= 80 ? '고위험' : score >= 50 ? '중위험' : '저위험'
export const topPercent = (score: number) => Math.max(1, 100 - score)

/* ---------------------------------------------------------------- 관계 그래프 */

type SourceBlock = (typeof graphSource.blocks)[number]
export type GraphNode = {
  key: string; account: string; bank: string; entity: string; x: number; y: number
  core: boolean; bridge: boolean; hub: boolean; hubDegree: number; hop: number; synthetic: boolean
}
export type GraphTransaction = { id: string; at: string; usd: number; amount: number; currency: string; format: string; from: string; to: string; label: 0 | 1 }
export type GraphEdge = {
  key: string; s: string; t: string; label: 0 | 1; count: number; usd: number; currency: string; format: string
  first: string; last: string; bridgePath: boolean; synthetic: boolean; transactions: GraphTransaction[]
}
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[]; blocks: number[] }

export const graphMeta = graphSource.meta
export const sourceBlocks = graphSource.blocks

function blockModel(block: SourceBlock, offsetX = 0): GraphModel {
  const prefix = `${block.sourceBlock}:`
  const nodes = block.nodes.map((n, i) => ({ ...n, key: prefix + i, account: n.id, x: n.x + offsetX }))
  const edges = block.edges.map(e => {
    const s = prefix + e.s, t = prefix + e.t
    return {
      key: e.id, s, t, label: e.label as 0 | 1, count: e.count, usd: e.usd, currency: e.currency, format: e.format,
      first: e.first, last: e.last, bridgePath: e.bridgePath, synthetic: e.synthetic,
      transactions: e.transactions.map(tx => ({ ...tx, currency: e.currency, format: e.format, from: s, to: t, label: e.label as 0 | 1 })),
    }
  })
  return { nodes: nodes.map(({ id: _id, ...n }) => n), edges, blocks: [block.sourceBlock] }
}

const blockByPattern = new Map(sourceBlocks.map(b => [b.pattern, b]))
export const blockFor = (pattern: Pattern) => blockByPattern.get(pattern) ?? sourceBlocks[0]

export function mergeModels(models: GraphModel[]): GraphModel {
  return { nodes: models.flatMap(m => m.nodes), edges: models.flatMap(m => m.edges), blocks: models.flatMap(m => m.blocks) }
}

export function graphFor(record: RecordItem, all: RecordItem[] = records): GraphModel {
  if (record.kind === 'Alert') return blockModel(blockFor(record.pattern))
  // Episode: 연결 Alert의 서로 다른 패턴 블록을 옆으로 이어 붙인다(최대 2개)
  const patterns = [...new Set((record.alertIds ?? []).map(id => all.find(r => r.id === id)?.pattern).filter(Boolean) as Pattern[])]
  const picked = (patterns.length ? patterns : [record.pattern]).slice(0, 2)
  return mergeModels(picked.map((p, i) => blockModel(blockFor(p), i * 2.2)))
}

export const laundering = (model: GraphModel) => model.edges.filter(e => e.label === 1).flatMap(e => e.transactions)

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

// 금액(USD) → 선 굵기. 패널에 보이는 엣지들의 min~max 범위를 제곱근 척도로 1.2~14px에 매핑해
// 화면에 실제로 보이는 값들 사이에서 굵기 차이가 뚜렷하게 드러나게 한다(로그 척도는 너무 완만했다).
export const widthFor = (value: number, min: number, max: number) => {
  if (!(max - min > 1e-6)) return (1.2 + 14) / 2
  const t = Math.sqrt((Math.min(max, Math.max(min, value)) - min) / (max - min))
  return 1.2 + t * (14 - 1.2)
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

/* ---------------------------------------------------------------- 업무 레코드 */

const titles: Record<Pattern, string> = {
  NORMAL: '정상 범위 거래', FAN_OUT: '한 계좌에서 다수 계좌로 분산 송금', FAN_IN: '다수 계좌에서 한 계좌로 집중 입금',
  CYCLE: '연결 계좌 간 순환 거래', 'GATHER-SCATTER': '집중 입금 후 다수 계좌로 재분산', 'SCATTER-GATHER': '분산 송금 후 한 계좌로 재집결',
  BIPARTITE: '두 계좌 집단 간 교차 이체', STACK: '중계 계좌를 겹겹이 경유한 이동', RANDOM: '불규칙 경로의 연쇄 이체', NON_PATTERN: '패턴 외 세탁 거래 묶음',
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function alertAt(i: number): RecordItem {
  const pattern = blockPatterns[i % blockPatterns.length]
  const model = blockModel(blockFor(pattern)), tx = laundering(model)
  const lastDay = Math.max(...tx.map(t => Number(t.at.slice(8, 10))))
  const day = Math.min(16, lastDay + (i % 3)), score = [92, 88, 81, 74, 67, 58, 46, 34][i % 8]
  const status = i % 7 === 6 ? '종결' : i % 4 === 0 ? '신규' : '검토 중'
  return {
    id: `ALT-2026-${1842 - i}`, kind: 'Alert', risk: riskFor(score), score, pattern, probability: [87, 76, 62, 91, 83, 69][i % 6],
    amount: tx.reduce((s, t) => s + t.usd, 0), count: tx.length, accounts: model.nodes.filter(n => n.core).length,
    owner: i % 4 === 1 ? '김조사' : '오검토', status, date: iso(new Date(2026, 8, day)), age: 16 - day, title: titles[pattern],
  }
}
const alerts = Array.from({ length: 22 }, (_, i) => alertAt(i))
const episodes: RecordItem[] = Array.from({ length: 10 }, (_, i) => {
  const linked = alerts.filter((_, j) => j % 10 === i || (j + 3) % 11 === i).slice(0, 3)
  linked.forEach(a => { a.episodeId ??= `EP-2026-${328 - i}` })
  const lead = linked.slice().sort((a, b) => b.score - a.score)[0] ?? alerts[i]
  return {
    id: `EP-2026-${328 - i}`, kind: 'Episode', risk: lead.risk, score: lead.score, pattern: lead.pattern, probability: lead.probability,
    amount: linked.reduce((s, a) => s + a.amount, 0), count: linked.reduce((s, a) => s + a.count, 0), accounts: linked.reduce((s, a) => s + a.accounts, 0),
    owner: i % 4 === 1 ? '박분석' : '안분석', status: i % 7 === 6 ? '종결' : i % 4 === 0 ? '신규' : '조사 중',
    date: lead.date, age: lead.age, title: `${titles[lead.pattern]} 외 ${Math.max(0, linked.length - 1)}건`, alertIds: linked.map(a => a.id),
  }
})
export const records: RecordItem[] = [...alerts, ...episodes]

export const ageOptions = ['1', '3', '7', '14', '30']
export function matches(r: RecordItem, filters: Filter[], query: string, start?: Date, end?: Date) {
  const day = new Date(r.date + 'T12:00:00')
  const q = query.trim().toLowerCase()
  return filters.every(f => f.field === 'age' ? r.age >= Number(f.value) : String(r[f.field]) === f.value)
    && (!q || `${r.id} ${r.title} ${r.owner} ${r.pattern}`.toLowerCase().includes(q))
    && (!start || day >= new Date(start.getFullYear(), start.getMonth(), start.getDate()))
    && (!end || day < new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1))
}
export const canClose = (actor: string, owner: string, reason: string) => actor === owner && reason.trim().length > 0

/* ---------------------------------------------------------------- 정렬 */

export type SortDirection = 'desc' | 'asc' | null
// 같은 열을 누를 때: 미정렬 → 내림차순 → 오름차순 → 미정렬(사용자 확정)
export const nextSort = (direction: SortDirection): SortDirection => direction === null ? 'desc' : direction === 'desc' ? 'asc' : null
export function sortRows<T>(rows: T[], key: keyof T | null, direction: SortDirection) {
  if (!key || !direction) return rows
  return rows.slice().sort((a, b) => {
    const av = a[key], bv = b[key]
    const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ko')
    return direction === 'asc' ? c : -c
  })
}
