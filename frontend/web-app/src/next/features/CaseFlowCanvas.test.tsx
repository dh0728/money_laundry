import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElkNode } from 'elkjs/lib/elk-api'
import { CaseFlowCanvas, type CaseFlowControls } from './CaseFlowCanvas'
import type { GraphNode } from './case-selectors'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const node = (id: string): GraphNode => ({ id, label: `계좌 ${id}`, accountIds: [1], abnormal: false })
function props(nodes = [node('a')]) {
  return { topology: { nodes, edges: [] }, visible: { nodes, edges: [] }, direction: 'RIGHT' as const, selectedNode: null, selectedEdge: null, moving: false, controls: createRef<CaseFlowControls>(), onNode: vi.fn(), onEdge: vi.fn(), onClear: vi.fn(), onZoom: vi.fn() }
}
type WorkerMessage = { id: number; cmd: string; graph?: ElkNode }
const workers: DeferredWorker[] = []
class DeferredWorker {
  onmessage: ((event: { data: { id: number; data: unknown } }) => void) | null = null
  requests: WorkerMessage[] = []
  constructor() { workers.push(this) }
  postMessage(message: WorkerMessage) {
    if (message.cmd === 'register') queueMicrotask(() => this.onmessage?.({ data: { id: message.id, data: true } }))
    else this.requests.push(message)
  }
  complete(x: number) {
    const request = this.requests[0]
    this.onmessage?.({ data: { id: request.id, data: { ...request.graph, children: request.graph?.children?.map(n => ({ ...n, x, y: 80 })) } } })
  }
  terminate() {}
}
describe('worker failure and stale layout recovery', () => {
  it('keeps usable nodes and offers retry when the worker cannot start', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked') } })
    const { container } = render(<CaseFlowCanvas {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('기본 배치에서 계속 조사')
    expect(container.querySelector('[data-case="graph-node"]')).toHaveTextContent('계좌 a')
    fireEvent.click(screen.getByRole('button', { name: '배치 다시 시도' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('자동 배치를 완료하지 못했습니다')
  })
  it('does not apply a canceled layout after another case graph has completed', async () => {
    workers.length = 0
    vi.stubGlobal('Worker', DeferredWorker)
    const { rerender, container } = render(<CaseFlowCanvas {...props()} />)
    await waitFor(() => expect(workers[0]?.requests.length).toBe(1))
    rerender(<CaseFlowCanvas {...props([node('b')])} />)
    await waitFor(() => expect(workers[1]?.requests.length).toBe(1))
    await act(async () => { workers[1].complete(700); await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(container.querySelector('[data-id="b"]')).toHaveAttribute('style', expect.stringMatching(/translate\(700px,\s*80px\)/))
    await act(async () => { workers[0].complete(900); await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(container.querySelector('[data-id="a"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-id="b"]')).toHaveAttribute('style', expect.stringMatching(/translate\(700px,\s*80px\)/))
  })
  it('shows fallback and retry when a layout does not answer within five seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', DeferredWorker)
    render(<CaseFlowCanvas {...props()} />)
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(5001) })
    expect(screen.getByRole('alert')).toHaveTextContent('자동 배치를 완료하지 못했습니다')
    expect(screen.getByRole('button', { name: '배치 다시 시도' })).toBeEnabled()
  })
})
