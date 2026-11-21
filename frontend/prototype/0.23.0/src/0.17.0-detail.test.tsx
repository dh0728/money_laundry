import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import Detail, { josa } from './Detail'
import PatternGlyph, { type PatternKey } from './PatternGlyph'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const detailSource = readFileSync(new URL('./Detail.tsx', import.meta.url), 'utf8')
const sharedSource = readFileSync(new URL('./shared.tsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('Figma v17 · josa(word, 이, 가) 조사 헬퍼', () => {
  it("받침 있는 이름(안분석) 뒤에는 '이'를 쓴다", () => {
    expect(josa('안분석', '이', '가')).toBe('이')
  })
  it("받침 없는 이름(오검토) 뒤에는 '가'를 쓴다", () => {
    expect(josa('오검토', '이', '가')).toBe('가')
  })
  it('을/를, 은/는에도 같은 규칙을 적용할 수 있다', () => {
    expect(josa('안분석', '을', '를')).toBe('을')
    expect(josa('오검토', '을', '를')).toBe('를')
    expect(josa('안분석', '은', '는')).toBe('은')
    expect(josa('오검토', '은', '는')).toBe('는')
  })
})

describe('Figma v17 · Detail 헤더 재배치', () => {
  const alert = records.find(r => r.kind === 'Alert')!
  const markup = html(<Detail record={alert} records={records} user={alert.owner} onUpdate={() => {}} onOpen={() => {}} />)

  it('ID 아래 제목과 연결 업무를 한 행으로 보여준다', () => {
    const headerIdx = markup.indexOf('data-testid="detail-header"')
    const idIdx = markup.indexOf(`>${alert.id}</p>`, headerIdx)
    const titleIdx = markup.indexOf(`>${alert.title}</h1>`, headerIdx)
    const linkIdx = markup.indexOf('연결된 Episode 1개', titleIdx)
    expect(idIdx).toBeGreaterThan(headerIdx)
    expect(titleIdx).toBeGreaterThan(idIdx)
    expect(linkIdx).toBeGreaterThan(titleIdx)
  })

  it('태그 행은 상태·위험·탐지 유형·업무 메타데이터를 담는다', () => {
    const tagsIdx = markup.indexOf('data-testid="detail-tags"')
    expect(tagsIdx).toBeGreaterThan(-1)
    const tags = markup.slice(tagsIdx, markup.indexOf('</header>', tagsIdx))
    expect(tags).toContain(`모델 판별 · ${alert.pattern} 의심 ${alert.probability}%`)
    expect(tags).toContain(alert.status)
    expect(tags).toContain(`담당 ${alert.owner}`)
    expect(tags).toContain(`탐지 ${alert.date}`)
    expect(tags).toContain(`${alert.age}일 경과`)
    expect(tags).not.toContain('연결된 Episode')
  })

  it('팝오버는 닫힌 상태에서는 렌더되지 않고(Radix 기본), 목록 항목은 id/title/위험 배지를 보여주며 onOpen으로 연다', () => {
    // 닫힌 Popover는 SSR에서 content를 렌더하지 않는다(Radix 기본 동작) — 트리거 button만 존재해야 한다
    expect(markup).toContain('data-slot="popover-trigger"')
    expect(markup).not.toContain('data-slot="popover-content"')
    // 목록 항목 구조는 소스에서 id·title·RiskBadge와 onOpen 연결을 갖도록 작성돼 있다
    expect(sharedSource).toMatch(/onClick=\{\(\) => onOpen\(linked\)\}/)
    expect(sharedSource).toMatch(/<RiskBadge risk=\{linked\.risk\} score=\{linked\.score\} \/>/)
  })

  it('우측에는 읽기 전용 안내만 남고, 조사(이/가)는 담당자 이름 받침에 맞다', () => {
    const other = records.find(r => r.kind === 'Alert' && r.owner !== '오검토')!
    const m = html(<Detail record={other} records={records} user="오검토" onUpdate={() => {}} onOpen={() => {}} />)
    const expected = `최종 처리는 담당자 ${other.owner}${josa(other.owner, '이', '가')} 수행합니다.`
    expect(m).toContain(expected)
  })
})

describe('Figma v17 · 검토 의견 textarea (리사이즈 핸들/빈 공간 제거)', () => {
  it('id="reason" textarea는 세로 resize와 min-h-[280px]를 갖는다', () => {
    const tag = detailSource.match(/<Textarea id="reason"[\s\S]*?\/>/)?.[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('resize-y')
    expect(tag).toContain('min-h-[280px]')
  })

  it('결론 카드는 flex로 textarea가 남는 높이를 흡수하도록 구성된다', () => {
    expect(detailSource).toMatch(/CardContent className="flex flex-col gap-6 h-full"/)
    expect(detailSource).toMatch(/space-y-2 flex-1 flex flex-col min-h-0/)
  })
})

describe('Figma v17 · PatternGlyph는 red를 쓰지 않는다', () => {
  const ALL_KEYS: PatternKey[] = ['FAN_OUT', 'FAN_IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK', 'NON_PATTERN']

  it.each(ALL_KEYS)('%s 글리프 markup에는 var(--graph-l1)/destructive fill이 없다', (key) => {
    const svg = renderToStaticMarkup(<PatternGlyph pattern={key} />)
    expect(svg).not.toContain('var(--graph-l1)')
    expect(svg).not.toContain('destructive')
  })

  it('강조 노드는 흰색(foreground) 채움 원으로 렌더된다', () => {
    const svg = renderToStaticMarkup(<PatternGlyph pattern="FAN_OUT" />)
    expect(svg).toContain('fill="var(--foreground)"')
    expect(svg).not.toContain('fill="var(--graph-l1)"')
  })

  it('Alert 개요("의심 거래 모양")도 같은 글리프를 쓰고 red가 없다', () => {
    const alert = records.find(r => r.kind === 'Alert')!
    const markup = html(<Detail record={alert} records={records} user={alert.owner} onUpdate={() => {}} onOpen={() => {}} />)
    const overviewIdx = markup.indexOf('data-testid="overview"')
    expect(overviewIdx).toBeGreaterThan(-1)
    expect(markup.indexOf(`data-pattern="${alert.pattern}"`, overviewIdx)).toBeGreaterThan(overviewIdx)
    expect(markup).not.toContain('var(--graph-l1)')
  })

  it('의심 거래 모양은 도식 하나만 그래프 이동 버튼이고 중복 하단 action이 없다', () => {
    const alert = records.find(r => r.kind === 'Alert')!
    const markup = html(<Detail record={alert} records={records} user={alert.owner} onUpdate={() => {}} onOpen={() => {}} />)
    const overview = markup.slice(markup.indexOf('data-testid="overview"'), markup.indexOf('data-testid="overview"') + 12000)
    expect(overview.match(/aria-label="자금 흐름 그래프로 이동"/g)).toHaveLength(1)
    expect(overview).toContain('class="pattern-link ')
    expect(overview).not.toContain('>자금 흐름에서 확인</button>')
    expect(detailSource).not.toMatch(/\bNetwork\b/)
  })

  it('도식 버튼은 hover/focus에서만 중립 테마 glow를 표시하고 reduced motion을 존중한다', () => {
    const base = cssSource.match(/\.pattern-link\s*\{[^}]*\}/)?.[0] ?? ''
    const interactive = cssSource.match(/\.pattern-link:is\(:hover,\s*:focus-visible\)\s*\{[^}]*\}/)?.[0] ?? ''
    expect(base).toContain('transition:')
    expect(base).not.toMatch(/graph-l1|destructive|#e60000|#ff0000/)
    expect(interactive).toContain('color-mix(in oklch, var(--foreground)')
    expect(interactive).toContain('box-shadow:')
    expect(interactive).not.toMatch(/graph-l1|destructive|#e60000|#ff0000/)
    expect(cssSource).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.pattern-link\s*\{\s*transition:\s*none/)
  })
})
