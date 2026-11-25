import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/theme.css'
import RedesignApp from './RedesignApp'

// 새 디자인(Figma "design · 2026-11-17") 화면의 진입점. redesign.html 에서 연다.
// 기존 화면(index.html → src/next, ant-review.html)과 섞이지 않게 따로 둔다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RedesignApp />
  </StrictMode>,
)
