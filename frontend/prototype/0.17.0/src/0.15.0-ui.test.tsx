import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records } from './domain'
import Graph, { DEFAULT_HOP } from './Graph'
import App from './App'
import Dashboard from './Dashboard'
import { Notifications, Settings } from './UtilityPages'
import Detail, { verdictOptions } from './Detail'
import { SortableHead } from './shared'
import { Table, TableHeader, TableRow } from '@/components/ui/table'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const alert = records.find(r => r.kind === 'Alert' && r.owner === '오검토')!

describe('Figma v14 수정사항 · 관계 그래프', () => {
  const markup = html(<Graph model={graphFor(alert)} label="test" />)
  it('위험도 checkbox와 hop badge 없이 상시 거래 정보 toggle(기본 꺼짐)을 쓴다', () => {
    expect(markup).not.toContain('role="checkbox"')
    expect(markup).not.toMatch(/\d hop</)
    expect(markup).toMatch(/role="switch"[^>]*aria-checked="false"/)
    expect(markup).toContain('상시 거래 정보 표시')
  })
  it('hop slider는 1~5이고 기본값은 3이다', () => {
    // Radix thumb은 hydration 뒤에 role=slider가 붙으므로 SSR에서는 눈금과 기본값을 확인하고, aria-valuenow는 브라우저 QA에서 확인한다
    expect(DEFAULT_HOP).toBe(3)
    expect(markup).toMatch(/<span class="">1<\/span><span class="">2<\/span><span class="text-foreground font-semibold">3<\/span><span class="">4<\/span><span class="">5<\/span>/)
  })
  it('toolbar 순서는 화면 맞춤 → 전체화면이다', () => {
    expect(markup.indexOf('aria-label="화면 맞춤"')).toBeGreaterThan(-1)
    expect(markup.indexOf('aria-label="화면 맞춤"')).toBeLessThan(markup.indexOf('aria-label="전체화면"'))
  })
  it('시간축 slider·이전/재생/다음과 누적 거래 수를 제공한다', () => {
    for (const label of ['시간축', '이전 거래 (←)', '시간순 재생 (Space)', '다음 거래 (→)']) expect(markup).toContain(`aria-label="${label}"`)
    expect(markup).toMatch(/이 시각까지 시작된 거래 (<!-- -->)?\d+(<!-- -->)? \/ (<!-- -->)?\d+/)
  })
})

describe('Figma v14 수정사항 · 목록과 상세', () => {
  it('정렬 머리글은 현재 상태를 아이콘과 aria-sort로 드러낸다', () => {
    const head = (direction: 'desc' | 'asc' | null) => html(<Table><TableHeader><TableRow><SortableHead label="금액" active direction={direction} onSort={() => {}} /></TableRow></TableHeader></Table>)
    expect(head('desc')).toContain('data-sort="desc"'); expect(head('desc')).toContain('aria-sort="descending"')
    expect(head('asc')).toContain('data-sort="asc"')
    expect(head(null)).toContain('data-sort="none"')
  })
  it('상세 header에 연결된 Episode·검토 의견 작성 button이 없다', () => {
    const markup = html(<Detail record={alert} records={records} user="오검토" onUpdate={() => {}} onOpen={() => {}} />)
    expect(markup).not.toContain('검토 의견 작성')
    expect(markup).not.toMatch(/<button[^>]*>[^<]*<svg[^>]*>.*?<\/svg>연결된 Episode<\/button>/)
  })
  it('최종 판단은 업무 경로별 여러 선택지를 제공한다', () => {
    expect(verdictOptions('Alert').map(o => o.value)).toEqual(['normal', 'false-positive', 'link-episode', 'new-episode'])
    expect(verdictOptions('Episode')).toHaveLength(4)
  })
})

describe('Figma v14 수정사항 · 화면별', () => {
  it('로그인: 설명 문구 없이 전체 네트워크 위 글래스 로그인 박스', () => {
    const markup = html(<App />)
    expect(markup).not.toContain('금융감독원 업무 계정으로 로그인하세요')
    expect(markup).toContain('login-glass'); expect(markup).toContain('data-testid="login-network"')
  })
  it('Dashboard 개인: 업무마다 독립 카드, 전체 목록 button 없음', () => {
    const markup = html(<Dashboard records={records} user="오검토" onOpen={() => {}} />)
    expect(markup).toContain('data-testid="work-queue"')
    expect((markup.match(/work-card/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(markup).not.toContain('전체 목록')
  })
  it('알림: 모두 읽음 처리, 카드 목록, 큰 Card 래퍼 없음', () => {
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    expect(markup).toContain('모두 읽음 처리')
    expect(markup).toContain('data-testid="notification-list"')
    expect(markup).not.toContain('data-slot="card"')
  })
  it('설정: section을 박스로 감싸지 않는다', () => {
    const markup = html(<Settings user="오검토" />)
    expect(markup).toContain('settings-grid')
    expect(markup).not.toContain('data-slot="card"')
    expect(markup).not.toMatch(/rounded-lg border p-3/)
  })
})

describe('RDR 9000 조사 도우미', () => {
  it('떠다니는 진입 버튼 없이 헤더 토글 pill(렌즈 아이콘 + 이름)로 열고 닫는다', async () => {
    const { AgentToggle, AGENT_NAME } = await import('./Agent')
    const closed = html(<AgentToggle open={false} onToggle={() => {}} />), opened = html(<AgentToggle open onToggle={() => {}} />)
    expect(AGENT_NAME).toBe('RDR 9000')
    expect(closed).toContain('data-testid="rdr-eye"'); expect(closed).toContain('RDR 9000'); expect(closed).toContain('aria-pressed="false"')
    expect(opened).toContain('aria-pressed="true"')
    const source = (await import('node:fs')).readFileSync(new URL('./Agent.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('AgentLauncher')
  })
  it('이전 대화 목록은 대화창 뒤(오른쪽 기준 바깥)에 포개져 있다가 펼쳐진다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toMatch(/data-testid="agent-history" data-open="false"/)
    expect(markup).toMatch(/agent-history absolute top-0 bottom-0 right-full z-0/)
    expect(markup).toMatch(/agent-chat relative z-10/)
  })
})
