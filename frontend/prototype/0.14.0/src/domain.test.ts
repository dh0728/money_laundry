import { describe, expect, it } from 'vitest'
import { records, matches, nodes, edges, widthFor, neighborhood, selectGraph, canClose, transactions } from './domain'

describe('investigation fixtures and state', () => {
  it('accumulates independent filters with AND', () => {
    const filtered = records.filter(r => matches(r, [{field:'risk', value:'고위험'}, {field:'owner', value:'오검토'}], ''))
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(r => r.risk === '고위험' && r.owner === '오검토')).toBe(true)
    expect(records.filter(r => matches(r, [], 'impossible'))).toHaveLength(0)
  })
  it('has unique entities and valid graph references', () => {
    expect(new Set(records.map(r=>r.id)).size).toBe(records.length)
    expect(nodes.length).toBeGreaterThanOrEqual(25)
    expect(edges.every(e=>nodes.some(n=>n.id===e.a)&&nodes.some(n=>n.id===e.b))).toBe(true)
    expect(transactions.length).toBeGreaterThan(edges.length)
  })
  it('selects nodes and edges exclusively, resets hop to one', () => {
    expect(selectGraph({node:null,edge:'E01',hop:4},'node','A01')).toEqual({node:'A01',edge:null,hop:1})
    expect(selectGraph({node:'A01',edge:null,hop:2},'edge','E01')).toEqual({node:null,edge:'E01',hop:1})
  })
  it('expands reach monotonically and scales amount monotonically', () => {
    const near=neighborhood(nodes[0].id,1), far=neighborhood(nodes[0].id,4)
    expect([...near].every(id=>far.has(id))).toBe(true)
    expect(near.size).toBeLessThan(far.size)
    const widths=[1000,10000,100000,1000000].map(widthFor)
    expect(widths.every((w,i)=>i===0||w>widths[i-1])).toBe(true)
    expect(widths[3]-widths[0]).toBeGreaterThan(3)
  })
  it('requires rationale and responsible investigator for final closure', () => {
    expect(canClose('오검토','오검토','   ')).toBe(false)
    expect(canClose('안분석','오검토','정상 거래 근거 확인')).toBe(false)
    expect(canClose('오검토','오검토','정상 거래 근거 확인')).toBe(true)
  })
})
