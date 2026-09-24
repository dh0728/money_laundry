import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import { Notifications, Settings } from './UtilityPages'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('Figma v15b 수정사항 · Notifications 카드 분할', () => {
  const markup = html(<Notifications records={records} onOpen={() => {}} />)

  it('각 notification-card는 우측에 되돌리기 rail을 가진 flex 레이아웃이다(Figma v17)', () => {
    expect(markup).toContain('notification-card flex items-stretch')
    expect(markup).toContain('notification-rail')
  })

  it('첫 번째 카드에 첫 번째 레코드 제목이 포함된다', () => {
    const firstRecord = records[0]
    expect(markup).toContain(firstRecord.title)
  })

  it('드롭다운 메뉴(aria-haspopup="menu")를 포함하지 않는다', () => {
    expect(markup).not.toContain('aria-haspopup="menu"')
  })

  it('요약 보기 문구를 포함하지 않는다', () => {
    expect(markup).not.toContain('요약 보기')
  })
})

describe('Figma v15b 수정사항 · Settings 섹션 제목', () => {
  const markup = html(<Settings user="오검토" />)

  it('일반 섹션 제목이 text-lg font-bold tracking-tight를 가진다', () => {
    expect(markup).toMatch(/<h2[^>]*class="[^"]*text-lg[^"]*font-bold[^"]*tracking-tight[^"]*">일반<\/h2>/)
  })

  it('목록 섹션 제목이 text-lg font-bold tracking-tight를 가진다', () => {
    expect(markup).toMatch(/<h2[^>]*class="[^"]*text-lg[^"]*font-bold[^"]*tracking-tight[^"]*">목록<\/h2>/)
  })

  it('알림 섹션 제목이 text-lg font-bold tracking-tight를 가진다', () => {
    expect(markup).toMatch(/<h2[^>]*class="[^"]*text-lg[^"]*font-bold[^"]*tracking-tight[^"]*">알림<\/h2>/)
  })

  it('테마 섹션 제목이 text-lg font-bold tracking-tight를 가진다', () => {
    expect(markup).toMatch(/<h2[^>]*class="[^"]*text-lg[^"]*font-bold[^"]*tracking-tight[^"]*">테마<\/h2>/)
  })
})
