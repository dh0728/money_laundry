import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Detail from './Detail'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v21 provisional re-detection', () => {
  it('preserves the closed record and renders a concise current Alert history', () => {
    const current = records.find(record => record.kind === 'Alert' && record.redetection)
    expect(current).toBeTruthy()
    const prior = records.find(record => record.id === current?.redetection?.priorAlertId)
    expect(prior?.status).toBe('종결')
    const markup = html(<Detail record={current!} records={records} user={current!.owner} onUpdate={() => {}} onOpen={() => {}} />)
    expect(markup).toContain('data-testid="redetection-banner"')
    expect(markup).toContain('재탐지')
    expect(markup).not.toContain('고대비')
    const closed = markup.indexOf('과거 Alert 종결')
    const transaction = markup.indexOf('새 이상거래 발견')
    const detected = markup.indexOf('현재 Alert 재탐지')
    expect(closed).toBeGreaterThan(-1)
    expect(closed).toBeLessThan(transaction)
    expect(transaction).toBeLessThan(detected)
    expect(markup).not.toContain('Backend 정책·API는 미확정')
    expect(markup).toContain(prior!.id)
  })
})
