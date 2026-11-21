import { StrictMode, useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDialog } from './WorkspaceDialog'

afterEach(cleanup)

function ControlledDialogs() {
  const [state, setState] = useState<'closed' | 'first' | 'second' | 'signed-out'>('closed')
  const [disabled, setDisabled] = useState(false)
  if (state === 'signed-out') return <input aria-label="로그인 아이디" autoFocus />
  return <div data-ui="aml-app">
    <button disabled={disabled} onClick={() => setState('first')}>설정 열기</button>
    <button onClick={() => setState('first')}>다른 경로로 설정 열기</button>
    <WorkspaceDialog open={state === 'first'} onOpenChange={open => { if (!open) setState('closed') }} title="첫 대화상자">
      <button onClick={() => setState('closed')}>적용</button>
      <button onClick={() => setState('second')}>다음 대화상자</button>
      <button onClick={() => setState('signed-out')}>로그아웃</button>
      <button onClick={() => setDisabled(true)}>호출 버튼 비활성화</button>
    </WorkspaceDialog>
    <WorkspaceDialog open={state === 'second'} onOpenChange={open => { if (!open) setState('closed') }} title="다음 대화상자">
      <input aria-label="후속 입력" />
      <button onClick={() => setState('signed-out')}>로그아웃</button>
    </WorkspaceDialog>
  </div>
}

function DialogWithFallback({ removeTrigger = true, disableFallback = false }: { removeTrigger?: boolean; disableFallback?: boolean }) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const fallback = useRef<HTMLButtonElement>(null)
  return <div data-ui="aml-app">
    {(!completed || !removeTrigger) && <button onClick={() => setOpen(true)}>처리 시작</button>}
    <button ref={fallback} disabled={disableFallback}>현재 항목</button>
    <WorkspaceDialog open={open} onOpenChange={setOpen} title="처리" fallbackFocusRef={fallback}>
      <button onClick={() => { setCompleted(true); setOpen(false) }}>완료</button>
    </WorkspaceDialog>
  </div>
}

function openDialog(strict = false) {
  render(strict ? <StrictMode><ControlledDialogs /></StrictMode> : <ControlledDialogs />)
  const trigger = screen.getByRole('button', { name: '설정 열기' })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger, dialog: screen.getByRole('dialog', { name: '첫 대화상자' }) }
}

// Radix dispatches close autofocus when its focus scope finishes unmounting.
async function settleCloseFocus() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

describe('WorkspaceDialog controlled invoker focus', () => {
  it('keeps a dialog inside the active fullscreen surface', () => {
    const app = document.createElement('div')
    app.dataset.ui = 'aml-app'
    const fullscreen = document.createElement('section')
    app.append(fullscreen)
    document.body.append(app)
    const previous = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    try {
      render(<WorkspaceDialog open onOpenChange={() => {}} title="전체화면 판정"><input aria-label="판정 사유" /></WorkspaceDialog>, { container: fullscreen })
      expect(fullscreen.contains(screen.getByRole('dialog', { name: '전체화면 판정' }))).toBe(true)
      expect(screen.getByRole('dialog', { name: '전체화면 판정' }).contains(document.activeElement)).toBe(true)
    } finally {
      cleanup()
      app.remove()
      if (previous) Object.defineProperty(document, 'fullscreenElement', previous)
      else Reflect.deleteProperty(document, 'fullscreenElement')
    }
  })

  it('uses an explicit fallback when the successful action removes the invoker', async () => {
    render(<DialogWithFallback />)
    const trigger = screen.getByRole('button', { name: '처리 시작' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
    await settleCloseFocus()
    expect(trigger.isConnected).toBe(false)
    expect(screen.getByRole('button', { name: '현재 항목' })).toHaveFocus()
  })

  it('prefers the real invoker over a supplied fallback when it remains available', async () => {
    render(<DialogWithFallback removeTrigger={false} />)
    const trigger = screen.getByRole('button', { name: '처리 시작' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
    await settleCloseFocus()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('button', { name: '현재 항목' })).not.toHaveFocus()
  })

  it('does not focus an unavailable fallback', async () => {
    render(<DialogWithFallback disableFallback />)
    const trigger = screen.getByRole('button', { name: '처리 시작' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
    await settleCloseFocus()
    expect(screen.getByRole('button', { name: '현재 항목' })).not.toHaveFocus()
  })


  it.each(['Escape', '닫기', '적용'])('restores the real opening control after %s', async close => {
    const { trigger, dialog } = openDialog()
    expect(dialog.contains(document.activeElement)).toBe(true)
    if (close === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    else fireEvent.click(within(dialog).getByRole('button', { name: close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await settleCloseFocus()
    expect(trigger).toHaveFocus()
  })

  it('preserves the invoker through StrictMode focus-scope setup and cleanup', async () => {
    const { trigger } = openDialog(true)
    await settleCloseFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await settleCloseFocus()
    expect(trigger).toHaveFocus()
  })

  it('keeps the new invoker when reopened before the previous close autofocus runs', async () => {
    const { trigger, dialog } = openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '적용' }))
    const nextTrigger = screen.getByRole('button', { name: '다른 경로로 설정 열기' })
    nextTrigger.focus()
    fireEvent.click(nextTrigger)
    await settleCloseFocus()
    expect(screen.getByRole('dialog', { name: '첫 대화상자' }).contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await settleCloseFocus()
    expect(nextTrigger).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('does not restore a disabled invoker', async () => {
    const { trigger, dialog } = openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '호출 버튼 비활성화' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await settleCloseFocus()
    expect(trigger).toBeDisabled()
    expect(trigger).not.toHaveFocus()
  })

  it.each(['Escape', '닫기'])('keeps replacement focus, then restores the original invoker after %s', async close => {
    const { trigger, dialog } = openDialog()
    const next = within(dialog).getByRole('button', { name: '다음 대화상자' })
    next.focus()
    fireEvent.click(next)
    const replacement = await screen.findByRole('dialog', { name: '다음 대화상자' })
    await settleCloseFocus()
    expect(replacement.contains(document.activeElement)).toBe(true)
    expect(trigger).not.toHaveFocus()
    if (close === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    else fireEvent.click(within(replacement).getByRole('button', { name: '닫기' }))
    await settleCloseFocus()
    expect(trigger).toHaveFocus()
  })

  it('does not restore a removed inherited invoker after replacement then logout', async () => {
    const { trigger, dialog } = openDialog()
    const next = within(dialog).getByRole('button', { name: '다음 대화상자' })
    next.focus()
    fireEvent.click(next)
    const replacement = await screen.findByRole('dialog', { name: '다음 대화상자' })
    await settleCloseFocus()
    fireEvent.click(within(replacement).getByRole('button', { name: '로그아웃' }))
    await settleCloseFocus()
    expect(trigger.isConnected).toBe(false)
    expect(screen.getByRole('textbox', { name: '로그인 아이디' })).toHaveFocus()
  })

  it('does not restore a removed invoker after logout', async () => {
    const { trigger, dialog } = openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '로그아웃' }))
    await settleCloseFocus()
    expect(trigger.isConnected).toBe(false)
    expect(screen.getByRole('textbox', { name: '로그인 아이디' })).toHaveFocus()
  })
})
