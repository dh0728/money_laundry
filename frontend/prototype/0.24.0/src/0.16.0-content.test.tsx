import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ageTone, records, riskSteps } from './domain'
import { buildNotifications, Notifications } from './UtilityPages'
import Detail from './Detail'
import { useMemoryState } from './memory'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

// oklch(l c h) 문자열을 숫자로 분해
const parseOklch = (s: string) => {
  const resolved = s.replace(/var\((--risk-\d)\)/, (_, token: string) => readFileSync(new URL('./index.css', import.meta.url), 'utf8').match(new RegExp(`${token}:\\s*([^;]+)`))?.[1] ?? '')
  const m = resolved.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
}

// memory.ts는 모듈 전역 Map을 쓰므로, 렌더 전에 값을 미리 심어두는 probe
function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

describe('Figma v16 · 쨍한 레드 위험도 스케일', () => {
  it('riskSteps[9]는 순수 레드(oklch 0.628 0.2577 29.23)다', () => {
    const red = parseOklch(riskSteps[9])
    expect(red.l).toBeCloseTo(0.628, 3)
    expect(red.c).toBeCloseTo(0.2577, 3)
    expect(red.h).toBeCloseTo(29.23, 2)
  })

  it('riskSteps[0]은 채도 0인 무채색(회색)이다', () => {
    expect(parseOklch(riskSteps[0]).c).toBe(0)
  })

  it('채도는 bucket이 오를수록 단조 증가한다', () => {
    const chromas = riskSteps.map(s => parseOklch(s).c)
    for (let i = 1; i < chromas.length; i++) expect(chromas[i]).toBeGreaterThan(chromas[i - 1])
  })
})

describe('Figma v16 · 경과일(age) 히트 색상', () => {
  it('ageTone(0)은 회색(riskSteps[0])이다', () => {
    expect(ageTone(0)).toBe(riskSteps[0])
    expect(parseOklch(ageTone(0)).c).toBe(0)
  })

  it('ageTone(10)은 순수 레드(riskSteps[9])다 — 5일 이상은 모두 최대치로 고정', () => {
    expect(ageTone(10)).toBe(riskSteps[9])
    expect(ageTone(5)).toBe(riskSteps[9])
  })

  it('0일과 7일 사이는 선형으로 점점 붉어진다', () => {
    const c0 = parseOklch(ageTone(0)).c, c3 = parseOklch(ageTone(3)).c, c7 = parseOklch(ageTone(7)).c
    expect(c3).toBeGreaterThan(c0)
    expect(c7).toBeGreaterThan(c3)
  })
})

describe('Figma v20 · 알림 카드 점 버튼 + 안읽음/읽음 2열', () => {
  it('buildNotifications가 export되고, 페이지가 쓰는 것과 같은 목록을 만든다', () => {
    expect(typeof buildNotifications).toBe('function')
    const list = buildNotifications(records)
    expect(list.length).toBeGreaterThan(0)
    expect(list.every(r => r.kind === 'Alert' || r.kind === 'Episode')).toBe(true)
  })

  it('카드는 우측 rail 없이, 좌측 dot을 접근 가능한 버튼으로 제공한다', () => {
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect(markup).toMatch(/notification-card[^\"]*flex items-center/)
    expect(markup).not.toContain('notification-rail')
    expect(markup).toMatch(/<button[^>]*aria-label="[^"]+ 읽음으로 표시"[^>]*data-testid="notification-dot"/)
  })

  it('읽음 상태의 점 버튼은 다시 안 읽음으로 표시할 수 있다', () => {
    const list = buildNotifications(records)
    const readTarget = list[0]
    seedMemory('notifications:read', [readTarget.id])

    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    const buttonTagFor = (id: string) => markup.match(new RegExp(`<button[^>]*aria-label="${id} 읽지 않음으로 표시"[^>]*data-testid="notification-dot"[^>]*>`))?.[0] ?? ''

    const readButton = buttonTagFor(readTarget.id)
    expect(readButton).not.toBe('')
    expect(markup).toMatch(new RegExp(`aria-label="${readTarget.id} 읽지 않음으로 표시"[^>]*><span[^>]*bg-muted-foreground/40`))
    expect(readButton).not.toMatch(/\sdisabled(=""|(?=[\s>]))/)
  })
})

describe('Figma v16 · Detail 헤더 압축', () => {
  const alert = records.find(r => r.kind === 'Alert')!
  const markup = html(<Detail record={alert} records={records} user={alert.owner} onUpdate={() => {}} onOpen={() => {}} />)

  it('header 영역이 존재하고 tabs보다 앞에 온다', () => {
    const headerIdx = markup.indexOf('data-testid="detail-header"')
    const tabsIdx = markup.indexOf('underline-tabs')
    expect(headerIdx).toBeGreaterThan(-1)
    expect(tabsIdx).toBeGreaterThan(headerIdx)
  })

  it('record id, title, status를 상하 정보 계층으로 보여준다', () => {
    const headerIdx = markup.indexOf('data-testid="detail-header"')
    const tabsIdx = markup.indexOf('underline-tabs')
    const titleIdx = markup.indexOf(`>${alert.title}</h1>`, headerIdx)
    const idIdx = markup.indexOf(`>${alert.id}</p>`, headerIdx)
    const statusIdx = markup.indexOf(`>${alert.status}<`, headerIdx)
    expect(idIdx).toBeGreaterThan(headerIdx)
    expect(titleIdx).toBeGreaterThan(idIdx)
    expect(statusIdx).toBeGreaterThan(titleIdx)
    expect(statusIdx).toBeLessThan(tabsIdx)
  })

  // v23: 연결 업무는 제목 옆에서 수량 단위를 명시한 button으로 유지한다.
  it('연결된 Episode/Alert 안내는 v17부터 팝오버를 여는 button이다', () => {
    expect(markup).toMatch(/<button[^>]*>[^<]*<svg[^>]*>.*?<\/svg>연결된 (Episode|Alert) \d+개<\/button>/)
  })
})
