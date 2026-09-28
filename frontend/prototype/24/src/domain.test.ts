import { describe, expect, it } from 'vitest'
import { blockPatterns, canClose, graphFor, laundering, matches, minutes, neighborhood, nextSort, records, sortRows, sourceBlocks, stepTimeline, timelineEvents, TODAY, widthFor } from './domain'
import { monthIndex, presets } from './shared'

describe('업무 목록', () => {
  it('필터는 AND로 누적된다', () => {
    const filtered = records.filter(r => matches(r, [{ field: 'risk', value: '고위험' }, { field: 'owner', value: '오검토' }], ''))
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(r => r.risk === '고위험' && r.owner === '오검토')).toBe(true)
    expect(records.filter(r => matches(r, [], 'impossible'))).toHaveLength(0)
  })
  it('기간은 시작·종료일을 포함해 실제 건수를 줄인다', () => {
    const alerts = records.filter(r => r.kind === 'Alert')
    const inRange = alerts.filter(r => matches(r, [], '', new Date(2026, 8, 14), new Date(2026, 8, 16)))
    expect(inRange.length).toBeGreaterThan(0)
    expect(inRange.length).toBeLessThan(alerts.length)
    expect(inRange.every(r => r.date >= '2026-09-14' && r.date <= '2026-09-16')).toBe(true)
  })
  it('정렬은 미정렬 → 내림차순 → 오름차순 → 미정렬로 순환한다', () => {
    expect([null, 'desc', 'asc'].map(d => nextSort(d as never))).toEqual(['desc', 'asc', null])
    const rows = [{ v: 2 }, { v: 9 }, { v: 5 }]
    expect(sortRows(rows, 'v', 'desc').map(r => r.v)).toEqual([9, 5, 2])
    expect(sortRows(rows, 'v', 'asc').map(r => r.v)).toEqual([2, 5, 9])
    expect(sortRows(rows, 'v', null)).toBe(rows)
  })
  it('종결은 담당자와 판단 근거가 모두 있어야 한다', () => {
    expect(canClose('오검토', '오검토', '   ')).toBe(false)
    expect(canClose('안분석', '오검토', '근거')).toBe(false)
    expect(canClose('오검토', '오검토', '근거')).toBe(true)
  })
})

describe('팀원 데이터 기반 관계 그래프', () => {
  it('8종 패턴과 패턴 외에서 블록을 1개씩만 가져온다', () => {
    expect(sourceBlocks.map(b => b.pattern).sort()).toEqual([...blockPatterns].sort())
  })
  it('원본 1홉은 그대로, 2·3홉만 합성으로 표시한다', () => {
    for (const block of sourceBlocks) {
      expect(block.nodes.filter(n => n.hop <= 1).every(n => !n.synthetic)).toBe(true)
      expect(block.nodes.filter(n => n.hop >= 2).every(n => n.synthetic)).toBe(true)
      expect(block.nodes.some(n => n.hop === 2)).toBe(true)
      expect(block.edges.filter(e => e.label === 1).every(e => !e.synthetic)).toBe(true)
    }
  })
  it('모든 Alert는 유형이 같은 블록의 의심 거래로 금액·건수를 계산한다', () => {
    for (const r of records.filter(x => x.kind === 'Alert')) {
      const model = graphFor(r), tx = laundering(model)
      expect(model.blocks).toHaveLength(1)
      expect(sourceBlocks.find(b => b.sourceBlock === model.blocks[0])!.pattern).toBe(r.pattern)
      expect(tx.length).toBe(r.count)
      expect(tx.reduce((s, t) => s + t.usd, 0)).toBeCloseTo(r.amount, 2)
      const keys = new Set(model.nodes.map(n => n.key))
      expect(model.edges.every(e => keys.has(e.s) && keys.has(e.t))).toBe(true)
    }
  })
  it('Episode는 연결 Alert의 서로 다른 패턴 블록을 합친다', () => {
    const episode = records.find(r => r.kind === 'Episode' && new Set((r.alertIds ?? []).map(id => records.find(a => a.id === id)!.pattern)).size >= 2)!
    const model = graphFor(episode)
    expect(model.blocks.length).toBe(2)
    expect(new Set(model.nodes.map(n => n.key)).size).toBe(model.nodes.length)
  })
  it('hop 범위는 1 ⊂ 2 ⊂ 3으로 넓어진다', () => {
    const model = graphFor(records[0]), start = model.nodes.find(n => n.core)!.key
    const [one, two, three] = [1, 2, 3].map(h => neighborhood(model, start, h))
    expect([...one].every(k => two.has(k)) && [...two].every(k => three.has(k))).toBe(true)
    expect(one.size).toBeLessThan(three.size)
  })
  it('금액이 클수록 선(균일 굵기)·화살촉이 패널 안 min~max 기준(로그 척도)으로 확연히 굵어진다', () => {
    const amounts = [10, 1_000, 100_000, 10_000_000]
    const widths = amounts.map(a => widthFor(a, 10, 10_000_000))
    expect(widths[0]).toBeCloseTo(1, 5); expect(widths[3]).toBeCloseTo(12, 5)
    expect(widths.every((w, i) => i === 0 || w > widths[i - 1])).toBe(true)
    expect(widthFor(5, 5, 5)).toBeCloseTo(3, 5) // min===max: 중간값
  })
  it('시간축은 거래 시각 순서로 한 단계씩 앞뒤로 이동한다', () => {
    const events = timelineEvents(graphFor(records[0]).edges)
    expect(events).toEqual([...new Set(events)].sort((a, b) => a - b))
    expect(stepTimeline(events, events[0] - 1, 1)).toBe(events[0])
    expect(stepTimeline(events, events[2], -1)).toBe(events[1])
    expect(stepTimeline(events, events[0], -1)).toBe(events[0] - 1)
    expect(stepTimeline(events, events.at(-1)!, 1)).toBe(events.at(-1))
    expect(minutes('2026-09-01 00:01') - minutes('2026-09-01 00:00')).toBe(1)
  })
})

describe('기간 선택 preset', () => {
  it('모든 preset은 오늘에서 끝나고 달력은 그 달(9월)로 이동한다', () => {
    for (const p of presets) expect(p.range().to).toEqual(TODAY)
    expect(monthIndex(TODAY)).toBe(8)
  })
})

describe('화면 간 메모리 상태', () => {
  it('setter 호출 즉시 저장되어 unmount 뒤 다시 열어도 유지된다', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement, useEffect } = await import('react')
    const { useMemoryState } = await import('./memory')
    let setter: ((v: string[]) => void) | undefined
    const Probe = () => { const [v, set] = useMemoryState<string[]>('test:read', []); setter = set; return createElement('span', null, v.join(',')) }
    renderToStaticMarkup(createElement(Probe))
    setter!(['ALT-1'])
    expect(renderToStaticMarkup(createElement(Probe))).toContain('ALT-1')
    void useEffect
  })
})
