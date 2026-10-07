import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import { Account, buildNotifications, Notifications, useUnreadCount } from './UtilityPages'
import { useMemoryState } from './memory'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

// memory.ts는 모듈 전역 Map을 쓰므로, 렌더 전에 값을 미리 심어두는 probe(v16-content.test.tsx와 동일 패턴)
function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

describe('Figma v17 · useUnreadCount', () => {
  it('export되어 있다', () => {
    expect(typeof useUnreadCount).toBe('function')
  })

  it('Notifications 페이지와 같은 memory key를 읽어 안 읽음 개수를 센다', () => {
    const source = buildNotifications(records)
    let count = -1
    const Probe = () => { count = useUnreadCount(records); return null }
    renderToStaticMarkup(createElement(Probe))
    expect(count).toBe(source.length)

    // Notifications에서 읽음 처리하는 것과 같은 key('notifications:read')를 미리 채워두면,
    // 다음 mount에서 useUnreadCount가 같은 소스를 보고 개수를 줄인다.
    seedMemory('notifications:read', [source[0].id, source[1].id])
    let countAfter = -1
    const Probe2 = () => { countAfter = useUnreadCount(records); return null }
    renderToStaticMarkup(createElement(Probe2))
    expect(countAfter).toBe(source.length - 2)
  })
})

describe('Figma v17 · Notifications 안 읽음/읽음 2열', () => {
  it('필터 popover 없이, 안 읽음/읽음 2열 헤더(개수 포함)를 보여준다', () => {
    seedMemory('notifications:read', [])
    const source = buildNotifications(records)
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect(markup).toContain(`안 읽음 ${source.length}`)
    expect(markup).toContain('읽음 0')
    expect(markup).not.toContain('필터')
    expect(markup).not.toContain('조건 추가')
  })

  it('검색과 기간 선택은 그대로 남아 있다', () => {
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect(markup).toContain('aria-label="알림 검색"')
  })

  it('열마다 최신순/오래된순 토글 아이콘 button이 있다', () => {
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect((markup.match(/aria-label="최신순"|aria-label="오래된순"/g) ?? []).length).toBe(2)
  })
})

// "모두 읽음 처리" 텍스트를 감싸는 <button ...> 여는 태그(속성 부분)만 잘라낸다. 아이콘 svg가
// 텍스트 앞에 오므로, 텍스트 위치에서 거슬러 올라가 가장 가까운 <button을 찾는다.
function openingButtonTagFor(markup: string, text: string) {
  const idx = markup.indexOf(text)
  const start = markup.lastIndexOf('<button', idx)
  const end = markup.indexOf('>', start)
  return markup.slice(start, end + 1)
}

describe('Figma v17 · 모두 읽음 처리 disabled', () => {
  it('일부만 읽었으면 활성 상태다', () => {
    const source = buildNotifications(records)
    seedMemory('notifications:read', [source[0].id])
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    const button = openingButtonTagFor(markup, '모두 읽음 처리')
    expect(button).toContain('<button')
    expect(button).not.toMatch(/\sdisabled(=""|(?=[\s>]))/)
  })

  it('전부 읽었으면 disabled다', () => {
    const source = buildNotifications(records)
    seedMemory('notifications:read', source.map(r => r.id))
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    const button = openingButtonTagFor(markup, '모두 읽음 처리')
    expect(button).toContain('<button')
    expect(button).toMatch(/\sdisabled(=""|(?=[\s>]))/)
  })
})

describe('Figma v17 · Account 박스 제거 + 역할 표기', () => {
  it('data-slot="card" 래퍼가 없다', () => {
    const markup = html(<Account user="오검토" onLogout={() => {}} />)
    expect(markup).not.toContain('data-slot="card"')
  })

  it('역할은 "L1"/"L2"만 표기하고 "1차 검토"·"심층 조사" 접미사가 없다', () => {
    const l1 = html(<Account user="오검토" onLogout={() => {}} />)
    const l2 = html(<Account user="김조사" onLogout={() => {}} />)
    expect(l1).toContain('<dd>L1</dd>')
    expect(l1).not.toContain('1차 검토')
    expect(l2).toContain('<dd>L2</dd>')
    expect(l2).not.toContain('심층 조사')
  })

  it('세션은 무거운 border 없이 bg-muted/40 rounded-lg 행이다', () => {
    const markup = html(<Account user="오검토" onLogout={() => {}} />)
    expect(markup).toContain('rounded-lg bg-muted/40')
    expect(markup).not.toMatch(/rounded-lg border p-4/)
  })
})
