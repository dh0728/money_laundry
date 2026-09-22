import { describe, expect, it } from 'vitest'
import * as AppModule from './App'
import type { TransactionTarget } from './transactionIndex'

type NavigationModule = {
  contentScreenKey?: (page: string, selected: string | null, target?: TransactionTarget) => string
  resetContentScroll?: (container: { scrollTop: number; scrollLeft: number } | null) => void
}

const navigation = AppModule as unknown as NavigationModule

describe('screen navigation scroll boundary', () => {
  it('distinguishes lists, details, and transaction targets as different content screens', () => {
    expect(navigation.contentScreenKey).toBeTypeOf('function')
    const key = navigation.contentScreenKey!

    expect(key('alerts', null)).toBe('alerts:list')
    expect(key('alerts', 'ALT-2026-1842')).toBe('alerts:record:ALT-2026-1842')
    expect(key('episodes', 'EP-2026-321')).toBe('episodes:record:EP-2026-321')
    expect(key('transactions', null)).toBe('transactions:list')
    expect(key('transactions', null, { type: 'owner', owner: 'Partnership #25481' })).toBe('transactions:owner:Partnership #25481')
    expect(key('transactions', null, { type: 'account', account: '80C8966E0' })).toBe('transactions:account:80C8966E0')
    expect(key('transactions', null, { type: 'transaction', transactionId: 'TX-163-13-1' })).toBe('transactions:transaction:TX-163-13-1')
  })

  it('resets only the vertical position of the main content scroller', () => {
    expect(navigation.resetContentScroll).toBeTypeOf('function')
    const container = { scrollTop: 1860, scrollLeft: 72 }

    navigation.resetContentScroll!(container)

    expect(container).toEqual({ scrollTop: 0, scrollLeft: 72 })
    expect(() => navigation.resetContentScroll!(null)).not.toThrow()
  })
})
