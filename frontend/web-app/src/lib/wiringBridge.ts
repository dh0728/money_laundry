import { fixture } from './apiMode'

// Reviewed AML fixture elements only; the host cannot supply arbitrary selectors.
const fixtureAnchors: Record<string, { route: string; selectors: string[] }> = {
  'case.header.status': { route: 'alerts', selectors: ['[data-testid=detail-tags] > :nth-child(1)'] },
  'case.header.risk': { route: 'alerts', selectors: ['[data-testid=detail-tags] > :nth-child(2)'] },
  'case.header.assignee': { route: 'alerts', selectors: ['[data-testid=detail-tags] > :nth-child(3)'] },
  'case.overview.judgment': { route: 'case', selectors: ['[data-testid=grouping]'] },
  'case.overview.evidence': { route: 'alerts', selectors: ['[data-testid=overview-evidence]'] },
  'case.overview.model': { route: 'alerts', selectors: ['[data-testid=pattern-candidates]'] },
  'case.overview.money.flow': { route: 'case', selectors: ['section[aria-label="조사 계좌 자금 지표"]'] },
  'case.overview.progress.history': { route: 'case', selectors: ['[data-testid=history]'] },
  'case.overview.connections.list': { route: 'episodes', selectors: ['[data-testid=linked-alerts]'] },
  'ledger.owners': { route: 'transactions', selectors: ['[data-testid="owner-section"]'] },
  'ledger.accounts': { route: 'transactions', selectors: ['[data-testid="account-section"]'] },
  'ledger.transactions': { route: 'transactions', selectors: ['[data-testid="transaction-section"]'] },
  'ledger.detail': { route: 'transactions', selectors: ['[data-testid="transaction-detail"]'] },
  'review.alerts.list': { route: 'alerts', selectors: ['[data-testid="alert-table"]', '[data-testid="alert-mobile-card"]'] },
  'review.episodes.list': { route: 'episodes', selectors: ['[data-testid="episode-table"]', '[data-testid="episode-mobile-card"]'] },
  'notifications.list': { route: 'notifications', selectors: ['[data-testid="notification-list"]', 'main h1'] },
  'account.profile': { route: 'account', selectors: ['[data-testid="account-grid"] > :first-child'] },
}

/** Local review only: exact loopback parent; no external/published origin. */
export function configuredWiringParentOrigin(value = import.meta.env.VITE_WIRING_PARENT_ORIGIN
  || 'http://127.0.0.1:5182'): string | null {
  try {
    const url = new URL(value)
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port)
    return local
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}

/** Only the authorized local fixture iframe uses the wiring presentation chrome. */
export function isWiringEmbed() {
  const params = new URLSearchParams(location.search)
  const session = params.get('wiringSession')
  const parentOrigin = configuredWiringParentOrigin()
  const local = location.protocol === 'http:' && location.hostname === '127.0.0.1'
  return fixture && window.parent !== window && local && parentOrigin !== null && params.get('wiring') === '1'
    && session !== null && /^[a-zA-Z0-9_-]{16,128}$/.test(session)
}

/** Local fixture preview only. Sends element geometry, never case data, to the Vault wiring view. */
export function installWiringBridge(anchors: Record<string, { route: string; selectors: string[] }> = fixtureAnchors) {
  const params = new URLSearchParams(location.search)
  const session = params.get('wiringSession')
  const allowedParentOrigin = configuredWiringParentOrigin()
  if (!isWiringEmbed() || !session || !allowedParentOrigin) return

  let mode: 'wires' | 'read' = 'wires'
  let parentOrigin: string | null = null
  let pending: { id: string; seq: number; route?: string; started: boolean; startedAt: number; stable: number; lastX: number; lastY: number } | null = null
  let scheduled = false
  let drag: { x: number; y: number; pointerId: number; target: Element; kind: 'orbit' | 'pan'; started: boolean } | null = null
  const dragThreshold = 6
  // IDs currently linked by the wiring tool. Find the closest linked ancestor when a nested FE control is clicked.
  const selectableIds = new Set([
    'case.header.assignee', 'case.header.risk', 'case.header.status',
    'case.overview.accounts.chart', 'case.overview.connections.list', 'case.overview.connections.scope',
    'case.overview.judgment', 'case.overview.model', 'case.overview.evidence', 'case.overview.money.explanation',
    'case.overview.money.flow', 'case.overview.progress.history', 'case.overview.progress.next',
    'case.overview.rules',
  ])
  const requestedAnchors = new Set<string>(Object.keys(anchors))
  const cursorStyle = document.createElement('style')
  cursorStyle.textContent = `${[...selectableIds].map(id => `body.aml-wiring-select [data-wiring-id="${id}"]`).join(',')} { cursor: pointer; }
    body.aml-wiring-dragging, body.aml-wiring-dragging * { cursor: grabbing !important; }`
  document.head.append(cursorStyle)
  const syncSelectCursor = () => document.body.classList.toggle('aml-wiring-select', parentOrigin !== null && mode === 'wires')

  const visible = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-wiring-id]')]
    .find(element => element.dataset.wiringId === id && element.getClientRects().length > 0)
  const send = (data: Record<string, unknown>) => {
    if (parentOrigin == null) return
    window.parent.postMessage({ channel: 'AML_WIRING_V1', session, ...data }, allowedParentOrigin)
  }
  const reportTheme = () => send({ action: 'theme', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' })
  const scan = () => {
    scheduled = false
    for (const id of requestedAnchors) {
      const binding = anchors[id]
      const route = location.hash.slice(1).split('/')[0]
      if (binding.route === 'case' ? !['alerts', 'episodes'].includes(route) : route !== binding.route) continue
      const element = binding.selectors.map(selector => document.querySelector<HTMLElement>(selector))
        .find(candidate => candidate?.getClientRects().length)
      if (element && !element.dataset.wiringId) element.dataset.wiringId = id
    }
    if (pending && (!pending.route || location.hash === `#${pending.route}`)) {
      const request = pending
      const element = visible(request.id)
      if (element) {
        if (!request.started) {
          request.started = true; request.startedAt = performance.now()
          element.scrollIntoView({ block: 'center', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }
        const rect = element.getBoundingClientRect()
        const steady = Math.abs(rect.x - request.lastX) < .5 && Math.abs(rect.y - request.lastY) < .5
        request.stable = steady ? request.stable + 1 : 0
        request.lastX = rect.x; request.lastY = rect.y
        if (request.stable >= 3 && performance.now() - request.startedAt >= 100 && rect.bottom > 0 && rect.top < innerHeight) {
          send({ action: 'focus-ready', seq: request.seq, id: request.id, hash: location.hash,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
          pending = null
        } else requestAnimationFrame(schedule)
      }
    }
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {}
    for (const element of document.querySelectorAll<HTMLElement>('[data-wiring-id]')) {
      const id = element.dataset.wiringId
      if (!id || id in rects || !element.getClientRects().length) continue
      const rect = element.getBoundingClientRect()
      if (rect.right < 0 || rect.left > innerWidth || rect.bottom < 0 || rect.top > innerHeight) continue
      rects[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    send({ action: 'rects', hash: location.hash, rects, inputVersion: 'middle-shift-v1' })
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(scan) } }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== allowedParentOrigin) return
    const message = event.data
    if (message?.channel !== 'AML_WIRING_V1' || message.session !== session) return
    if (message.action === 'hello') {
      if (parentOrigin != null && parentOrigin !== event.origin) return
      parentOrigin = event.origin
      syncSelectCursor()
      send({ action: 'hello-ready' })
      send({ action: 'data-status', mode: 'fixture', liveApiVerified: false, savingAvailable: false })
      reportTheme()
      schedule()
      return
    }
    if (parentOrigin !== event.origin) return
    if (message.action === 'targets' && Array.isArray(message.ids)) {
      for (const id of message.ids.slice(0, 100)) {
        if (typeof id !== 'string' || !Object.hasOwn(anchors, id)) continue
        requestedAnchors.add(id)
        selectableIds.add(id)
      }
      cursorStyle.textContent = `${[...selectableIds].map(id => `body.aml-wiring-select [data-wiring-id="${id}"]`).join(',')} { cursor: pointer; }
        body.aml-wiring-dragging, body.aml-wiring-dragging * { cursor: grabbing !important; }`
      schedule()
      return
    }
    if (message.action === 'mode' && (message.mode === 'wires' || message.mode === 'read')) {
      mode = message.mode
      syncSelectCursor()
      if (mode === 'read' && drag) {
        const current = drag
        drag = null
        document.body.classList.remove('aml-wiring-dragging')
        if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
        if (current.started) send({ action: 'drag-end' })
      }
    }
    if (message.action === 'set-theme' && (message.theme === 'light' || message.theme === 'dark')) {
      window.dispatchEvent(new CustomEvent('aml-wiring-theme-set', { detail: message.theme }))
    }
    if (message.action === 'focus' && typeof message.id === 'string' && /^[a-z][a-z0-9.-]{0,90}$/.test(message.id) && Number.isSafeInteger(message.seq)) {
      pending = { id: message.id, seq: message.seq, route: message.route, started: false, startedAt: 0, stable: 0, lastX: NaN, lastY: NaN }
      if (message.route === 'dashboard' || message.route === 'alerts/1' || message.route === 'episodes/50') location.hash = message.route
      window.dispatchEvent(new CustomEvent('aml-wiring-focus', { detail: message.id }))
    }
    schedule()
  })
  window.addEventListener('hashchange', schedule)
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  // Ant/Radix overlays render outside #root; observe their geometry anchors as well.
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  new MutationObserver(reportTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('click', event => {
    if (parentOrigin == null || mode !== 'wires' || event.button !== 0 || !(event.target instanceof Element)) return
    for (let element: Element | null = event.target; element; element = element.parentElement) {
      const id = (element as HTMLElement).dataset.wiringId
      if (!id || !selectableIds.has(id)) continue
      send({ action: 'select', id, hash: location.hash })
      break
    }
  }, true)
  window.addEventListener('pointerdown', event => {
    if (parentOrigin == null || mode !== 'wires' || event.pointerType !== 'mouse' || event.button !== 1) return
    event.preventDefault()
    drag = { x: event.screenX, y: event.screenY, pointerId: event.pointerId, target: event.target as Element,
      kind: event.shiftKey ? 'pan' : 'orbit', started: false }
    document.body.classList.add('aml-wiring-dragging')
  }, true)
  window.addEventListener('pointermove', event => {
    if (!drag) {
      if (parentOrigin != null && mode === 'wires' && event.pointerType === 'mouse') send({ action: 'hover', x: event.clientX, y: event.clientY })
      return
    }
    if (event.pointerId !== drag.pointerId) return
    if (!drag.started) {
      if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < dragThreshold) return
      drag.started = true
      drag.target.setPointerCapture?.(event.pointerId)
      getSelection()?.removeAllRanges()
      send({ action: 'drag-start', kind: drag.kind, x: drag.x, y: drag.y })
    }
    event.preventDefault()
    send({ action: 'drag-move', x: event.screenX, y: event.screenY })
  }, { capture: true, passive: false })
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const wasDragging = drag.started, target = drag.target
    drag = null
    document.body.classList.remove('aml-wiring-dragging')
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
    if (wasDragging) send({ action: 'drag-end' })
  }
  window.addEventListener('pointerup', endDrag, true)
  window.addEventListener('pointercancel', endDrag, true)
  window.addEventListener('blur', () => {
    if (!drag) return
    const wasDragging = drag.started
    drag = null
    document.body.classList.remove('aml-wiring-dragging')
    if (wasDragging) send({ action: 'drag-end' })
  })
  window.addEventListener('mousedown', event => { if (parentOrigin != null && mode === 'wires' && event.button === 1) event.preventDefault() }, true)
  window.addEventListener('auxclick', event => { if (parentOrigin != null && mode === 'wires' && event.button === 1) event.preventDefault() }, true)
  window.addEventListener('dragstart', event => {
    if (mode === 'wires' && drag) event.preventDefault()
  }, true)
  window.addEventListener('wheel', event => {
    if (parentOrigin == null || mode !== 'wires' || !event.shiftKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    send({ action: 'wheel', delta: (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1) })
  }, { capture: true, passive: false })
  schedule()
  requestAnimationFrame(reportTheme)
}
