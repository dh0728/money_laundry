import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import App from './App'
import { pageFromHash } from './navigation'

afterEach(() => window.history.replaceState({}, '', '/'))

// 로그인 화면을 지나 앱 안으로 들어간다
const renderSignedIn = () => {
  render(<App />, { wrapper: NuqsTestingAdapter })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
}

describe('앱 틀', () => {
  it('처음에는 대시보드를 연다', () => {
    renderSignedIn()
    // 화면 안의 큰 제목 대신 사이드바 메뉴 선택과 대시보드 탭으로 알 수 있다
    expect(screen.getByRole('tab', { name: '내 담당' })).toBeInTheDocument()
  })

  it('아직 옮기지 않은 메뉴는 준비 중으로 보여 준다', async () => {
    renderSignedIn()
    fireEvent.click(screen.getByRole('button', { name: '알림' }))
    expect(await screen.findByText('준비 중인 화면입니다.')).toBeInTheDocument()
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
  })

  it('#alerts/번호 주소는 Alert 상세를 열고 판정 선택지를 보여 준다', async () => {
    window.history.replaceState({}, '', '/#alerts/3000')
    renderSignedIn()
    window.location.hash = 'alerts/3000'
    expect(await screen.findByTestId('detail-id')).toHaveTextContent('A-3000')
    expect(screen.getByTestId('header-back')).toHaveTextContent('Alert 목록')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '검토 의견' }))
    fireEvent.click(screen.getByRole('tab', { name: '검토 의견' }))
    expect(await screen.findByRole('combobox', { name: '판정' })).toHaveTextContent('정상 · 종결')
  })

  it('앱 머리에 지금 데이터가 mock인지 보여 준다', () => {
    renderSignedIn()
    expect(within(screen.getByTestId('header-actions')).getByText('mock 데이터')).toBeInTheDocument()
  })

  it('헤더 가운데 전역 검색에서 Alert를 찾아 상세로 간다', async () => {
    renderSignedIn()
    const search = screen.getByRole('combobox', { name: '전역 검색' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'A-3001' } })
    fireEvent.click(await screen.findByRole('option', { name: /A-3001/ }))
    expect(window.location.hash).toBe('#alerts/3001')
  })

  it('모르는 주소는 대시보드로 보낸다', () => {
    expect(pageFromHash('#episodes')).toBe('episodes')
    expect(pageFromHash('#upload')).toBe('dashboard')
  })
})

describe('로그인', () => {
  it('처음에는 로그인 화면을 보여 주고, 로그아웃하면 다시 돌아온다', async () => {
    render(<App />)
    expect(screen.getByLabelText('이메일')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    fireEvent.click(screen.getByRole('button', { name: /오분석/ }))
    fireEvent.click(await screen.findByRole('button', { name: '현재 세션 로그아웃' }))
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(await screen.findByLabelText('이메일')).toBeInTheDocument()
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
