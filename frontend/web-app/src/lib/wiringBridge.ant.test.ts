/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"http://127.0.0.1:5209/ant-review.html?wiring=1&wiringSession=abcdefghijklmnop#episodes/50"}
 */
import { expect, it, vi } from 'vitest'
vi.mock('./apiMode', () => ({ fixture: true }))
import { installWiringBridge } from './wiringBridge'

it('Ant의 소스가 지정한 앵커만 부모에 연결하고 실제 API 성공으로 보고하지 않는다', async () => {
  const original = Object.getOwnPropertyDescriptor(window, 'parent')!
  const postMessage = vi.fn()
  const parent = { postMessage }
  Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  document.body.innerHTML = '<div id="root"><section id="graph">관계 그래프</section></div>'
  const element = document.getElementById('graph')!
  const rect = { x: 24, y: 48, width: 500, height: 300, right: 524, bottom: 348, left: 24, top: 48 }
  element.getClientRects = () => [rect] as unknown as DOMRectList
  element.getBoundingClientRect = () => rect as DOMRect
  const observers: MutationObserver[] = []
  const Observer = MutationObserver
  vi.stubGlobal('MutationObserver', class extends Observer { constructor(callback: MutationCallback) { super(callback); observers.push(this) } })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(performance.now())); return 1 })
  try {
    installWiringBridge({ 'case.graph': { route: 'case', selectors: ['#graph'] }, 'case.transaction.detail': { route: 'case', selectors: ['#portal-detail'] } })
    window.dispatchEvent(new MessageEvent('message', { source: parent as unknown as Window, origin: 'http://127.0.0.1:5182', data: { channel: 'AML_WIRING_V1', session: 'abcdefghijklmnop', action: 'hello' } }))
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'rects', hash: '#episodes/50', rects: { 'case.graph': { x: 24, y: 48, width: 500, height: 300 } } }), 'http://127.0.0.1:5182'))
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'data-status', mode: 'fixture', liveApiVerified: false, savingAvailable: false }), 'http://127.0.0.1:5182')
    window.dispatchEvent(new MessageEvent('message', { source: parent as unknown as Window, origin: 'http://127.0.0.1:5182', data: { channel: 'AML_WIRING_V1', session: 'abcdefghijklmnop', action: 'targets', ids: ['case.graph', 'arbitrary.selector'] } }))
    element.click()
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'select', id: 'case.graph', hash: '#episodes/50' }), 'http://127.0.0.1:5182')
    expect(document.querySelector('[data-wiring-id="arbitrary.selector"]')).toBeNull()
    // Drain the scan already scheduled by targets; only the portal mutation may trigger the next one.
    await Promise.resolve()
    const portal = document.createElement('section')
    portal.id = 'portal-detail'
    portal.getClientRects = () => [rect] as unknown as DOMRectList
    portal.getBoundingClientRect = () => rect as DOMRect
    document.body.append(portal)
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'rects', rects: expect.objectContaining({ 'case.transaction.detail': expect.objectContaining({ width: 500, height: 300 }) }) }), 'http://127.0.0.1:5182'))
  } finally { observers.forEach(observer => observer.disconnect()); Object.defineProperty(window, 'parent', original); vi.unstubAllGlobals() }
})
