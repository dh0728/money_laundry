import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { toggleDocumentFullscreen } from './App'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('v23 header sizing and fullscreen fallback', () => {
  it('lets global search consume the available narrow-desktop center column', () => {
    expect(appSource).toMatch(/className="header-search-input"/)
    expect(css).toMatch(/@media \(max-width:900px\)[^{]*\{[\s\S]*?\.header-search-input\s*\{[^}]*width:\s*100%[^}]*max-width:\s*520px/)
  })

  it('uses native fullscreen when available without enabling fallback', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const setFallback = vi.fn()
    await toggleDocumentFullscreen({ fullscreenElement: null, documentElement: { requestFullscreen } }, false, setFallback)
    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(setFallback).not.toHaveBeenCalled()
  })

  it('falls back to app fullscreen when the browser rejects or lacks the native API', async () => {
    const setRejectedFallback = vi.fn()
    await toggleDocumentFullscreen({ fullscreenElement: null, documentElement: { requestFullscreen: vi.fn().mockRejectedValue(new TypeError('not granted')) } }, false, setRejectedFallback)
    expect(setRejectedFallback).toHaveBeenCalledWith(true)

    const setMissingFallback = vi.fn()
    await toggleDocumentFullscreen({ fullscreenElement: null, documentElement: {} }, false, setMissingFallback)
    expect(setMissingFallback).toHaveBeenCalledWith(true)
  })

  it('exits the active native or app fullscreen mode through the same toggle', async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    const nativeFallback = vi.fn()
    await toggleDocumentFullscreen({ fullscreenElement: {}, documentElement: {}, exitFullscreen }, false, nativeFallback)
    expect(exitFullscreen).toHaveBeenCalledOnce()

    const appFallback = vi.fn()
    await toggleDocumentFullscreen({ fullscreenElement: null, documentElement: {} }, true, appFallback)
    expect(appFallback).toHaveBeenCalledWith(false)
  })

  it('keeps the fallback visible and reversible while preserving F11', () => {
    expect(appSource).toContain("app-fullscreen-fallback")
    expect(appSource).toMatch(/if \(e\.key === 'F11'\)/)
    expect(css).toMatch(/\.app-fullscreen-fallback\s*>\s*\[data-slot=sidebar-inset\]/)
  })
})
