import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import Dashboard, { Institution } from './Dashboard'
import Detail from './Detail'
import Lists from './Lists'
import Transactions from './Transactions'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v21 service-facing copy', () => {
  it('keeps implementation and review notes out of user-facing screens', () => {
    const redetected = records.find(item => item.kind === 'Alert' && item.redetection)!
    const markup = [
      html(<Dashboard records={records} user="오검토" onOpen={() => {}} />),
      html(<Institution records={records} onOpen={() => {}} />),
      html(<Transactions records={records} />),
      html(<Detail record={redetected} records={records} user={redetected.owner} onUpdate={() => {}} onOpen={() => {}} />),
      html(<NuqsTestingAdapter><Lists kind="Alert" records={records} user="오검토" onOpen={() => {}} state="stale" setState={() => {}} /></NuqsTestingAdapter>),
    ].join('\n')

    expect(markup).not.toMatch(/Prototype mock|Backend 정책|API는 미확정|예시값|고대비|모델 팀|v18 원형 구성|색상과 함께 범례 이름|막대와 값 label|IBM HI-Small|REQ-DEMO|fixture/)
  })
})
