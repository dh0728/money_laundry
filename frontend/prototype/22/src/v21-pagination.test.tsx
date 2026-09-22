import { renderToStaticMarkup } from 'react-dom/server'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Lists from './Lists'
import { records } from './domain'

const noop = () => {}
const renderList = (searchParams = '') => renderToStaticMarkup(
  <NuqsTestingAdapter searchParams={searchParams}>
    <TooltipProvider>
      <Lists kind="Alert" records={records} user="오검토" onOpen={noop} state="normal" setState={noop} />
    </TooltipProvider>
  </NuqsTestingAdapter>,
)

describe('v21 client-side pagination', () => {
  it('derives a finite page total from the filtered Alert rows', () => {
    const markup = renderList()
    expect(markup).toMatch(/1\s*\/\s*2/)
    expect(markup).not.toContain('/ -1')
  })

  it('disables next and last controls on the actual final page', () => {
    const markup = renderList('?aPage=2&aPerPage=20')
    expect(markup).toMatch(/aria-label="다음 페이지"[^>]*disabled/)
    expect(markup).toMatch(/aria-label="마지막 페이지"[^>]*disabled/)
  })
})
