import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { dashboardNormal } from '@/mocks/dashboard'
import { chartInputs, institutionCards } from '@/features/dashboard/metrics'
import DashboardPage from './DashboardPage'

const useScenario = (scenario: string) => window.history.replaceState({}, '', scenario ? `/?mock=${scenario}` : '/')
const openInstitution = () => fireEvent.mouseDown(screen.getByRole('tab', { name: '기관 전체' }), { button: 0 })

afterEach(() => useScenario(''))

describe('대시보드 · 내 담당', () => {
  it('API 상태 3종을 3열로 보여 준다', async () => {
    render(<DashboardPage />)
    const columns = await screen.findAllByTestId('work-status-column')
    expect(columns.map(column => within(column).getAllByText(/처리 전|처리 중|처리 완료/)[0].textContent)).toEqual(['처리 전', '처리 중', '처리 완료'])
  })

  it('점수를 0~1 소수 둘째 자리로 보여 준다', async () => {
    render(<DashboardPage />)
    await screen.findAllByTestId('work-card')
    expect(screen.getAllByText('0.99').length).toBeGreaterThan(0)
  })

  it('업무 카드와 먼저 볼 업무는 해당 Alert·Episode 상세 주소로 이어진다', async () => {
    render(<DashboardPage />)
    const cards = await screen.findAllByTestId('work-card')
    for (const card of cards) expect(card.getAttribute('href')).toMatch(card.dataset.kind === 'Episode' ? /^#episodes\/\d+$/ : /^#alerts\/\d+$/)
    expect(screen.getByTestId('personal-ai-first').getAttribute('href')).toMatch(/^#(alerts|episodes)\/\d+$/)
  })

  it('처리 중 열은 내 Episode이고, Episode로 보낸 Alert는 따로 나오지 않는다', async () => {
    render(<DashboardPage />)
    const [pending, working] = await screen.findAllByTestId('work-status-column')
    const kinds = (column: HTMLElement) => within(column).queryAllByTestId('work-card').map(card => card.dataset.kind)
    expect(kinds(working).length).toBeGreaterThan(0)
    expect(new Set(kinds(working))).toEqual(new Set(['Episode']))
    expect(new Set(kinds(pending))).toEqual(new Set(['Alert']))
  })

  it('윗줄은 중복 카드 없이 고위험·경과 카드와 AI 요약만 둔다', async () => {
    render(<DashboardPage />)
    const top = await screen.findByTestId('personal-top')
    expect(within(top).getAllByTestId('section-card')).toHaveLength(2)
    expect(within(top).queryByText('내 담당 미처리')).not.toBeInTheDocument()
    expect(within(top).queryByText('현재 상황')).not.toBeInTheDocument()
  })

  it('빈 결과면 상태별 빈 안내를 보여 준다', async () => {
    useScenario('empty')
    render(<DashboardPage />)
    expect(await screen.findAllByText('해당 상태 업무가 없습니다.')).toHaveLength(3)
  })

  it('오류면 다시 시도 버튼을 보여 준다', async () => {
    useScenario('error')
    render(<DashboardPage />)
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})

describe('대시보드 · 기관 전체', () => {
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
    expect(screen.getByText('미처리 Alert가 없습니다.', { selector: 'p.rounded-lg' })).toBeInTheDocument()
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

  it('기관 카드는 Alert와 Episode를 모두 다루고 이름에 대상을 적는다', () => {
    const labels = institutionCards(dashboardNormal).map(card => card.label)
    expect(labels.some(label => label.includes('Episode'))).toBe(true)
    for (const label of labels) expect(label).toMatch(/Alert|Episode/)
  })

  it('일별 처리 상태의 합은 그날 유입 건수와 같다', () => {
    dashboardNormal.dailyAlertStatus!.forEach((day, i) => expect(day.pending + day.inProgress + day.done).toBe(dashboardNormal.dailyAlerts![i].inflow))
  })
})

describe('요약문', () => {
  it('코드 0 요약문의 NORMAL을 NON_PATTERN으로 바꾼다', async () => {
    const { alertSummary } = await import('@/features/dashboard/alertText')
    expect(alertSummary({ summary: 'NORMAL · 계좌 3', primaryType: { code: 0, name: 'NORMAL' } })).toBe('NON_PATTERN · 계좌 3')
    expect(alertSummary({ summary: 'CYCLE · 계좌 3', primaryType: { code: 5, name: 'CYCLE' } })).toBe('CYCLE · 계좌 3')
  })
})
