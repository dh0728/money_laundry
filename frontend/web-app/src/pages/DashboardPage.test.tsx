import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMockMyAlerts } from '@/mocks/alerts'
import { dashboardNormal } from '@/mocks/dashboard'
import { chartInputs, institutionCards } from '@/features/dashboard/metrics'
import { SectionCard } from '@/components/SectionCards'
import DashboardPage from './DashboardPage'

const useScenario = (scenario: string) => window.history.replaceState({}, '', scenario ? `/?mock=${scenario}` : '/')
const openInstitution = () => fireEvent.mouseDown(screen.getByRole('tab', { name: '기관 전체' }), { button: 0 })
const openPersonal = () => fireEvent.mouseDown(screen.getByRole('tab', { name: '내 담당' }), { button: 0 })

afterEach(() => useScenario(''))

describe('대시보드 · 내 담당', () => {
  it('mock 업무 보드는 기존 미확인·처리 전·처리 중·처리 완료 4열과 시연 한계를 표시한다', async () => {
    render(<DashboardPage />)
    openPersonal()
    const columns = await screen.findAllByTestId('work-status-column')
    expect(columns.map(column => within(column).getByText(/^(미확인|처리 전|처리 중|처리 완료)$/).textContent)).toEqual(['미확인', '처리 전', '처리 중', '처리 완료'])
    expect(screen.getByText(/지금 열 배정은 시연용 예시입니다/)).toBeInTheDocument()
  })

  it('점수를 0~1 소수 둘째 자리로 보여 준다', async () => {
    render(<DashboardPage />)
    openPersonal()
    await screen.findAllByTestId('work-card')
    expect(screen.getAllByText('0.99').length).toBeGreaterThan(0)
  })

  it('업무 카드는 해당 Alert·Episode 상세 주소로 이어진다', async () => {
    render(<DashboardPage />)
    openPersonal()
    const cards = await screen.findAllByTestId('work-card')
    for (const card of cards) expect(card.getAttribute('href')).toMatch(card.dataset.kind === 'Episode' ? /^#episodes\/\d+$/ : /^#alerts\/\d+$/)
  })

  it('mock 4열 보드는 Alert·Episode를 보여 주며 편입된 원본 Alert는 중복하지 않는다', async () => {
    render(<DashboardPage />)
    openPersonal()
    await screen.findAllByTestId('work-status-column')
    const cards = within(screen.getByTestId('work-queue')).getAllByTestId('work-card')
    expect(new Set(cards.map(card => card.dataset.kind))).toEqual(new Set(['Alert', 'Episode']))
    const hrefs = cards.map(card => card.getAttribute('href'))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    const source = await loadMockMyAlerts()
    const linked = source.content.filter(alert => alert.status === 'ESCALATED')
    expect(linked.length).toBeGreaterThan(0)
    for (const alert of linked) expect(hrefs).not.toContain(`#alerts/${alert.alertId}`)
  })

  it('윗줄은 중복 카드 없이 고위험·경과 카드와 AI 요약만 둔다', async () => {
    render(<DashboardPage />)
    openPersonal()
    const top = await screen.findByTestId('personal-top')
    expect(within(top).getAllByTestId('section-card')).toHaveLength(2)
    expect(within(top).queryByText('내 담당 미처리')).not.toBeInTheDocument()
    expect(within(top).queryByText('현재 상황')).not.toBeInTheDocument()
    const summary = within(top).getByTestId('personal-ai-summary')
    expect(within(summary).getByRole('heading', { name: 'RDR 9000 · 내 담당 요약' })).toBeInTheDocument()
    expect(within(summary).getByTestId('rdr-eye')).toBeInTheDocument()
  })

  it('빈 결과면 상태별 빈 안내를 보여 준다', async () => {
    useScenario('empty')
    render(<DashboardPage />)
    openPersonal()
    expect(await screen.findAllByText('해당 상태 업무가 없습니다.')).toHaveLength(4)
  })

  it('오류면 다시 시도 버튼을 보여 준다', async () => {
    useScenario('error')
    render(<DashboardPage />)
    openPersonal()
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})

describe('대시보드 · 기관 전체', () => {
  it('기관 요약과 Episode 업무를 구분하고 오래 열린 Episode에서 상세로 이어진다', async () => {
    render(<DashboardPage />)
    openInstitution()
    const report = await screen.findByTestId('ai-daily-report')
    expect(within(report).getByRole('heading', { name: 'RDR 9000 Daily Report' })).toBeInTheDocument()
    expect(within(report).getByTestId('rdr-eye')).toBeInTheDocument()
    const work = await screen.findByRole('region', { name: 'Episode 업무' })
    expect(report).not.toContainElement(work)
    expect(within(work).getByText('열린 Episode')).toBeInTheDocument()
    expect(within(work).getByText('오래 열린 Episode')).toBeInTheDocument()
    const table = within(work).getByRole('table')
    const row = within(table).getAllByRole('row')[1]
    const code = within(row).getAllByRole('cell')[0].textContent!
    expect(code).toMatch(/^E-\d+$/)
    fireEvent.click(row)
    expect(window.location.hash).toBe(`#episodes/${code.slice(2)}`)
    expect(screen.queryByRole('heading', { name: '담당 조사자 우선 검토' })).not.toBeInTheDocument()
  })

  it('미배정 건수 문구가 없다', async () => {
    render(<DashboardPage />)
    openInstitution()
    await screen.findByTestId('ai-daily-report')
    expect(screen.queryByText(/미배정/)).not.toBeInTheDocument()
  })

  it('빈 결과면 그래프 대신 빈 안내를 보여 준다', async () => {
    useScenario('empty')
    render(<DashboardPage />)
    openInstitution()
    expect(await screen.findByText('선택한 기간에 Alert가 없습니다.')).toBeInTheDocument()
    const work = await screen.findByRole('region', { name: 'Episode 업무' })
    expect(within(work).getByText('열린 Episode가 없습니다.')).toBeInTheDocument()
    expect(within(work).queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('대시보드 계산', () => {
  it('패턴 분포에서 코드 0(패턴 없는 이상거래)을 뺀다', () => {
    const { distribution } = chartInputs(dashboardNormal)
    expect(distribution).toHaveLength(8)
    expect(distribution.map(item => item.pattern)).not.toContain('NON_PATTERN')
    expect(distribution.map(item => item.pattern)).not.toContain('NORMAL')
  })

  it('KPI는 일별 기록 마지막 날을 오늘로 본다', () => {
    const [todayCard] = institutionCards(dashboardNormal)
    expect(todayCard.value).toBe(String(dashboardNormal.dailyAlerts!.at(-1)!.inflow))
  })

  it('신규 Alert 감소는 긍정이며 비교 기준 없는 탐지율에는 증감 배지가 없다', () => {
    const [inflow, detection] = institutionCards(dashboardNormal)
    expect([inflow.label, detection.label]).toEqual(['오늘 신규 Alert', '오늘 의심 거래 탐지율'])
    expect(detection.delta).toBeUndefined()
    const { container, rerender } = render(<SectionCard item={{ ...inflow, delta: -4.1 }} />)
    expect(container.querySelector('[data-slot="badge"]')).toHaveStyle({ backgroundColor: 'var(--risk-0)' })
    rerender(<SectionCard item={{ ...inflow, delta: 4.1 }} />)
    expect(container.querySelector('[data-slot="badge"]')).toHaveStyle({ backgroundColor: 'var(--risk-9)' })
    rerender(<SectionCard item={detection} />)
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(detection.value).toBe(`${((dashboardNormal.latestJob!.suspiciousTxCount / 115270) * 100).toFixed(2)}%`)
  })

  it('기관 카드는 Alert와 Episode를 모두 다루고 이름에 대상을 적는다', () => {
    const labels = institutionCards(dashboardNormal).map(card => card.label)
    expect(labels).toEqual(['오늘 신규 Alert', '오늘 의심 거래 탐지율', '열린 Alert', '조사 중 Episode'])
  })

  it('일별 처리 상태의 합은 그날 유입 건수와 같다', () => {
    dashboardNormal.dailyAlertStatus!.forEach((day, i) => expect(day.pending + day.inProgress + day.done).toBe(dashboardNormal.dailyAlerts![i].inflow))
  })
})

describe('요약문', () => {
  it('서버 요약문의 유형 이름을 화면 이름으로 맞춘다', async () => {
    const { alertSummary } = await import('@/features/dashboard/alertText')
    expect(alertSummary({ summary: 'NON_PATTERN · 계좌 3', primaryType: { code: 0, name: 'NON_PATTERN' } })).toBe('NON_PATTERN · 계좌 3')
    expect(alertSummary({ summary: 'G-SCATTER · 계좌 3', primaryType: { code: 3, name: 'G-SCATTER' } })).toBe('GATHER-SCATTER · 계좌 3')
    expect(alertSummary({ summary: 'CYCLE · 계좌 3', primaryType: { code: 5, name: 'CYCLE' } })).toBe('CYCLE · 계좌 3')
  })
})
