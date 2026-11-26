import type { CSSProperties, ReactNode } from 'react'
import { useSelectionIndicator } from './useSelectionIndicator'

// v24 shared.tsx: 사이드바 선택 배경이 누른 메뉴로 미끄러져 간다
export function SidebarSelection({ value, children }: { value: string; children: ReactNode }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-nav-id]', '[data-nav-id][data-active=true]')
  return (
    <div ref={root} className="app-sidebar-surface">
      <span aria-hidden="true" data-slot="sidebar-indicator" data-animate={animate} data-measured={Boolean(geometry) || undefined}
        className="sidebar-indicator" style={{
          '--sidebar-indicator-x': `${geometry?.x ?? 0}px`,
          '--sidebar-indicator-y': `${geometry?.y ?? 0}px`,
          '--sidebar-indicator-width': `${geometry?.width ?? 0}px`,
          '--sidebar-indicator-height': `${geometry?.height ?? 0}px`,
          '--sidebar-indicator-clip-top': `${geometry?.clipTop ?? 0}px`,
          '--sidebar-indicator-clip-bottom': `${geometry?.clipBottom ?? 0}px`,
        } as CSSProperties} />
      {children}
    </div>
  )
}
