import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import App from './App'
import { pageFromHash } from './navigation'
import { writeMemory } from '@/lib/memory'

afterEach(() => window.history.replaceState({}, '', '/'))

// mock 모드는 로그인 없이 앱 안으로 들어간다
const renderSignedIn = () => {
  render(<App />, { wrapper: NuqsTestingAdapter })
}

describe('앱 틀', () => {
  it('처음에는 대시보드를 연다', () => {
    renderSignedIn()
    expect(screen.getByRole('tab', { name: '기관 전체' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '내 담당' })).toHaveAttribute('aria-selected', 'false')
  })

  it('알림 메뉴는 알림 목록을 연다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: '알림' }))
    expect(await screen.findByRole('textbox', { name: '알림 검색' })).toBeInTheDocument()
  })

  it('Episodes 메뉴는 Episode 목록을 연다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: 'Episode 목록' }))
    expect(await screen.findByRole('textbox', { name: 'Episode 검색' })).toBeInTheDocument()
  })

  it('Alerts 메뉴는 내 담당 Alert 목록을 연다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: 'Alert 목록' }))
    expect(await screen.findByRole('textbox', { name: 'Alert 검색' })).toBeInTheDocument()
    expect(await screen.findByText('담당자: 내 담당')).toBeInTheDocument()
    const first = screen.getByRole('row', { name: /A-3000 계좌 3개/ })
    expect(within(first).getByText('NON_PATTERN')).toBeInTheDocument()
    expect(within(first).queryByText(/NORMAL ·/)).not.toBeInTheDocument()
  })

  it('#alerts/번호 주소는 Alert 상세를 열고 판정 선택지를 보여 준다', async () => {
    window.history.replaceState({}, '', '/#alerts/3000')
    renderSignedIn()
    window.location.hash = 'alerts/3000'
    expect(await screen.findByTestId('detail-id')).toHaveTextContent('A-3000')
    expect(screen.getByTestId('header-back')).toHaveTextContent('Alert 목록')
    const candidates = screen.getByRole('list', { name: '거래 패턴 후보' })
    expect(candidates.children.length).toBeGreaterThan(1)
    expect(candidates).toHaveTextContent('%')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '검토 의견' }))
    fireEvent.click(screen.getByRole('tab', { name: '검토 의견' }))
    expect(await screen.findByRole('combobox', { name: '판정' })).toHaveTextContent('정상 · 종결')
  })

  it('mock Episode에서 Alert 연결을 해제하면 상세와 원본 Alert의 연결 상태가 함께 바뀐다', async () => {
    window.history.replaceState({}, '', '/#episodes/800')
    renderSignedIn()
    window.location.hash = 'episodes/800'
    const linked = await screen.findByTestId('linked-alerts')
    fireEvent.click(within(linked).getByRole('button', { name: '연결 Alert 선택' }))
    fireEvent.click(within(linked).getByRole('checkbox', { name: 'Alert A-3003 선택' }))
    fireEvent.change(within(linked).getByRole('textbox', { name: '연결 해제 사유' }), { target: { value: '별도 조사' } })
    fireEvent.click(within(linked).getByRole('button', { name: '선택 Alert 연결 해제' }))
    const updatedLinked = await screen.findByTestId('linked-alerts')
    expect(await within(updatedLinked).findByRole('button', { name: 'A-3018 상세 보기' })).toBeInTheDocument()
    expect(within(updatedLinked).queryByRole('button', { name: 'A-3003 상세 보기' })).not.toBeInTheDocument()
    window.location.hash = 'alerts/3003'
    await waitFor(() => expect(screen.getByTestId('detail-id')).toHaveTextContent('A-3003'))
    expect(screen.queryByRole('button', { name: /연결된 Episode E-800/ })).not.toBeInTheDocument()
  })

  it('mock Alert에서 제외한 거래는 상세와 목록의 건수에 함께 반영된다', async () => {
    window.history.replaceState({}, '', '/#alerts/3000')
    renderSignedIn()
    window.location.hash = 'alerts/3000'
    await waitFor(() => expect(screen.getByTestId('detail-id')).toHaveTextContent('A-3000'))
    fireEvent.mouseDown(screen.getByRole('tab', { name: /거래/ }))
    fireEvent.click(screen.getByRole('tab', { name: /거래/ }))
    fireEvent.click(screen.getByRole('button', { name: '거래 선택' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '거래 T-300000 선택' }))
    fireEvent.change(screen.getByRole('textbox', { name: '거래 제외 사유' }), { target: { value: '조사 범위 밖' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
    expect(screen.queryByRole('button', { name: /300000 거래 거래 내역에서 보기/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /거래/ })).toHaveTextContent('3')
    fireEvent.click(screen.getByTestId('header-back'))
    const first = await screen.findByRole('row', { name: /A-3000 계좌/ })
    expect(first).toHaveTextContent('3건')
  })

  it('앱 머리에는 전체 데이터의 출처를 단정하는 배지를 두지 않는다', () => {
    renderSignedIn()
    expect(within(screen.getByTestId('header-actions')).queryByText(/mock|실제 API/)).not.toBeInTheDocument()
  })

  it('RDR 9000을 닫고 다시 열 수 있으며, 화면 이동에도 패널 상태가 유지된다', async () => {
    renderSignedIn()
    expect(screen.queryByRole('region', { name: 'RDR 9000' })).not.toBeInTheDocument()
    const trigger = within(screen.getByTestId('header-search')).getByRole('button', { name: 'RDR 9000 열기' })
    fireEvent.click(trigger)
    expect(screen.getByRole('region', { name: 'RDR 9000' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'RDR 9000' })).getByText(/전체 미처리 업무/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 닫기' }))
    expect(screen.queryByRole('region', { name: 'RDR 9000' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Alert 목록' }))
    expect(await screen.findByRole('textbox', { name: 'Alert 검색' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 열기' }))
    expect(screen.getByRole('region', { name: 'RDR 9000' })).toBeInTheDocument()
  })

  it('RDR 9000 심볼을 누르면 패널이 닫힌다', () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 열기' }))
    const header = screen.getByTestId('agent-header')
    fireEvent.click(within(header).getByRole('button', { name: 'RDR 9000 심볼로 닫기' }))
    expect(screen.queryByRole('region', { name: 'RDR 9000' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RDR 9000 열기' })).toBeInTheDocument()
  })

  it('헤더의 RDR 9000 심볼을 다시 누르면 패널이 닫힌다', () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 열기' }))
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 패널 숨기기' }))
    expect(screen.queryByRole('region', { name: 'RDR 9000' })).not.toBeInTheDocument()
  })

  it('RDR 9000도 사건 위험 점수를 화면과 같은 0~1 값으로 표시한다', async () => {
    window.history.replaceState({}, '', '/#alerts/3000')
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 열기' }))
    window.location.hash = 'alerts/3000'
    const agent = screen.getByRole('region', { name: 'RDR 9000' })
    expect(await within(agent).findByText(/위험 점수 0\.99/)).toBeInTheDocument()
    expect(within(agent).queryByText(/99%/)).not.toBeInTheDocument()
  })

  it('빈·오류 mock 상태에서는 RDR 9000에 정상 건수를 보여 주지 않는다', () => {
    for (const scenario of ['empty', 'error']) {
      window.history.replaceState({}, '', `/?mock=${scenario}`)
      const view = render(<App />, { wrapper: NuqsTestingAdapter })
      fireEvent.click(screen.getByRole('button', { name: 'RDR 9000 열기' }))
      expect(within(screen.getByRole('region', { name: 'RDR 9000' })).queryByText(/미처리 업무 25건/)).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('헤더 가운데 전역 검색에서 Alert를 찾아 상세로 간다', async () => {
    renderSignedIn()
    const search = screen.getByRole('combobox', { name: '전역 검색' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'A-3001' } })
    fireEvent.click((await screen.findAllByRole('option', { name: /A-3001/ }))[0])
    expect(window.location.hash).toBe('#alerts/3001')
  })

  it('전역 검색에서 화면의 NON_PATTERN 태그로 Alert를 찾는다', async () => {
    renderSignedIn()
    const search = screen.getByRole('combobox', { name: '전역 검색' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'NON_PATTERN' } })
    expect(await screen.findByRole('option', { name: /^A-3000/ })).toBeInTheDocument()
  })

  it('알림을 읽음 처리하고 사건으로 이동하며, 전역 검색에서도 찾는다', async () => {
    writeMemory('notifications:read', [])
    renderSignedIn()
    expect(await screen.findByLabelText('안 읽은 알림 7건 · mock 데이터')).toBeInTheDocument()
    expect(await screen.findByLabelText(/내 미처리 업무 \d+건 · mock 데이터/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^알림$/ }))
    const first = await screen.findByRole('button', { name: 'A-3000 알림 열기' })
    expect(within(first).getByText('NON_PATTERN')).toBeInTheDocument()
    expect(within(first).getByTitle(/모델 위험 점수/)).toHaveTextContent('0.99')
    expect(within(first).queryByText(/NORMAL ·/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'A-3000 읽음으로 표시' }))
    expect(screen.getByRole('heading', { name: '읽음 1' })).toBeInTheDocument()
    expect(screen.getByLabelText('안 읽은 알림 6건 · mock 데이터')).toBeInTheDocument()
    const search = screen.getByRole('combobox', { name: '전역 검색' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: '검수 결과' } })
    fireEvent.click(await screen.findByRole('option', { name: /Episode 검수 결과/ }))
    expect(window.location.hash).toBe('#episodes/802')
  })

  it('알림 빈·오류 화면을 구분한다', async () => {
    for (const [scenario, message] of [['empty', '표시할 알림이 없습니다.'], ['error', '알림을 불러오지 못했습니다.']]) {
      window.history.replaceState({}, '', `/?mock=${scenario}`)
      const view = render(<App />, { wrapper: NuqsTestingAdapter })
      fireEvent.click(screen.getByRole('button', { name: /^알림$/ }))
      expect(await screen.findByText(message)).toBeInTheDocument()
      view.unmount()
    }
  })

  it('모르는 주소는 대시보드로 보낸다', () => {
    expect(pageFromHash('#episodes')).toBe('episodes')
    expect(pageFromHash('#upload')).toBe('dashboard')
  })
})

describe('로그인', () => {
  it('mock 모드는 로그인 없이 열리고 로그아웃 확인 뒤에도 시연을 계속한다', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /오분석/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /오분석/ }))
    fireEvent.click(await screen.findByRole('button', { name: '현재 세션 로그아웃' }))
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('button', { name: /오분석/ })).toBeInTheDocument()
  })
})

describe('설정·계정', () => {
  it('설정에서 테마를 고를 수 있다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(await screen.findByRole('radio', { name: '라이트 모드' })).toBeInTheDocument()
  })

  it('계정에서 역할 권한을 보여 주고 로그아웃 확인창을 연다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: /오분석/ }))
    expect(await screen.findByRole('list', { name: '할 수 있는 일' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '현재 세션 로그아웃' }))
    expect(await screen.findByText('로그아웃할까요?')).toBeInTheDocument()
  })
})
