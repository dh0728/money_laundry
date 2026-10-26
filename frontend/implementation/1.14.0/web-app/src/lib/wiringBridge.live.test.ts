/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
vi.mock('./apiMode', () => ({ fixture: false, live: true }))
import { installWiringBridge, isWiringEmbed } from './wiringBridge'
it('never activates the geometry bridge in the actual API mode', () => {
  history.replaceState(null, '', '/?wiring=1&wiringSession=abcdefghijklmnop#alerts/1')
  const original = Object.getOwnPropertyDescriptor(window, 'parent')!
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } })
  const styles = document.querySelectorAll('style').length
  try {
    expect(isWiringEmbed()).toBe(false)
    installWiringBridge()
    window.dispatchEvent(new MessageEvent('message', { origin: 'http://127.0.0.1:5182', data: { channel: 'AML_WIRING_V1', session: 'abcdefghijklmnop', action: 'hello' } }))
    expect(postMessage).not.toHaveBeenCalled()
    expect(document.querySelectorAll('style')).toHaveLength(styles)
  } finally { Object.defineProperty(window, 'parent', original) }
})
