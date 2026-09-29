import { describe, expect, it } from 'vitest'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import { loadMockEpisode } from '@/mocks/episodes'
import { toGraphModel } from './adapter'
import { isSuspiciousEdge } from './graphStyle'
import { neighborhood, stepTimeline, timelineEvents } from './v24/model'

describe('관계 그래프 mock (API.md §3.2)', () => {
  it('엣지는 두 계좌 사이 거래를 묶고, 거래 수·금액 합이 구성 거래와 같다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    expect(graph.edges.reduce((s, e) => s + e.txCount, 0)).toBe(detail.transactions.length)
    expect(graph.edges.reduce((s, e) => s + e.totalAmountUsd, 0)).toBe(detail.transactions.reduce((s, t) => s + t.amountUsd, 0))
  })

  it('모든 노드는 엣지에 닿아 있고, 엣지 끝은 모두 노드다', async () => {
    const { graph } = await loadMockEpisode(800, undefined, 'normal')
    const ids = new Set(graph.nodes.map(n => n.id))
    for (const e of graph.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true) }
    for (const n of graph.nodes) expect(graph.edges.some(e => e.from === n.id || e.to === n.id)).toBe(true)
  })

  it('임계 0.5 이상이면 의심 거래 색', () => {
    expect(isSuspiciousEdge({ maxScore: 0.5 })).toBe(true)
    expect(isSuspiciousEdge({ maxScore: 0.49 })).toBe(false)
  })
})

describe('v24 그래프 모양으로 변환', () => {
  it('엣지마다 개별 거래를 서울 시각으로 들고 있어 시간순 재생이 된다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    const model = toGraphModel(graph, detail.transactions)
    expect(model.edges.flatMap(e => e.transactions)).toHaveLength(detail.transactions.length)
    for (const e of model.edges) expect(e.transactions.length).toBe(e.count)
    const events = timelineEvents(model.edges)
    expect(events.length).toBeGreaterThan(0)
    expect(stepTimeline(events, events[0], 1)).toBe(events[1] ?? events[0])
    expect(model.edges[0].first).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('소유주 이름(FE 제안)이 있으면 소유주별 보기에 쓰인다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    const model = toGraphModel(graph, detail.transactions)
    expect(model.nodes.every(n => n.entity.length > 0)).toBe(true)
  })

  it('선택 계좌에서 hop 이내 계좌만 고른다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    const model = toGraphModel(graph, detail.transactions)
    const subject = detail.subjectAccount.account
    expect(neighborhood(model, subject, 1).size).toBe(model.nodes.length)
    expect([...neighborhood(model, subject, 0)]).toEqual([subject])
  })
})

describe('사람의 거래 판정 전환 (FE 제안)', async () => {
  const { focusTransactions } = await import('./relabel')
  it('정상 거래 하나를 이상으로 바꾸면 그 선과 양쪽 계좌가 의심 색이 되고, 모델 판정은 남는다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    const normal = detail.transactions.find(t => !t.isSuspicious)!
    const before = toGraphModel(graph, detail.transactions)
    const after = toGraphModel(graph, detail.transactions, { [normal.txId]: { label: 1, reason: '증빙 없음', at: '2026-09-28T10:00:00Z', actor: '오분석' } })
    const tx = after.edges.flatMap(e => e.transactions).find(t => t.id === String(normal.txId))!
    expect(tx).toMatchObject({ label: 1, modelLabel: 0, relabel: { reason: '증빙 없음' } })
    const edge = after.edges.find(e => e.transactions.includes(tx))!
    expect(edge.label).toBe(1)
    for (const key of [normal.fromAccount, normal.toAccount]) expect(after.nodes.find(n => n.key === key)?.core).toBe(true)
    expect(before.edges.flatMap(e => e.transactions).find(t => t.id === String(normal.txId))?.label).toBe(0)
  })

  it('계좌를 고르면 그 계좌에 닿은 거래를, 선을 고르면 두 계좌 사이 양방향 거래를 보여 준다', async () => {
    const { detail, graph } = await loadMockAlertDetail(3000, 'normal')
    const model = toGraphModel(graph, detail.transactions)
    const subject = detail.subjectAccount.account
    expect(focusTransactions(model, { kind: 'node', key: subject })).toHaveLength(detail.transactions.filter(t => t.fromAccount === subject || t.toAccount === subject).length)
    const t = detail.transactions[0]
    expect(focusTransactions(model, { kind: 'edge', s: t.toAccount, t: t.fromAccount }).map(r => r.id)).toContain(String(t.txId))
  })
})
