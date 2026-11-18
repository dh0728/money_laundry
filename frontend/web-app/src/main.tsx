import { StrictMode } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './app/App'
import { Toaster } from './components/ui/sonner'
import { ThemeProvider } from './app/ThemeProvider'
import { live } from './lib/apiMode'
import RedesignApp from './redesign/RedesignApp'

// 새 디자인(src/redesign) 확인용 전환. 주소에 ?ui=old 를 붙이면 기존 화면, ?ui=new 를 붙이면 새 화면이다.
// 아무것도 안 붙이면 mock 모드는 새 화면, 실제 API 모드(VITE_API_MODE=live)는 기존 화면을 쓴다 — 새 화면은 아직 API 를 연결하지 않았다.
const ui = new URLSearchParams(window.location.search).get('ui')
const redesign = ui === 'new' || (ui !== 'old' && !live)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {redesign ? (
      <RedesignApp />
    ) : (
      // v24와 같이 처음 방문하면 다크로 시작한다
      <ThemeProvider defaultTheme="dark">
        {/* 목록 표의 정렬·페이지를 주소(URL)에 기억한다 */}
        <NuqsAdapter>
          <App />
        </NuqsAdapter>
        <Toaster richColors position="top-center" />
      </ThemeProvider>
    )}
  </StrictMode>,
)
