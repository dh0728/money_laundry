import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as store from './memory'

describe('shared prototype memory', () => {
  it('publishes the new snapshot immediately to every same-key subscriber and unsubscribes individually', () => {
    expect(store.subscribeMemory).toBeTypeOf('function')
    const first: number[] = [], second: number[] = [], other: number[] = []
    const stopFirst = store.subscribeMemory('shared', () => first.push(store.memorySnapshot('shared', 0)))
    const stopSecond = store.subscribeMemory('shared', () => second.push(store.memorySnapshot('shared', 0)))
    const stopOther = store.subscribeMemory('other', () => other.push(1))
    store.writeMemory('shared', 7)
    stopFirst()
    store.writeMemory('shared', 8)
    stopSecond(); stopOther()
    store.writeMemory('shared', 9)
    expect(first).toEqual([7])
    expect(second).toEqual([7, 8])
    expect(other).toEqual([])
  })

  it('returns stable fallbacks without persisting them and preserves explicitly stored undefined', () => {
    expect(store.memorySnapshot).toBeTypeOf('function')
    const fallback: string[] = []
    expect(store.memorySnapshot('absent', fallback)).toBe(fallback)
    expect(store.memorySnapshot('absent', 'another fallback')).toBe('another fallback')
    store.writeMemory('undefined', undefined)
    expect(store.memorySnapshot('undefined', 'fallback')).toBeUndefined()
  })

  it('resolves consecutive functional setters against current shared state, publishing once per write', () => {
    expect(store.subscribeMemory).toBeTypeOf('function')
    let set!: ReturnType<typeof store.useMemoryState<number>>[1]
    function Consumer() { [, set] = store.useMemoryState('functional', 2); return null }
    renderToStaticMarkup(createElement(Consumer))
    const seen: number[] = []
    const stop = store.subscribeMemory('functional', () => seen.push(store.memorySnapshot('functional', 0)))
    set(value => value + 1)
    set(value => value + 1)
    stop()
    expect(seen).toEqual([3, 4])
  })
})
