import type { ReactNode } from 'react'
import { useSelectionIndicator } from './useSelectionIndicator'

// v24 shared.tsx: 사이드바 선택 배경이 누른 메뉴로 미끄러져 간다
export function SidebarSelection({ value, children }: { value: string; children: ReactNode }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-nav-id]', '[data-nav-id][data-active=true]')
  return (
    <div ref={root} className="app-sidebar-surface">
      <span aria-hidden="true" data-slot="sidebar-indicator" data-animate={animate} className="sidebar-indicator" style={{ visibility: geometry ? 'visible' : 'hidden', transform: `translate(${geometry?.x ?? 0}px, ${geometry?.y ?? 0}px)`, width: geometry?.width ?? 0, height: geometry?.height ?? 0, clipPath: `inset(${geometry?.clipTop ?? 0}px 0 ${geometry?.clipBottom ?? 0}px 0)` }} />
      {children}
    </div>
  )
}
