import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShellChrome } from './ui/ShellChrome'

createRoot(document.getElementById('root')!).render(<StrictMode><ShellChrome /></StrictMode>)
