import { StrictMode } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './app/App'
import { Toaster } from './components/ui/sonner'
import { ThemeProvider } from './app/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* v24와 같이 처음 방문하면 다크로 시작한다 */}
    <ThemeProvider defaultTheme="dark">
      {/* 목록 표의 정렬·페이지를 주소(URL)에 기억한다 */}
      <NuqsAdapter>
        <App />
      </NuqsAdapter>
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  </StrictMode>,
)
