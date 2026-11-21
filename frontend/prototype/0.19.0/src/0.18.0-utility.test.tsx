import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import { Notifications } from './UtilityPages'
import { useMemoryState } from './memory'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

describe('Figma v18 · 알림 정렬도 공유 SortIcon(WideNarrow + 반전)을 쓴다', () => {
  it('열 정렬 버튼에 SortIcon(arrow-down-wide-narrow)과 색 반전이 있다', () => {
    seedMemory('notifications:read', [])
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect(markup).toContain('lucide-arrow-down-wide-narrow')
    expect(markup).toContain('data-sort="desc"')
    expect(markup).toContain('bg-foreground')
    expect(markup).toContain('text-background')
    expect((markup.match(/aria-label="최신순"/g) ?? []).length).toBe(2)
  })
})
