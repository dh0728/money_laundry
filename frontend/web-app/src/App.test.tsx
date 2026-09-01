import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useEpisodeFilters } from './features/episodes/useEpisodeFilters'

describe('Episode list', () => {
  beforeEach(() => {
    useEpisodeFilters.setState({ institution: 'all', query: '' })
  })

  it('shows each mock Episode as one table row', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Episode 목록' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(5)
    expect(screen.getByText('EP-2026-0901-001')).toBeInTheDocument()
  })

  it('filters Episodes by identifier search', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Episode 검색'), {
      target: { value: '0901-003' },
    })

    const table = screen.getByRole('table')
    expect(within(table).getByText('EP-2026-0901-003')).toBeInTheDocument()
    expect(within(table).queryByText('EP-2026-0901-001')).not.toBeInTheDocument()
  })

  it('filters Episodes by financial institution', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Episode 검색'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('금융기관 필터'), {
      target: { value: '한빛은행' },
    })

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).queryByText('EP-2026-0831-014')).not.toBeInTheDocument()
  })

  it('starts a new render with the default filters', () => {
    render(<App />)

    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5)
  })
})
