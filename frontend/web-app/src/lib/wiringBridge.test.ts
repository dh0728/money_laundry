/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"http://127.0.0.1:5181/?wiring=1&wiringSession=abcdefghijklmnop#alerts/1"}
 */
import { expect, it, vi } from 'vitest'

vi.mock('./apiMode', () => ({ fixture: true }))
import { configuredWiringParentOrigin, installWiringBridge, isWiringEmbed } from './wiringBridge'

it('accepts only an exact configured loopback tool origin', () => {
  expect(configuredWiringParentOrigin('http://127.0.0.1:5182')).toBe('http://127.0.0.1:5182')
  expect(configuredWiringParentOrigin('http://127.0.0.1:5192/')).toBe('http://127.0.0.1:5192')
  expect(configuredWiringParentOrigin('https://demo.example')).toBeNull()
  for (const invalid of ['null', '*', 'http://localhost:5192', 'http://127.0.0.1:5192/path', 'http://example.com:5192', 'https://demo.example/path']) {
    expect(configuredWiringParentOrigin(invalid)).toBeNull()
  }
})

it('pairs only with the expected session and preserves ordinary app clicks and scrolling', async () => {
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')!
  const postMessage = vi.fn()
  const parent = { postMessage } as unknown as Window
  Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  document.body.innerHTML = '<div id="root"><div data-wiring-id="case.overview.model"><button data-wiring-id="case.overview.seed">ordinary action</button></div></div>'
  const model = document.querySelector<HTMLElement>('[data-wiring-id="case.overview.model"]')!
  const rect = { x: 24, y: 48, width: 240, height: 120, left: 24, top: 48, right: 264, bottom: 168 }
  model.getClientRects = () => [rect] as unknown as DOMRectList
  model.getBoundingClientRect = () => rect as DOMRect
  const observers: MutationObserver[] = []
  const Observer = MutationObserver
  vi.stubGlobal('MutationObserver', class extends Observer { constructor(callback: MutationCallback) { super(callback); observers.push(this) } })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(performance.now())); return 1 })
  try {
    expect(isWiringEmbed()).toBe(true)
    installWiringBridge()
    const message = (origin: string, data: Record<string, unknown>) => {
      const event = new MessageEvent('message', { origin, data })
      Object.defineProperty(event, 'source', { value: parent })
      window.dispatchEvent(event)
    }
    message('http://127.0.0.1:5182', { channel: 'AML_WIRING_V1', action: 'hello', session: 'wrong-session-1234' })
    message('http://127.0.0.1:9999', { channel: 'AML_WIRING_V1', action: 'hello', session: 'abcdefghijklmnop' })
    message('null', { channel: 'AML_WIRING_V1', action: 'hello', session: 'abcdefghijklmnop' })
    expect(postMessage).not.toHaveBeenCalled()
    message('http://127.0.0.1:5182', { channel: 'AML_WIRING_V1', action: 'hello', session: 'abcdefghijklmnop' })
    expect(document.body.classList.contains('aml-wiring-select')).toBe(true)
    expect([...document.querySelectorAll('style')].some(style => style.textContent?.includes('[data-wiring-id="case.overview.model"]'))).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'hello-ready', session: 'abcdefghijklmnop' }), 'http://127.0.0.1:5182')
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'data-status', mode: 'fixture', liveApiVerified: false, savingAvailable: false,
    }), 'http://127.0.0.1:5182')
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rects', hash: '#alerts/1', inputVersion: 'middle-shift-v1',
      rects: { 'case.overview.model': { x: 24, y: 48, width: 240, height: 120 } },
    }), 'http://127.0.0.1:5182'))

    let clicks = 0
    const button = document.querySelector('button')!
    button.addEventListener('click', () => { clicks++ })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    button.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(clicks).toBe(1)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'select', id: 'case.overview.model', hash: '#alerts/1',
    }), 'http://127.0.0.1:5182')
    const hover = new MouseEvent('pointermove', { clientX: 40, clientY: 60 })
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' })
    window.dispatchEvent(hover)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'hover', x: 40, y: 60 }), 'http://127.0.0.1:5182')

    const ordinaryWheel = new WheelEvent('wheel', { cancelable: true, deltaY: 40 })
    window.dispatchEvent(ordinaryWheel)
    expect(ordinaryWheel.defaultPrevented).toBe(false)
    const shiftWheel = new WheelEvent('wheel', { cancelable: true, deltaY: 40, shiftKey: true })
    window.dispatchEvent(shiftWheel)
    expect(shiftWheel.defaultPrevented).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'wheel', delta: 40 }), 'http://127.0.0.1:5182')
    const horizontalShiftWheel = new WheelEvent('wheel', { cancelable: true, deltaX: -30, deltaY: 0, shiftKey: true })
    window.dispatchEvent(horizontalShiftWheel)
    expect(horizontalShiftWheel.defaultPrevented).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'wheel', delta: -30 }), 'http://127.0.0.1:5182')
    const browserZoom = new WheelEvent('wheel', { cancelable: true, deltaY: 40, shiftKey: true, ctrlKey: true })
    window.dispatchEvent(browserZoom)
    expect(browserZoom.defaultPrevented).toBe(false)

    const pointer = (type: string, button: number, x: number, y: number, shiftKey = false) => {
      const event = new MouseEvent(type, { cancelable: true, button, clientX: x + 100, clientY: y + 100, screenX: x, screenY: y, shiftKey })
      Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } })
      window.dispatchEvent(event)
      return event
    }
    expect(pointer('pointerdown', 0, 0, 0).defaultPrevented).toBe(false)
    pointer('pointerdown', 1, 0, 0, true)
    expect(document.body.classList.contains('aml-wiring-dragging')).toBe(true)
    pointer('pointermove', 1, 20, 0, true)
    pointer('pointerup', 1, 20, 0, true)
    expect(document.body.classList.contains('aml-wiring-dragging')).toBe(false)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'drag-start', kind: 'pan', x: 0, y: 0 }), 'http://127.0.0.1:5182')
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'drag-move', x: 20, y: 0 }), 'http://127.0.0.1:5182')
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'drag-end' }), 'http://127.0.0.1:5182')
    message('http://127.0.0.1:5182', { channel: 'AML_WIRING_V1', action: 'mode', mode: 'read', session: 'abcdefghijklmnop' })
    expect(document.body.classList.contains('aml-wiring-select')).toBe(false)
  } finally {
    observers.forEach(observer => observer.disconnect())
    Object.defineProperty(window, 'parent', originalParent)
    vi.unstubAllGlobals()
  }
})
