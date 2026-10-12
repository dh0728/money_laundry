import { describe, expect, it } from 'vitest'
import { alertDisplayId, episodeDisplayId, parseDisplayId } from './caseId'

describe('표시 ID', () => {
  it('Alert는 A-, Episode는 E-를 붙이고 자릿수를 맞추지 않는다', () => {
    expect(alertDisplayId(123)).toBe('A-123')
    expect(alertDisplayId('7')).toBe('A-7')
    expect(episodeDisplayId(45)).toBe('E-45')
    expect(episodeDisplayId('1')).toBe('E-1')
  })

  it('만든 ID를 다시 읽으면 원래 값이 나온다', () => {
    expect(parseDisplayId(alertDisplayId(123))).toEqual({ kind: 'ALERT', id: 123 })
    expect(parseDisplayId(episodeDisplayId(45))).toEqual({ kind: 'EPISODE', id: 45 })
  })

  it('앞뒤 공백과 대소문자를 무시한다', () => {
    expect(parseDisplayId('  a-9 ')).toEqual({ kind: 'ALERT', id: 9 })
    expect(parseDisplayId('e-10')).toEqual({ kind: 'EPISODE', id: 10 })
  })

  it('잘못된 입력은 null이다', () => {
    for (const bad of ['A-0', 'A-1.5', 'X-1', 'A-', 'A', '', '1', 'A-1a', 'A--1', 'A-+1', 'AE-1', 'A-9007199254740993']) {
      expect(parseDisplayId(bad)).toBeNull()
    }
  })
})
