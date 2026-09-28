import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './app/App'
import { Toaster } from './components/ui/sonner'
import { ThemeProvider } from './app/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* v24와 같이 처음 방문하면 다크로 시작한다 */}
    <ThemeProvider defaultTheme="dark">
      <App />
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  </StrictMode>,
)
