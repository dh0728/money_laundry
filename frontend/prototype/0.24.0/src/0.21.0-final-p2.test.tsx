import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import * as agent from './Agent'
import * as flow from './FlowDetail'
import { records } from './domain'

afterEach(() => vi.unstubAllGlobals())

describe('responsive panel boundaries', () => {
  it.each([60, 96, 128])('RDR sidebar starts below the measured %spx header and ends at the viewport', headerBottom => {
    vi.stubGlobal('innerWidth', 480)
    vi.stubGlobal('innerHeight', 1200)
    vi.stubGlobal('document', { querySelector: (selector: string) => selector === '.app-header' ? { getBoundingClientRect: () => ({ bottom: headerBottom }) } : null })
    const markup = renderToStaticMarkup(<TooltipProvider><agent.default open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={[]} /></TooltipProvider>)
    const shell = markup.match(/<section[^>]*aria-label="RDR 9000"[^>]*>/)?.[0]
    expect(shell).toContain(`top:${headerBottom}px`)
    expect(shell).toContain(`height:${1200 - headerBottom}px`)
    expect(shell).not.toContain('top-15')
  })

  it('floating flow detail fits 480px including its complete right-side controls', () => {
    expect(flow.normalizeFlowGeometry).toBeTypeOf('function')
    expect(flow.normalizeFlowGeometry({ x: 16, y: 88, width: 560, height: 620 }, { width: 480, height: 1200, contentRight: 464, headerBottom: 96 })).toEqual({ x: 16, y: 104, width: 432, height: 620 })
  })

  it('reclamps a dragged/resized flow panel after a viewport/content shrink', () => {
    expect(flow.normalizeFlowGeometry).toBeTypeOf('function')
    expect(flow.normalizeFlowGeometry({ x: 1000, y: 900, width: 800, height: 900 }, { width: 720, height: 700, contentRight: 650, headerBottom: 60 })).toEqual({ x: 16, y: 68, width: 618, height: 616 })
  })
})

describe('standard FAB activation', () => {
  const setup = () => {
    expect(agent.createFabActivation).toBeTypeOf('function')
    const activations: boolean[] = []
    return { activation: agent.createFabActivation(() => activations.push(true)), activations }
  }
  it.each(['Enter', 'Space'])('%s activates through the native keyboard click', () => {
    const { activation, activations } = setup()
    activation.click(0)
    expect(activations).toEqual([true])
  })
  it('pointerup followed by click activates once, while drag-generated click does not open', () => {
    const { activation, activations } = setup()
    activation.pointerStart()
    activation.pointerEnd(false)
    expect(activations).toEqual([])
    activation.click(1)
    expect(activations).toEqual([true])
    activation.pointerStart()
    activation.pointerEnd(true)
    activation.click(1)
    expect(activations).toEqual([true])
    activation.click(0)
    expect(activations).toEqual([true, true])
  })
})

it('ordinary RDR questions return bounded investigation guidance without implementation-state copy', () => {
  expect(agent.agentAnswer).toBeTypeOf('function')
  const answer = agent.agentAnswer('이 Alert에서 먼저 확인할 것은?', records[0], '위험 요약')
  expect(answer).toContain(records[0].id)
  expect(answer).toMatch(/거래|탐지 근거|처리 이력/)
  expect(answer).not.toMatch(/연결되지|미확정|API|백엔드|모델 분석/)
  expect(agent.agentAnswer('요약', records[0], '위험 요약')).toBe('위험 요약')
})
