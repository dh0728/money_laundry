// UI 재설계 §6.2 시간순 배치 규칙(10/6 팀 결정, 시간축 방향은 김명기).
// 1. 거래를 시각 → txId로 정렬한다. 2. 처음 나온 순서대로 계좌에 번호. 3. 계좌의 한 "등장"은 받는 구간 → 보내는 구간,
// 보내기 시작한 계좌가 다시 받으면 새 등장(상한 넘으면 마지막 등장에 모음). 4. 시각마다 [보내는 자리, 받는 자리] 두 칸.
// 받은 등장은 마지막 수취 시각의 받는 자리, 보내기만 한 등장은 첫 송금 시각의 보내는 자리 → 모든 선이 왼쪽→오른쪽(같은 칸이면 동시각 세로선).
export type TimeTx = {
  txId: number; txAt: string; fromAccount: string; toAccount: string; fromBank: number; toBank: number
  amountUsd: number; amountPaid: number; paymentCurrency: string; launderingScore: number; alertId?: number
  /** FE 제안 필드(API 확정 전). 없으면 소유주 보기에서 계좌마다 따로 묶인다 */
  fromOwnerName?: string; toOwnerName?: string
}
export type Appearance = { id: string; account: string; n: number; nth: number; col: number; recv: TimeTx[]; send: TimeTx[]; folded: number }
export type Bundle = { id: string; source: string; target: string; txs: TimeTx[]; sumUsd: number; maxScore: number; sameTime: boolean; folded: boolean }
export type Timeline = { tx: TimeTx[]; numbers: Map<string, number>; apps: Appearance[]; bundles: Bundle[]; times: number[]; gaps: { afterIndex: number; days: number }[]; violations: number }

export const REAPPEAR_CAP = 5 // 출발점(측정 뒤 확정)

export function buildTimeline(rows: TimeTx[], cap = REAPPEAR_CAP): Timeline {
  const tx = [...new Map(rows.map(r => [r.txId, r])).values()].sort((a, b) => Date.parse(a.txAt) - Date.parse(b.txAt) || a.txId - b.txId)
  const numbers = new Map<string, number>()
  for (const t of tx) for (const acc of [t.fromAccount, t.toAccount]) if (!numbers.has(acc)) numbers.set(acc, numbers.size + 1)

  const apps: Appearance[] = [], current = new Map<string, Appearance>(), lastSendAt = new Map<string, number>()
  const src = new Map<number, Appearance>(), dst = new Map<number, Appearance>(), foldedTx = new Set<number>()
  const open = (acc: string) => { const nth = apps.filter(a => a.account === acc).length + 1; const a: Appearance = { id: `${acc}#${nth}`, account: acc, n: numbers.get(acc)!, nth, col: 0, recv: [], send: [], folded: 0 }; apps.push(a); current.set(acc, a); return a }
  for (const t of tx) {
    const at = Date.parse(t.txAt)
    const s = current.get(t.fromAccount) ?? open(t.fromAccount)
    s.send.push(t); src.set(t.txId, s); lastSendAt.set(t.fromAccount, Math.max(lastSendAt.get(t.fromAccount) ?? -Infinity, at))
    let r = current.get(t.toAccount)
    // 보내기 시작한 뒤(같은 시각 제외) 다시 받으면 새 등장
    if (!r || (r.send.length && (lastSendAt.get(t.toAccount) ?? -Infinity) < at)) {
      const count = apps.filter(a => a.account === t.toAccount).length
      if (r && count >= cap) { r.folded += 1; foldedTx.add(t.txId); dst.set(t.txId, r); continue }
      r = open(t.toAccount)
    }
    r.recv.push(t); dst.set(t.txId, r)
  }

  const times = [...new Set(tx.map(t => Date.parse(t.txAt)))].sort((a, b) => a - b)
  const slot = (iso: string, kind: 'send' | 'recv') => times.indexOf(Date.parse(iso)) * 2 + (kind === 'recv' ? 1 : 0)
  for (const a of apps) a.col = a.recv.length ? slot(a.recv[a.recv.length - 1].txAt, 'recv') : slot(a.send[0].txAt, 'send')

  const map = new Map<string, Bundle>()
  for (const t of tx) {
    const s = src.get(t.txId)!, d = dst.get(t.txId)!, key = `${s.id}>${d.id}`
    const b = map.get(key) ?? { id: key, source: s.id, target: d.id, txs: [], sumUsd: 0, maxScore: 0, sameTime: s.col === d.col, folded: false }
    if (foldedTx.has(t.txId)) b.folded = true
    b.txs.push(t); b.sumUsd += Number.isFinite(t.amountUsd) ? t.amountUsd : 0; b.maxScore = Math.max(b.maxScore, t.launderingScore ?? 0); map.set(key, b)
  }
  const bundles = [...map.values()]
  const byId = new Map(apps.map(a => [a.id, a]))
  // 상한을 넘어 마지막 등장에 모은 거래는 예외(단일 계좌 상세로 보낸다)
  const violations = bundles.filter(b => !b.folded && byId.get(b.source)!.col > byId.get(b.target)!.col).length
  const gaps = times.slice(1).map((t, i) => ({ afterIndex: i, days: Math.floor((t - times[i]) / 864e5) })).filter(g => g.days >= 1)
  return { tx, numbers, apps, bundles, times, gaps, violations }
}

/** 계좌마다 고정 행(swimlane). 처음 등장한 순서(번호)대로 위→아래. 다시 등장해도 같은 행이라 한 줄로 따라 읽힌다(김명기 10/12) */
export const LANE = 76
export const laneY = (n: number, lane = LANE) => (n - 1) * lane

/** 열 번호 → x 좌표. 하루 넘게 떨어지면 간격을 더 둔다 */
export function columnX(col: number, gaps: Timeline['gaps'], timeWidth = 190) {
  const timeIndex = Math.floor(col / 2)
  const extra = gaps.filter(g => g.afterIndex < timeIndex).length * 56
  // 한 시각 안에서 보내는 자리와 받는 자리 사이는 시간 칸의 2/3
  return timeIndex * timeWidth + (col % 2) * Math.round(timeWidth * 0.66) + extra
}

// ── 간격 결정(김명기 10/12): 모든 연결선은 베지어. 선이 나란히 붙거나 라벨·노드가 겹치면 노드 간격을 벌린다 ──
export const NODE_SIZE = 48 // 번호 글자가 읽히도록 키움(10/12)

// ── 소유주 보기(김명기 10/12): dev의 소유주 상자(머리글 + 계좌 행)를 시간 배치에 옮긴 것. 같은 소유주의 계좌 행을 이어 붙여 상자로 감싼다 ──
export type LaneView = 'account' | 'owner'
export const OWNER_HEAD = 32, OWNER_PAD = 10, OWNER_GAP = 14
export type OwnerGroup = { key: string; name: string; known: boolean; accounts: string[] }
export type OwnerBox = { group: OwnerGroup; top: number; height: number }
export type LanePlan = { groups: OwnerGroup[]; yOf: (account: string, lane: number) => number; boxes: (lane: number) => OwnerBox[] }

/** 계좌 보기: 번호대로 한 줄씩. 소유주 보기: 소유주가 처음 나온 순서대로 상자, 상자 안은 계좌 번호순 */
export function lanePlan(g: Pick<Timeline, 'tx' | 'numbers'>, view: LaneView): LanePlan {
  if (view === 'account') return { groups: [], yOf: (acc, lane) => laneY(g.numbers.get(acc)!, lane), boxes: () => [] }
  const ownerOf = new Map<string, string>()
  for (const t of g.tx) { if (t.fromOwnerName) ownerOf.set(t.fromAccount, t.fromOwnerName); if (t.toOwnerName) ownerOf.set(t.toAccount, t.toOwnerName) }
  const groups: OwnerGroup[] = [], byKey = new Map<string, OwnerGroup>(), where = new Map<string, { gi: number; k: number }>()
  for (const [acc] of [...g.numbers].sort((a, b) => a[1] - b[1])) {
    const name = ownerOf.get(acc), key = name ? `owner:${name}` : `account:${acc}`
    let grp = byKey.get(key)
    if (!grp) { grp = { key, name: name ?? '소유주 미상', known: Boolean(name), accounts: [] }; byKey.set(key, grp); groups.push(grp) }
    where.set(acc, { gi: groups.indexOf(grp), k: grp.accounts.length }); grp.accounts.push(acc)
  }
  const cache = new Map<number, OwnerBox[]>()
  const boxes = (lane: number) => {
    let hit = cache.get(lane)
    if (!hit) { let top = 0; hit = groups.map(group => { const height = OWNER_HEAD + OWNER_PAD * 2 + (group.accounts.length - 1) * lane + NODE_SIZE; const box = { group, top, height }; top += height + OWNER_GAP; return box }); cache.set(lane, hit) }
    return hit
  }
  return { groups, boxes, yOf: (acc, lane) => { const w = where.get(acc)!; return boxes(lane)[w.gi].top + OWNER_HEAD + OWNER_PAD + w.k * lane } }
}
type Pt = [number, number]
type Pos = { x: number; y: number }
// @xyflow/system getBezierPath와 같은 제어점(curvature 0.25)
const offset = (d: number) => d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d)
export function edgeCurve(s: Pos, t: Pos, vertical: boolean): [Pt, Pt, Pt, Pt] {
  const N = NODE_SIZE
  if (!vertical) {
    const sx = s.x + N, sy = s.y + N / 2, tx = t.x, ty = t.y + N / 2
    return [[sx, sy], [sx + offset(tx - sx), sy], [tx - offset(tx - sx), ty], [tx, ty]]
  }
  const x1 = s.x + N / 2, x2 = t.x + N / 2
  if (t.y >= s.y) { const sy = s.y + N, ty = t.y; return [[x1, sy], [x1, sy + offset(ty - sy)], [x2, ty - offset(ty - sy)], [x2, ty]] }
  const sy = s.y, ty = t.y + N
  return [[x1, sy], [x1, sy - offset(sy - ty)], [x2, ty + offset(sy - ty)], [x2, ty]]
}
const at = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}
const SAMPLES = 32, CLOSE = 14, RUN = 4, LABEL_W = 100, LABEL_H = 24

export type Spacing = { timeWidth: number; lane: number; positions: Map<string, Pos>; conflicts: number }

/** 같은 입력이면 같은 간격. 충돌 0이 되는 가장 작은 간격, 끝까지 안 되면 가장 넓은 간격과 남은 충돌 수 */
export function chooseSpacing(g: Pick<Timeline, 'apps' | 'bundles' | 'gaps'>, steps = 10, yOf?: LanePlan['yOf']): Spacing {
  let last: Spacing | null = null
  for (let k = 0; k <= steps; k++) {
    const timeWidth = 190 + 24 * k, lane = 76 + 12 * k
    const positions = new Map(g.apps.map(a => [a.id, { x: columnX(a.col, g.gaps, timeWidth), y: yOf ? yOf(a.account, lane) : laneY(a.n, lane) }]))
    last = { timeWidth, lane, positions, conflicts: countConflicts(g.bundles, positions) }
    if (last.conflicts === 0) return last
  }
  return last!
}

export function countConflicts(bundles: Bundle[], positions: Map<string, Pos>) {
  const N = NODE_SIZE
  const edges = bundles.filter(b => b.source !== b.target).map(b => {
    const curve = edgeCurve(positions.get(b.source)!, positions.get(b.target)!, b.sameTime)
    const pts = Array.from({ length: SAMPLES + 1 }, (_, i) => at(curve, i / SAMPLES))
    const [lx, ly] = at(curve, 0.5)
    return { b, pts, label: { l: lx - LABEL_W / 2, r: lx + LABEL_W / 2, t: ly - LABEL_H / 2, bt: ly + LABEL_H / 2 } }
  })
  const nodes = [...positions].map(([id, p]) => ({ id, l: p.x, r: p.x + N, t: p.y, bt: p.y + N }))
  const hit = (a: { l: number; r: number; t: number; bt: number }, b: typeof a) => a.l < b.r && b.l < a.r && a.t < b.bt && b.t < a.bt
  let conflicts = 0
  for (let i = 0; i < edges.length; i++) {
    const A = edges[i]
    // 라벨·선이 끝점이 아닌 계좌 원을 덮음
    for (const n of nodes) {
      if (n.id === A.b.source || n.id === A.b.target) continue
      if (hit(A.label, n) || A.pts.some(([x, y]) => x > n.l + 4 && x < n.r - 4 && y > n.t + 4 && y < n.bt - 4)) conflicts++
    }
    for (let j = i + 1; j < edges.length; j++) {
      const B = edges[j]
      if (hit(A.label, B.label)) conflicts++
      const shared = [A.b.source, A.b.target].filter(id => id === B.b.source || id === B.b.target).map(id => positions.get(id)!)
      const nearShared = ([x, y]: Pt) => shared.some(p => Math.hypot(x - (p.x + N / 2), y - (p.y + N / 2)) < 56)
      // 한 점 교차는 괜찮다. 곡선 길이의 1/8 이상을 붙어 달리면 충돌
      let run = 0, worst = 0
      for (const pa of A.pts) {
        if (nearShared(pa)) { run = 0; continue }
        const close = B.pts.some(pb => Math.abs(pa[0] - pb[0]) < CLOSE && Math.abs(pa[1] - pb[1]) < CLOSE && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < CLOSE)
        run = close ? run + 1 : 0; worst = Math.max(worst, run)
      }
      if (worst >= RUN) conflicts++
    }
  }
  return conflicts
}

// ── 패턴 보기(김명기 10/12): 시간축을 빼고 "모양"에 집중. 가로는 돈이 흐르는 순서(보내는 쪽 → 받는 쪽 층), 세로는 이웃 평균 높이.
// 집중 수취는 한 점으로 모이고, 분산 송금은 퍼지고, gather-scatter는 마름모가 된다. 원래 패턴 = 이 템플릿 배치 ──
export const TEMPLATE_GAP_X = 260, TEMPLATE_GAP_Y = 96

/** 층(layer) = 보내는 계좌에서 시작한 가장 긴 흐름의 깊이(되돌아오는 선은 무시). 같은 입력이면 같은 결과 */
function layoutOne(tx: Pick<TimeTx, 'fromAccount' | 'toAccount'>[], order: string[]): Map<string, { x: number; y: number; layer: number }> {
  const out = new Map<string, Set<string>>(order.map(a => [a, new Set()])), indeg = new Map(order.map(a => [a, 0]))
  const pairs = new Set<string>()
  for (const t of tx) if (t.fromAccount !== t.toAccount && out.has(t.fromAccount) && out.has(t.toAccount)) pairs.add(`${t.fromAccount}\u0000${t.toAccount}`)
  for (const p of pairs) { const [a, b] = p.split('\u0000'); out.get(a)!.add(b); indeg.set(b, indeg.get(b)! + 1) }
  // DFS로 되돌아오는 선(순환을 만드는 선)을 가려낸다. 시작은 받기만 하는 곳이 아닌, 보내기만 하는 계좌부터
  const state = new Map<string, 0 | 1 | 2>(), back = new Set<string>()
  const dfs = (a: string) => { state.set(a, 1); for (const b of out.get(a)!) { if (state.get(b) === 1) back.add(`${a}\u0000${b}`); else if (!state.get(b)) dfs(b) } state.set(a, 2) }
  for (const a of [...order].sort((x, y) => (indeg.get(x)! === 0 ? 0 : 1) - (indeg.get(y)! === 0 ? 0 : 1) || order.indexOf(x) - order.indexOf(y))) if (!state.get(a)) dfs(a)
  const dag = new Map(order.map(a => [a, [...out.get(a)!].filter(b => !back.has(`${a}\u0000${b}`))]))
  const layer = new Map(order.map(a => [a, 0])), ind = new Map(order.map(a => [a, 0]))
  for (const a of order) for (const b of dag.get(a)!) ind.set(b, ind.get(b)! + 1)
  const queue = order.filter(a => ind.get(a) === 0)
  for (let k = 0; k < queue.length; k++) for (const b of dag.get(queue[k])!) { layer.set(b, Math.max(layer.get(b)!, layer.get(queue[k])! + 1)); ind.set(b, ind.get(b)! - 1); if (ind.get(b) === 0) queue.push(b) }
  const cols = new Map<number, string[]>()
  for (const a of order) cols.set(layer.get(a)!, [...(cols.get(layer.get(a)!) ?? []), a])
  const y = new Map<string, number>()
  for (const col of cols.values()) col.forEach((a, i) => y.set(a, (i - (col.length - 1) / 2) * TEMPLATE_GAP_Y))
  const nb = new Map(order.map(a => [a, [] as string[]]))
  for (const p of pairs) { const [a, b] = p.split('\u0000'); nb.get(a)!.push(b); nb.get(b)!.push(a) }
  for (let sweep = 0; sweep < 14; sweep++) for (const col of cols.values()) {
    const want = new Map(col.map(a => { const ns = nb.get(a)!; return [a, ns.length ? ns.reduce((sum, n) => sum + y.get(n)!, 0) / ns.length : y.get(a)!] as const }))
    const sorted = [...col].sort((a, b) => want.get(a)! - want.get(b)! || order.indexOf(a) - order.indexOf(b))
    const mean = sorted.reduce((sum, a) => sum + want.get(a)!, 0) / sorted.length
    sorted.forEach((a, i) => y.set(a, mean + (i - (sorted.length - 1) / 2) * TEMPLATE_GAP_Y))
  }
  return new Map(order.map(a => [a, { x: layer.get(a)! * TEMPLATE_GAP_X, y: y.get(a)!, layer: layer.get(a)! }]))
}

/** 구조로 추정한 패턴 이름(모델 값이 아님). 3개 이상과 거래한 계좌가 있으면 집중 수취·분산 송금, 같은 계좌가 다시 나오면 순환 */
export function detectPatterns(g: Pick<Timeline, 'tx' | 'apps'>): string[] {
  const from = new Map<string, Set<string>>(), to = new Map<string, Set<string>>()
  for (const t of g.tx) { (to.get(t.toAccount) ?? to.set(t.toAccount, new Set()).get(t.toAccount)!).add(t.fromAccount); (from.get(t.fromAccount) ?? from.set(t.fromAccount, new Set()).get(t.fromAccount)!).add(t.toAccount) }
  const out: string[] = []
  if ([...to.values()].some(s => s.size >= 3)) out.push('집중 수취')
  if ([...from.values()].some(s => s.size >= 3)) out.push('분산 송금')
  if (g.apps.some(a => a.nth > 1)) out.push('순환·되돌아옴')
  return out
}

/** 끊어진 덩어리(연결 성분)마다 따로 배치한 뒤 격자로 나란히 놓는다: 세로 한 줄로 길어지지 않아 화면 맞춤 배율이 커진다 */
export function templateLayout(tx: Pick<TimeTx, 'fromAccount' | 'toAccount'>[], order: string[]): Map<string, { x: number; y: number; layer: number }> {
  const parent = new Map(order.map(a => [a, a]))
  const find = (a: string): string => parent.get(a) === a ? a : (parent.set(a, find(parent.get(a)!)), parent.get(a)!)
  for (const t of tx) if (parent.has(t.fromAccount) && parent.has(t.toAccount)) parent.set(find(t.fromAccount), find(t.toAccount))
  const groups = new Map<string, string[]>()
  for (const a of order) groups.set(find(a), [...(groups.get(find(a)) ?? []), a])
  const parts = [...groups.values()].sort((a, b) => b.length - a.length || order.indexOf(a[0]) - order.indexOf(b[0]))
  const laid = parts.map(members => { const set = new Set(members), pos = layoutOne(tx.filter(t => set.has(t.fromAccount) && set.has(t.toAccount)), members), xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y); return { pos, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), minX: Math.min(...xs), minY: Math.min(...ys) } })
  // 열마다 가장 넓은 덩어리, 행마다 가장 높은 덩어리만큼만 칸을 잡는다(덩어리 사이 간격은 좁게)
  const cols = Math.ceil(Math.sqrt(laid.length)), rows = Math.ceil(laid.length / cols)
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...laid.filter((_, i) => i % cols === c).map(l => l.w))), rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...laid.filter((_, i) => Math.floor(i / cols) === r).map(l => l.h)))
  const padX = TEMPLATE_GAP_X * 0.35, padY = TEMPLATE_GAP_Y * 0.7
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, w) => a + w + padX, 0)), rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, h) => a + h + padY, 0))
  const out = new Map<string, { x: number; y: number; layer: number }>()
  laid.forEach((l, i) => { const c = i % cols, r = Math.floor(i / cols), cx = colX[c] + colW[c] / 2, cy = rowY[r] + rowH[r] / 2; for (const [a, p] of l.pos) out.set(a, { x: cx + (p.x - l.minX - l.w / 2), y: cy + (p.y - l.minY - l.h / 2), layer: p.layer }) })
  return new Map(order.map(a => [a, out.get(a)!]))
}
