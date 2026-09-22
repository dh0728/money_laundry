import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import * as agent from './Agent'

it('offers working chat actions without an inert previous-conversation drawer', () => {
  const markup = renderToStaticMarkup(<TooltipProvider><agent.default open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={[]} /></TooltipProvider>)
  expect(markup).not.toContain('이전 대화')
  expect(markup).toContain('새 대화')
  expect(markup).toContain('질문 보내기')
})

// These exercise public geometry/lifecycle behavior, not source-code spelling.
const normalize = (args: Parameters<typeof agent.normalizeFloatGeometry>[0]) => {
  expect(agent.normalizeFloatGeometry, 'atomic geometry normalization is required').toBeTypeOf('function')
  return agent.normalizeFloatGeometry(args)
}
const fixture = {
  size: { width: 400, height: 620 }, position: { x: 1000, y: 88 },
  viewport: { width: 1440, height: 1000 }, contentRight: 1424,
}

describe('RDR floating geometry', () => {
  it('normalizes a resized, dragged panel atomically against the content edge', () => {
    const actual = normalize({ ...fixture, size: { width: 1100, height: 1500 }, position: { x: 1400, y: -100 }, viewport: { width: 720, height: 1200 }, contentRight: 700 })
    expect(actual.size).toEqual({ width: 648, height: 1020 })
    expect(actual.position).toEqual({ x: 44, y: 8 })
  })

  it('keeps the chat reachable after dragging left and below the viewport', () => {
    const actual = normalize({ ...fixture, position: { x: -900, y: 900 } })
    expect(actual.position).toEqual({ x: 8, y: 372 })
  })

  it('keeps the chat inside narrow screens', () => {
    const actual = normalize({ ...fixture, viewport: { width: 480, height: 1200 }, contentRight: 464 })
    expect(actual.position).toEqual({ x: 56, y: 88 })
  })

  it('fits the panel even when content bounds are narrower than the viewport', () => {
    const actual = normalize({ ...fixture, contentRight: 350 })
    expect(actual.size.width).toBe(334)
    expect(actual.position.x).toBe(8)
  })

  it('repeated normalization is idempotent', () => {
    const options = { ...fixture, position: { x: -800, y: 1900 } }
    const first = normalize(options)
    const again = normalize({ ...options, ...first })
    expect(again).toEqual(first)
  })
})

describe('Agent event orchestration used by the component', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  const closedBounds = { width: 1440, height: 1000, contentRight: 1424 }
  const sidebarBounds = { ...closedBounds, contentRight: 1034 }
  const from = { left: 1300, top: 900, width: 56, height: 56 }
  const to = { left: 1080, top: 200, width: 56, height: 56 }
  const setup = () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    expect(agent.createAgentController, 'Agent must use one testable event orchestration path').toBeTypeOf('function')
    const closed: boolean[] = [], modes: agent.AgentMode[] = [], bounds: unknown[] = []
    const geometries: Array<{ size: { width: number; height: number }; position: { x: number; y: number } }> = []
    const controller = agent.createAgentController({ onVisual: () => {}, onClose: () => closed.push(true), onMode: mode => modes.push(mode), onBounds: value => bounds.push(value), onGeometry: value => geometries.push(value) })
    const commit = (overrides: Partial<Parameters<typeof controller.commit>[0]> = {}) => controller.commit({
      open: true, mode: 'sidebar', bounds: sidebarBounds, renderedBounds: sidebarBounds,
      layoutKey: 'sidebar-avatar', from: () => from, to, reducedMotion: false, ...overrides,
    })
    return { controller, commit, closed, modes, bounds, geometries }
  }

  it('waits for the first desktop sidebar bounds commit before consuming the FAB origin', () => {
    const { controller, commit, bounds } = setup()
    let consumed = 0
    commit({ open: false, bounds: closedBounds, renderedBounds: closedBounds })
    const origin = () => { consumed++; return from }
    commit({ renderedBounds: closedBounds, from: origin })
    expect(consumed).toBe(0)
    expect(bounds).toEqual([sidebarBounds])
    commit({ from: origin })
    const generation = controller.visual.morph?.generation
    vi.advanceTimersByTime(32)
    commit({ from: origin })
    expect(consumed).toBe(1)
    expect(controller.visual).toMatchObject({ avatarVisible: false, morph: { generation, to } })
    vi.advanceTimersByTime(400)
    expect(controller.visual.morph).not.toBeNull()
    controller.transition(generation!, 'end', true)
    expect(controller.visual).toMatchObject({ morph: null, avatarVisible: true })
  })

  it('mode switches clear every live gesture and stale events cannot hide the final avatar', () => {
    const { controller, commit, modes } = setup()
    commit()
    const generation = controller.visual.morph!.generation
    controller.gestures.drag.current = { x: 1, y: 2, left: 600, top: 80 }
    controller.gestures.floatResize.current = { x: 1, y: 2, width: 500, height: 700, axis: 'both' }
    controller.gestures.sidebarResize.current = { x: 1, width: 390 }
    controller.changeMode('floating')
    expect(Object.values(controller.gestures).map(ref => ref.current)).toEqual([null, null, null])
    expect(modes).toEqual(['floating'])
    commit({ mode: 'floating', bounds: closedBounds, renderedBounds: closedBounds, layoutKey: 'float:600:80:500:700' })
    controller.transition(generation, 'cancel', true)
    vi.runAllTimers()
    expect(controller.visual).toEqual({ morph: null, avatarVisible: true })
  })

  it('dragged/resized geometry survives mode and closed/open round trips', () => {
    const { controller, commit, geometries } = setup()
    commit({ mode: 'floating', bounds: closedBounds, renderedBounds: closedBounds })
    controller.gestureStart()
    controller.gestures.drag.current = { x: 100, y: 100, left: 700, top: 100 }
    expect(controller.dragTo, 'real drag events must share the tested orchestration').toBeTypeOf('function')
    controller.dragTo(200, 200, fixture)
    expect(geometries.at(-1)?.position).toEqual({ x: 800, y: 200 })
    controller.gestures.floatResize.current = { x: 100, y: 100, width: 400, height: 620, axis: 'both' }
    controller.resizeTo(200, 180, { ...fixture, ...geometries.at(-1)! })
    expect(geometries.at(-1)).toMatchObject({ size: { width: 500, height: 700 }, position: { x: 800, y: 200 } })
    const layoutKey = JSON.stringify(geometries.at(-1))
    commit({ mode: 'floating', bounds: closedBounds, renderedBounds: closedBounds, layoutKey })
    controller.changeMode('sidebar')
    commit()
    controller.dragTo(9000, 9000, fixture)
    controller.resizeTo(9000, 9000, fixture)
    expect(geometries).toHaveLength(2)
    commit({ open: false })
    controller.changeMode('floating')
    commit({ mode: 'floating', bounds: closedBounds, renderedBounds: closedBounds, layoutKey, from: () => null })
    expect(geometries).toHaveLength(2)
    expect(geometries.at(-1)).toMatchObject({ size: { width: 500, height: 700 }, position: { x: 800, y: 200 } })
    expect(controller.visual).toEqual({ morph: null, avatarVisible: true })
  })

  it('filters descendant and stale transition targets and falls back when closing emits no native end', () => {
    const { controller, commit, closed } = setup()
    commit()
    const opening = controller.visual.morph!.generation
    controller.transition(opening, 'end', false)
    expect(controller.visual.morph).not.toBeNull()
    controller.close(to, from, false)
    const closing = controller.visual.morph!.generation
    controller.transition(opening, 'cancel', true)
    controller.transition(closing, 'cancel', false)
    expect(closed).toEqual([])
    vi.advanceTimersByTime(600)
    controller.transition(closing, 'end', true)
    expect(closed).toEqual([true])
    expect(controller.visual.avatarVisible).toBe(false)
  })

})

describe('RDR morph settlement', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  const setup = () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const frames: unknown[] = [], closed: boolean[] = []
    expect(agent.createMorphLifecycle, 'guarded morph lifecycle is required').toBeTypeOf('function')
    const lifecycle = agent.createMorphLifecycle(state => frames.push(state), () => closed.push(true))
    return { lifecycle, frames, closed }
  }
  const from = { left: 1200, top: 850, width: 56, height: 56 }
  const to = { left: 1080, top: 200, width: 56, height: 56 }

  it('preserves the uninterrupted from-to animation until settlement', () => {
    const { lifecycle, frames } = setup()
    const generation = lifecycle.start('opening', from, to)
    expect(frames.at(-1)).toMatchObject({ from, to: from })
    vi.advanceTimersByTime(32)
    expect(frames.at(-1)).toMatchObject({ from, to })
    lifecycle.settle(generation)
    expect(frames.at(-1)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['opening', 'closing'] as const)('mode/layout interruption settles %s and cancels queued frames', kind => {
    const { lifecycle, frames, closed } = setup()
    lifecycle.start(kind, from, to)
    lifecycle.interrupt()
    vi.runAllTimers()
    expect(frames.at(-1)).toBeNull()
    expect(closed).toEqual(kind === 'closing' ? [true] : [])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['end', 'cancel', 'timeout'])('%s completes closing exactly once and restores the FAB', event => {
    const { lifecycle, frames, closed } = setup()
    const generation = lifecycle.start('closing', to, from)
    if (event === 'timeout') vi.advanceTimersByTime(600)
    else lifecycle.settle(generation)
    lifecycle.settle(generation)
    vi.runAllTimers()
    expect(frames.at(-1)).toBeNull()
    expect(closed).toEqual([true])
  })

  it('old transition completions cannot settle a newer morph', () => {
    const { lifecycle, frames, closed } = setup()
    const stale = lifecycle.start('closing', to, from)
    const current = lifecycle.start('opening', from, to)
    lifecycle.settle(stale)
    vi.advanceTimersByTime(32)
    expect(frames.at(-1)).toMatchObject({ generation: current, kind: 'opening', to })
    expect(closed).toEqual([])
  })

  it('reduced motion settles without queuing frames or leaving an invisible open shell', () => {
    const { lifecycle, frames, closed } = setup()
    lifecycle.start('opening', from, to, true)
    expect(frames.at(-1)).toBeNull()
    lifecycle.start('closing', to, from, true)
    expect(frames.at(-1)).toBeNull()
    expect(closed).toEqual([true])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmount cancels every pending callback without closing a newer panel', () => {
    const { lifecycle, frames, closed } = setup()
    lifecycle.start('closing', to, from)
    const count = frames.length
    lifecycle.dispose()
    vi.runAllTimers()
    expect(frames).toHaveLength(count)
    expect(closed).toEqual([])
  })
})

it('a visually hidden avatar is neither a pointer target nor a keyboard stop', () => {
  const markup = renderToStaticMarkup(<TooltipProvider><agent.default open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={[]} /></TooltipProvider>)
  const avatar = markup.match(/<button[^>]*aria-label="RDR 9000 심볼로 닫기"[^>]*>/)?.[0]
  expect(avatar).toContain('aria-hidden="true"')
  expect(avatar).toContain('tabindex="-1"')
  expect(avatar).toContain('pointer-events-none')
  expect(avatar).toContain('invisible')
})
