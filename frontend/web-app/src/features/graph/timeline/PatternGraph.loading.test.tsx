import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PatternGraph from './PatternGraph'
import { buildTimeline } from './timeLayout'

const chunk = vi.hoisted(() => {
  let reject!: (error: Error) => void
  const promise = new Promise<void>((_, fail) => { reject = fail })
  return { promise, reject }
})
vi.mock('react-force-graph-2d', async () => {
  await chunk.promise
  return { default: () => null }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('패턴 청크 대기를 알리고 실패해도 부모의 소유주 보기 제어를 보존한다', async () => {
  vi.stubGlobal('ResizeObserver', class {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver) }
    disconnect() {}
  })
  const timeline = buildTimeline([{ txId: 1, txAt: '2023-09-10T00:00:00Z', fromAccount: 'a', toAccount: 'b', fromBank: 1, toBank: 2, amountUsd: 10, amountPaid: 10, paymentCurrency: 'USD', launderingScore: null }])
  render(<><button>소유주</button><PatternGraph g={timeline} selected={null} onSelect={vi.fn()} onZoom={vi.fn()} controls={null} /></>)
  expect(screen.getByRole('status')).toHaveTextContent('패턴 그래프를 불러오는 중')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await act(async () => { chunk.reject(new Error('synthetic chunk failure')) })
  expect(await screen.findByRole('alert')).toHaveTextContent('패턴 그래프를 불러오지 못했습니다')
  expect(screen.getByRole('alert')).toHaveTextContent('소유주 보기')
  expect(screen.getByRole('button', { name: '소유주' })).toBeInTheDocument()
})
