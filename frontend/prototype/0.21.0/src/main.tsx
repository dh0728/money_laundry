import { NuqsAdapter } from 'nuqs/adapters/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><TooltipProvider delayDuration={200}><NuqsAdapter><App/></NuqsAdapter><Toaster richColors position="top-center"/></TooltipProvider></ThemeProvider></React.StrictMode>)

// 한 프레임에 가장 가까운 컨트롤과 그 컨트롤이 놓인 표면만 갱신한다. 셸 배경은 대상이 아니다.
const SHINE_CONTROLS = ':is([data-slot="button"], button, [data-slot="input"], input, [data-slot="textarea"], textarea, [data-slot="select-trigger"], select, .date-range-control):not([data-variant="link"]):not([role="tab"]):not([data-shine="off"])'
const SHINE_SURFACES = ':is([data-slot="card"], .work-card, .notification-card, .glass-surface, .graph-layout, [data-shine="surface"]):not([data-shine="off"])'

let shineFrame = 0
let shinePointer: { target: EventTarget | null; x: number; y: number } | null = null

window.addEventListener('pointermove', event => {
  shinePointer = { target: event.target, x: event.clientX, y: event.clientY }
  if (shineFrame) return

  shineFrame = requestAnimationFrame(() => {
    shineFrame = 0
    const pointer = shinePointer
    if (!pointer || !(pointer.target instanceof Element)) return

    const nearestControl = pointer.target.closest(SHINE_CONTROLS) as HTMLElement | null
    const nearestSurface = pointer.target.closest(SHINE_SURFACES) as HTMLElement | null
    const targets = [nearestControl, nearestSurface].filter((element, index, all): element is HTMLElement => Boolean(element) && all.indexOf(element) === index)
    const rects = targets.map(element => ({ element, rect: element.getBoundingClientRect() }))

    for (const { element, rect } of rects) {
      element.style.setProperty('--shine-x', `${pointer.x - rect.left}px`)
      element.style.setProperty('--shine-y', `${pointer.y - rect.top}px`)
    }
  })
}, { passive: true })
