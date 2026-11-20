import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cases, type CaseRecord } from '../dashboard-data'
import { CaseCard, StatusTag } from './Tags'

afterEach(cleanup)

describe('human verdict presentation', () => {
  it.each([null, 'normal', 'abnormal'] as const)('exposes %s independently of model risk and processing state', verdict => {
    const item: CaseRecord = { ...cases[0], verdict, score: 0.99, workState: 'done' }
    const { rerender } = render(<CaseCard item={item} />)
    expect(screen.getByRole('article')).toHaveAttribute('data-verdict', verdict ?? 'unjudged')
    rerender(<CaseCard item={{ ...item, score: 0.1, workState: 'unread' }} />)
    expect(screen.getByRole('article')).toHaveAttribute('data-verdict', verdict ?? 'unjudged')
  })

  it('keeps normal judgment distinct from completed processing', () => {
    render(<><StatusTag preset="normal">정상</StatusTag><StatusTag preset="done">처리 완료</StatusTag></>)
    expect(screen.getByText('정상')).toHaveAttribute('data-preset', 'normal')
    expect(screen.getByText('처리 완료')).toHaveAttribute('data-preset', 'done')
  })
})
