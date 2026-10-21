import { describe, expect, it } from 'vitest'
import { buildTimeline, chooseSpacing, countConflicts, detectPatterns, lanePlan, templateLayout, type Bundle, type TimeTx } from './timeLayout'

let id = 0
const t = (from: string, to: string, hour: number, usd = 1000): TimeTx => ({ txId: ++id, txAt: `2026-09-20T${String(hour).padStart(2, '0')}:00:00+09:00`, fromAccount: from, toAccount: to, fromBank: 1, toBank: 1, amountUsd: usd, amountPaid: usd, paymentCurrency: 'USD', launderingScore: 0.5 })

describe('§6.2 시간순 배치', () => {
  it('1→2→1이면 1이 오른쪽에 다시 나온다', () => {
    const g = buildTimeline([t('A', 'B', 9), t('B', 'A', 10)])
    expect(g.apps.filter(a => a.account === 'A')).toHaveLength(2)
    expect(g.violations).toBe(0)
  })
  it('집중 수취 10→1은 받는 계좌가 한 번만 나온다', () => {
    const g = buildTimeline(Array.from({ length: 10 }, (_, i) => t(`S${i}`, 'H', i)))
    expect(g.apps.filter(a => a.account === 'H')).toHaveLength(1)
    expect(g.violations).toBe(0)
  })
  it('분산 송금 1→10은 보내는 계좌가 한 번만 나온다', () => {
    const g = buildTimeline(Array.from({ length: 10 }, (_, i) => t('H', `R${i}`, i)))
    expect(g.apps.filter(a => a.account === 'H')).toHaveLength(1)
    expect(g.violations).toBe(0)
  })
  it('같은 시각에 받고 보내면 같은 등장 · 세로선', () => {
    const g = buildTimeline([t('A', 'B', 9), t('B', 'C', 9)])
    expect(g.apps.filter(a => a.account === 'B')).toHaveLength(1)
    expect(g.bundles.find(b => b.source.startsWith('B'))!.sameTime).toBe(true)
    expect(g.violations).toBe(0)
  })
  it('순환과 왔다 갔다 20회도 오른쪽→왼쪽 선이 없다', () => {
    expect(buildTimeline([t('A', 'B', 9), t('B', 'C', 10), t('C', 'A', 11)]).violations).toBe(0)
    const ping = buildTimeline(Array.from({ length: 20 }, (_, i) => i % 2 ? t('Y', 'X', i) : t('X', 'Y', i)))
    expect(ping.apps.filter(a => a.account === 'X').length).toBeLessThanOrEqual(5)
    expect(ping.violations).toBe(0)
  })
  it('끊긴 두 덩어리와 하루 넘는 간격', () => {
    const rows = [t('A', 'B', 9), { ...t('C', 'D', 9), txAt: '2026-09-23T09:00:00+09:00' }]
    const g = buildTimeline(rows)
    expect(g.gaps).toEqual([{ afterIndex: 0, days: 3 }])
  })
  it('같은 입력이면 번호·열이 같다(입력 순서와 무관)', () => {
    const rows = [t('A', 'B', 9), t('C', 'B', 10), t('B', 'D', 12)]
    const a = buildTimeline(rows), b = buildTimeline([...rows].reverse())
    expect([...a.numbers]).toEqual([...b.numbers])
    expect(a.apps.map(x => [x.id, x.col])).toEqual(b.apps.map(x => [x.id, x.col]))
  })
})

describe('소유주 보기 행 배치', () => {
  it('같은 소유주의 계좌가 한 상자 안에 이어 붙고, 상자는 겹치지 않는다', () => {
    const own = (from: string, to: string, hour: number, fo: string, to_: string): TimeTx => ({ ...t(from, to, hour), fromOwnerName: fo, toOwnerName: to_ })
    const g = buildTimeline([own('A1', 'B1', 9, '갑', '을'), own('B1', 'A2', 10, '을', '갑'), own('A2', 'C1', 11, '갑', '병')])
    const plan = lanePlan(g, 'owner')
    expect(plan.groups.map(x => [x.name, x.accounts])).toEqual([['갑', ['A1', 'A2']], ['을', ['B1']], ['병', ['C1']]])
    for (const lane of [76, 124]) {
      const boxes = plan.boxes(lane)
      boxes.slice(1).forEach((b, i) => expect(b.top).toBeGreaterThan(boxes[i].top + boxes[i].height))
      expect(plan.yOf('A2', lane) - plan.yOf('A1', lane)).toBe(lane)
    }
  })
  it('소유주 정보가 없으면 계좌마다 따로 묶는다', () => {
    const g = buildTimeline([t('A', 'B', 9)])
    expect(lanePlan(g, 'owner').groups.map(x => x.known)).toEqual([false, false])
  })
})

describe('패턴 보기', () => {
  it('집중 수취: 보내는 쪽 층 → 허브 층, 허브는 보내는 쪽들의 가운데 높이', () => {
    const g = buildTimeline(Array.from({ length: 4 }, (_, i) => t(`S${i}`, 'H', 9 + i)))
    const pos = templateLayout(g.tx, [...g.numbers.keys()])
    expect(pos.get('H')!.layer).toBe(1)
    const srcs = [...pos].filter(([a]) => a !== 'H').map(([, p]) => p)
    expect(srcs.every(p => p.layer === 0)).toBe(true)
    expect(Math.abs(pos.get('H')!.y - srcs.reduce((s, p) => s + p.y, 0) / srcs.length)).toBeLessThan(1)
    expect(detectPatterns(g)).toContain('집중 수취')
  })
  it('gather-scatter 모양과, 순환은 닫는 선 하나만 되돌아오는 선으로 취급', () => {
    const rows = [t('A', 'H', 9), t('B', 'H', 10), t('H', 'X', 11), t('H', 'Y', 12), t('X', 'A', 13)]
    const g = buildTimeline(rows), pos = templateLayout(g.tx, [...g.numbers.keys()])
    expect([pos.get('H')!.layer, pos.get('X')!.layer]).toEqual([1, 2])
    expect(pos.get('B')!.layer).toBe(0)
    expect(pos.get('A')!.layer).toBe(3)
  })
  it('같은 입력이면 같은 배치, 분산 송금·순환을 알아본다', () => {
    const rows = [t('H', 'A', 9), t('H', 'B', 10), t('H', 'C', 11), t('A', 'H', 12)]
    const g1 = buildTimeline(rows), g2 = buildTimeline([...rows].reverse())
    expect([...templateLayout(g1.tx, [...g1.numbers.keys()])]).toEqual([...templateLayout(g2.tx, [...g2.numbers.keys()])])
    expect(detectPatterns(g1)).toEqual(expect.arrayContaining(['분산 송금', '순환·되돌아옴']))
  })
})

describe('곡선 충돌 배치 보존', () => {
  it.each([[0, 3], [10, 3], [24, 2], [40, 0], [100, 0]])('곡선 간격 %d에서도 선·라벨·계좌 충돌 수를 보존한다', (y, expected) => {
    const edge = (source: string, target: string): Bundle => ({ id: source + target, source, target, txs: [], sumUsd: 1, maxScore: 0.5, sameTime: false, folded: false })
    const positions = new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 0 }], ['c', { x: 60, y }], ['d', { x: 110, y }]])
    expect(countConflicts([edge('a', 'b'), edge('c', 'd')], positions)).toBe(expected)
  })
  it('64거래의 기존 간격과 잔여 충돌 수를 유지한다', () => {
    const rows: TimeTx[] = Array.from({ length: 64 }, (_, i) => ({ ...t(`a${i % 33}`, `a${(i * 7 + 1) % 33}`, 0), txAt: new Date(Date.UTC(2023, 8, 1, 0, i)).toISOString(), fromOwnerId: `o${Math.floor(i % 33 / 2)}`, toOwnerId: `o${Math.floor(((i * 7 + 1) % 33) / 2)}` }))
    const g = buildTimeline(rows), plan = lanePlan(g, 'owner')
    expect(chooseSpacing(g, 10, plan.yOf)).toMatchObject({ timeWidth: 430, lane: 196, conflicts: 1 })
  })
})
