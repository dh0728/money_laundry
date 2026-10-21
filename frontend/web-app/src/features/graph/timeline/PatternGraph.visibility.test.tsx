import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PatternGraph from './PatternGraph'
import { buildTimeline } from './timeLayout'

const graph = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>(done => { resolve = done })
  return { ready, resolve, pause: vi.fn(), resume: vi.fn(), zoom: vi.fn(), center: vi.fn() }
})
vi.mock('react-force-graph-2d', async () => {
  await graph.ready
  const React = await import('react')
  return { default: React.forwardRef((_, ref) => {
    React.useImperativeHandle(ref, () => ({ pauseAnimation: graph.pause, resumeAnimation: graph.resume, zoom: graph.zoom, centerAt: graph.center }), [])
    return <canvas data-testid="loaded-force-canvas" />
  }) }
})
afterEach(() => vi.unstubAllGlobals())

it('initial hidden과 늦게 붙는 lazy ref를 멈추고 다시 보일 때 같은 카메라로 재개한다', async () => {
  vi.stubGlobal('ResizeObserver', class {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver) }
    disconnect() {}
  })
  const timeline = buildTimeline([{ txId: 1, txAt: '2023-09-10T00:00:00Z', fromAccount: 'a', toAccount: 'b', fromBank: 1, toBank: 2, amountUsd: 10, amountPaid: 10, paymentCurrency: 'USD', launderingScore: null }])
  const select = vi.fn(), zoom = vi.fn()
  const props = { g: timeline, selected: { type: 'nodes' as const, ids: ['a'] }, onSelect: select, onZoom: zoom, controls: null }
  const { rerender } = render(<PatternGraph {...props} active={false} />)
  expect(screen.getByRole('status')).toBeInTheDocument()
  await act(async () => graph.resolve())
  await screen.findByTestId('loaded-force-canvas')
  await waitFor(() => expect(graph.pause).toHaveBeenCalled())
  expect(graph.resume).not.toHaveBeenCalled()
  rerender(<PatternGraph {...props} active />)
  await waitFor(() => expect(graph.resume).toHaveBeenCalledTimes(1))
  rerender(<PatternGraph {...props} active={false} />)
  await waitFor(() => expect(graph.pause).toHaveBeenCalledTimes(2))
  rerender(<PatternGraph {...props} g={buildTimeline(timeline.tx.map(tx => ({ ...tx, amountUsd: 25 })))} selected={{ type: 'nodes', ids: ['b'] }} active={false} />)
  expect(graph.resume).toHaveBeenCalledTimes(1)
  expect(graph.zoom).not.toHaveBeenCalled()
  expect(graph.center).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
  expect(zoom).not.toHaveBeenCalled()
})
