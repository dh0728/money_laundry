import { describe, expect, it, vi } from 'vitest'
import * as app from './App'

type SidebarNavigationFactory = (options: {
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  navigate: () => void
}) => () => void

describe('mobile sidebar navigation', () => {
  it('closes the Sheet after a real screen destination is chosen', () => {
    const createNavigation = (app as unknown as { createSidebarNavigation?: SidebarNavigationFactory }).createSidebarNavigation
    expect(createNavigation).toBeTypeOf('function')

    const setOpenMobile = vi.fn()
    const navigate = vi.fn()
    createNavigation!({ isMobile: true, setOpenMobile, navigate })()

    expect(navigate).toHaveBeenCalledOnce()
    expect(setOpenMobile).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('keeps the desktop sidebar state unchanged while navigating', () => {
    const createNavigation = (app as unknown as { createSidebarNavigation?: SidebarNavigationFactory }).createSidebarNavigation
    expect(createNavigation).toBeTypeOf('function')

    const setOpenMobile = vi.fn()
    const navigate = vi.fn()
    createNavigation!({ isMobile: false, setOpenMobile, navigate })()

    expect(navigate).toHaveBeenCalledOnce()
    expect(setOpenMobile).not.toHaveBeenCalled()
  })
})
