import { NuqsAdapter } from 'nuqs/adapters/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><TooltipProvider delayDuration={200}><NuqsAdapter><App/></NuqsAdapter><Toaster richColors position="top-center"/></TooltipProvider></ThemeProvider></React.StrictMode>)

// v19 · 림 라이트 좌표: 누를 수 있는 요소 위에서만 커서 위치를 CSS 변수로 넘긴다(index.css 끝 규칙과 짝).
const SHINE = '[data-slot="button"], [data-slot="tabs-trigger"], .work-card, tr.cursor-pointer'
window.addEventListener('pointermove', e => {
  const el = (e.target as Element | null)?.closest?.(SHINE) as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--shine-x', `${e.clientX - r.left}px`)
  el.style.setProperty('--shine-y', `${e.clientY - r.top}px`)
}, { passive: true })