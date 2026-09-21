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

describe('v20 B2 · 알림 정렬은 목록 표 머리글과 같은 아이콘을 쓴다', () => {
  it('초기 미정렬은 ChevronsUpDown이고 두 열 모두 정렬 안 함으로 안내한다', () => {
    seedMemory('notifications:read', [])
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect((markup.match(/lucide-chevrons-up-down/g) ?? []).length).toBe(2)
    expect((markup.match(/aria-label="정렬 안 함"/g) ?? []).length).toBe(2)
  })
})
