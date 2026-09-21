import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><TooltipProvider delayDuration={200}><App/><Toaster richColors position="top-center"/></TooltipProvider></ThemeProvider></React.StrictMode>)
