import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import Lists, { RecordTable } from './Lists'
import { RiskBadge } from './shared'
import { useMemoryState } from './memory'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const noop = () => {}

// memory.ts는 모듈 전역 Map을 쓰므로, 렌더 전에 값을 미리 심어두는 probe(v16-content.test.tsx·v17-utility.test.tsx와 동일 패턴)
function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

const alerts = records.filter(r => r.kind === 'Alert')

describe('Figma v17 수정사항 · 목록 페이지당 행수는 설정을 따른다', () => {
  it('기본값(설정을 건드리지 않았을 때)은 20행이다', () => {
    seedMemory('settings:rows', '20') // Settings 페이지 기본값과 동일하게 명시적으로 심어 테스트 순서에 무관하게 만든다
    const markup = html(<Lists kind="Alert" records={records} user="오검토" onOpen={noop} state="normal" setState={noop} />)
    expect(alerts.length).toBe(22) // 20보다 많아야 페이지네이션이 실제로 잘리는지 확인할 수 있다
    expect(markup).toContain('1–20 / 22건')
    expect(markup.match(/cursor-pointer/g)?.length).toBe(20)
  })

  it('설정에서 50으로 바꾸면 그 값을 그대로 쓴다(22건 전체가 한 페이지)', () => {
    seedMemory('settings:rows', '50')
    const markup = html(<Lists kind="Alert" records={records} user="오검토" onOpen={noop} state="normal" setState={noop} />)
    expect(markup).toContain('1–22 / 22건')
    expect(markup.match(/cursor-pointer/g)?.length).toBe(22)
    seedMemory('settings:rows', '20') // 이후 테스트에 영향 없도록 기본값으로 되돌린다
  })
})

describe('Figma v17 수정사항 · 정렬 머리글 반전', () => {
  it('정렬 중인 열은 justify-between 버튼과 aria-sort를 갖고, 정렬 안 된 열은 aria-sort=none이다', () => {
    // RecordTable의 useSort 초기값은 score desc이므로 '위험도' 열이 기본으로 정렬돼 있다
    const markup = html(<RecordTable rows={alerts.slice(0, 3)} onOpen={noop} />)
    expect(markup).toContain('aria-sort="descending"')
    expect(markup).toContain('justify-between')
    expect(markup).not.toContain('justify-end') // align prop이 더 이상 버튼 정렬을 바꾸지 않는다
    expect(markup).not.toContain('justify-start')
    expect(markup.match(/aria-sort="none"/g)?.length).toBe(7) // 나머지 7개 열은 정렬 안 됨
  })

  it('index.css에 aria-sort 기반 머리글 반전(bg-foreground/text-background) 규칙이 있다', () => {
    const cssPath = fileURLToPath(new URL('./index.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf-8')
    expect(css).toMatch(/\[data-slot=table-head\]\[aria-sort=ascending\][\s\S]{0,80}?var\(--foreground\)/)
    expect(css).toContain('[data-slot=table-cell][data-sorted=true]')
  })
})

describe('Figma v17 수정사항 · 정렬된 열의 셀 강조', () => {
  it('현재 정렬 중인 열(기본 score)의 셀에만 data-sorted="true"가 붙는다', () => {
    const rows = alerts.slice(0, 4)
    const markup = html(<RecordTable rows={rows} onOpen={noop} />)
    expect(markup.match(/data-sorted="true"/g)?.length).toBe(rows.length)
  })
})

describe('Figma v17 수정사항 · RiskBadge는 outline이 아니라 채움이다', () => {
  it('배경은 riskTone 인라인 style이고 border가 없다', () => {
    const markup = html(<RiskBadge risk="고위험" score={92} />)
    expect(markup).toMatch(/style="background-color:/)
    expect(markup).not.toContain('data-variant="outline"')
    expect(markup).toContain('border-0')
    expect(markup).not.toMatch(/border-border/)
  })

  it('고위험(진한 색)은 흰 글자, 저위험(옅은 회색)은 대비를 위해 어두운 글자를 쓴다', () => {
    const high = html(<RiskBadge risk="고위험" score={92} />)
    const low = html(<RiskBadge risk="저위험" score={12} />)
    expect(high).toContain('text-white')
    expect(low).not.toContain('text-white')
    expect(low).toContain('text-foreground')
  })
})
