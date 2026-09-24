import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture component-owned effects; canvas/URL browser APIs are the boundary.
const hooks = vi.hoisted(() => ({
  effects: [] as Array<{ run: () => void | (() => void); dependencies: unknown[] | undefined }>,
  ref: null as unknown,
  states: [] as unknown[],
  theme: 'light',
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (run: () => void | (() => void), dependencies?: unknown[]) => { hooks.effects.push({ run, dependencies }) },
  useLayoutEffect: (run: () => void | (() => void), dependencies?: unknown[]) => { hooks.effects.push({ run, dependencies }) },
  useRef: () => ({ current: hooks.ref }),
  useState: (initial: unknown) => [hooks.states.length ? hooks.states.shift() : typeof initial === 'function' ? initial() : initial, () => {}],
}))
vi.mock('./ThemeProvider', () => ({ useTheme: () => ({ resolvedTheme: hooks.theme }) }))
import LoginNetwork from './LoginNetwork'
import { Account } from './UtilityPages'
import { FlowPanel } from './FlowDetail'

beforeEach(() => { hooks.effects = []; hooks.ref = null; hooks.states = []; hooks.theme = 'light' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('browser resource lifetimes', () => {
  it('animates the login canvas and releases its frame, resize observer and pointer listeners', () => {
    let draws = 0, resize!: () => void, disconnected = false
    const context = { strokeStyle: '', fillStyle: '', globalAlpha: 1, clearRect: () => { draws++ }, setTransform: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {}, fill: () => {} }
    const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 900, height: 600 }) }
    hooks.ref = canvas
    const events: string[] = [], removed: string[] = [], frames: Array<(time: number) => void> = [], cancelled: number[] = []
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: (name: string) => events.push(name), removeEventListener: (name: string) => removed.push(name) })
    vi.stubGlobal('document', { addEventListener: (name: string) => events.push(name) })
    vi.stubGlobal('devicePixelRatio', 2)
    const palette: Record<string, string> = { '--login-network-edge': 'rgba(100,110,120,.42)', '--login-network-node': 'rgba(200,210,220,.9)' }
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (token: string) => palette[token] ?? '' }))
    vi.stubGlobal('requestAnimationFrame', (frame: (time: number) => void) => { frames.push(frame); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id) })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() { disconnected = true }
    })
    LoginNetwork()
    const first = hooks.effects[0]
    const cleanup = first.run()
    expect(draws).toBe(1)
    expect(context.strokeStyle).toBe('rgba(100,110,120,.42)')
    expect(context.fillStyle).toBe('rgba(200,210,220,.9)')
    expect(context.globalAlpha).toBe(1)
    palette['--login-network-node'] = 'rgba(10,20,30,.9)'
    resize()
    expect(draws).toBe(2)
    expect(context.fillStyle).toBe('rgba(10,20,30,.9)')
    expect(frames).toHaveLength(1)
    expect(events).toEqual(['pointermove', 'pointerleave'])
    expect(first.dependencies).toEqual(['light'])
    if (cleanup) cleanup()
    expect(disconnected).toBe(true)
    expect(cancelled).toEqual([1])
    expect(removed).toEqual(['pointermove', 'pointerleave'])
    hooks.theme = 'dark'; hooks.effects = []
    LoginNetwork()
    expect(hooks.effects[0].dependencies).toEqual(['dark'])
    hooks.effects[0].run()
    expect(draws).toBe(3)
  })

  it('keeps the selected account image alive until replacement or unmount, revoking only its owned URL', () => {
    const revoked: string[] = []
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revoked.push(url) })
    hooks.states = [[], 'blob:first']
    Account({ user: '오검토', onLogout: () => {} })
    expect(hooks.effects).toHaveLength(1)
    expect(hooks.effects[0].dependencies).toEqual(['blob:first'])
    const disposeFirst = hooks.effects[0].run()
    expect(revoked).toEqual([])
    hooks.states = [[], 'blob:second']; hooks.effects = []
    Account({ user: '오검토', onLogout: () => {} })
    if (disposeFirst) disposeFirst()
    const disposeSecond = hooks.effects[0].run()
    expect(revoked).toEqual(['blob:first'])
    if (disposeSecond) disposeSecond()
    expect(revoked).toEqual(['blob:first', 'blob:second'])
  })

  it('clamps FlowPanel initially and on observed layout changes without reading layout on every render', () => {
    let measures = 0, resize!: () => void, disconnected = false
    const main = { getBoundingClientRect: () => { measures++; return { right: 1200 } }, offsetWidth: 1000, clientWidth: 1000 }
    vi.stubGlobal('document', { querySelector: (selector: string) => selector === '.app-main' ? main : null })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() { disconnected = true }
    })
    FlowPanel({ model: { nodes: [], edges: [], blocks: [] }, focus: { kind: 'node', key: 'a' }, mode: 'dock', onModeChange: () => {}, onClose: () => {} })
    expect(hooks.effects).toHaveLength(1)
    expect(hooks.effects[0].dependencies).toEqual([])
    measures = 0
    const cleanup = hooks.effects[0].run()
    expect(measures).toBe(1)
    resize()
    expect(measures).toBe(2)
    if (cleanup) cleanup()
    expect(disconnected).toBe(true)
  })
})
