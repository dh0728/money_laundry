import { NuqsAdapter } from 'nuqs/adapters/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><TooltipProvider delayDuration={200}><NuqsAdapter><App/></NuqsAdapter><Toaster richColors position="top-center"/></TooltipProvider></ThemeProvider></React.StrictMode>)

// v20 · 호버 빛 좌표: 커서 아래 표면·버튼(중첩 포함) 모두에 자기 기준 커서 위치를 넘긴다(index.css 끝 규칙과 짝).
const SHINE = '[data-slot="button"], [data-slot="card"], [data-slot="sidebar-inner"], .app-header, .work-card, .graph-layout, .glass-surface, .flow-panel, [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], .date-range-control, [data-slot="table-row"], .shine'
window.addEventListener('pointermove', e => {
  let el = (e.target as Element | null)?.closest?.(SHINE) as HTMLElement | null
  while (el) {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--shine-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--shine-y', `${e.clientY - r.top}px`)
    el = el.parentElement?.closest(SHINE) as HTMLElement | null
  }
}, { passive: true })