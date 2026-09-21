import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import { Notifications, Settings } from './UtilityPages'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('Figma v20 · Notifications 카드 분할', () => {
  const markup = html(<Notifications records={records} onOpen={() => {}} />)

  it('각 notification-card는 rail 없이 점 버튼으로 읽음 상태를 바꾼다', () => {
    expect(markup).toContain('notification-card flex items-center gap-2.5')
    expect(markup).not.toContain('notification-rail')
    expect(markup).toContain('data-testid="notification-dot"')
    expect(markup).toContain('읽음으로 표시')
  })

  it('작은 점 영역·3단 본문을 쓰고 건수는 하단 메타에 표시한다', () => {
    expect(markup).toContain('size-7 rounded-full bg-transparent')
    expect(markup).toContain('hover:bg-muted/70 focus-visible:bg-muted/70')
    expect(markup).toContain('text-base font-semibold')
    expect(markup).toContain(`${records[0].count}건`)
    expect(markup).not.toContain('요약 · 위험')
    expect(markup).not.toContain('ml-auto shrink-0 self-center')
    expect(markup).toContain('data-shine="off"')
  })

  it('점 상태 버튼과 카드 열기 버튼은 형제다', () => {
    expect(markup).toMatch(/data-testid="notification-dot"><span[^>]*><\/span><\/button><button[^>]*aria-label="[^"]+ 알림 열기"/)
  })

  it('호버·키보드 포커스는 내부 버튼이 아닌 카드 전체 테두리를 밝힌다', () => {
    expect(css).toMatch(/\.notification-card[^}]*transition:/)
    expect(css).toMatch(/\.notification-card[^}]*:focus-within/)
    expect(css).toMatch(/\.notification-card-action::after\s*\{\s*display:\s*none/)
  })

  it('열 머리글은 목록 표와 같은 정렬 대기 ChevronsUpDown 아이콘을 쓴다', () => {
    expect(markup).toContain('lucide-chevrons-up-down')
    expect(markup).not.toContain('wide-narrow')
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
