import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Dashboard, { sortPersonalQueue } from './Dashboard'
import { records } from './domain'

const user = '오검토'
const mine = records.filter(r => r.owner === user && r.status !== '종결')

describe('v24 내 담당 대시보드', () => {
  it('정렬 기준마다 해당 값 순서로 업무를 나열한다', () => {
    const byRisk = sortPersonalQueue(mine, 'risk').map(r => r.score)
    const byAge = sortPersonalQueue(mine, 'age').map(r => r.age)
    const byRecent = sortPersonalQueue(mine, 'recent').map(r => r.date)
    const byProbability = sortPersonalQueue(mine, 'probability').map(r => r.probability)
    expect(byRisk).toEqual([...byRisk].sort((a, b) => b - a))
    expect(byAge).toEqual([...byAge].sort((a, b) => b - a))
    expect(byRecent).toEqual([...byRecent].sort().reverse())
    expect(byProbability).toEqual([...byProbability].sort((a, b) => b - a))
    expect(sortPersonalQueue(mine, 'risk')).toHaveLength(mine.length)
  })

  it('업무를 검토 전·검토 중·종결 세 열로 나누고 각 열에 정렬을 적용한다', () => {
    const markup = renderToStaticMarkup(<Dashboard records={records} user={user} onOpen={() => {}} />)
    expect(markup).toContain('data-testid="personal-ai-summary"')
    expect(markup).toContain('aria-label="업무 정렬 기준"')
    expect(markup).not.toContain('최근 종결한 업무')
    const queue = markup.match(/<div[^>]*data-testid="work-queue"[^>]*>/)?.[0] ?? ''
    expect(queue).toContain('@3xl:grid-cols-3')
    const columns = markup.split('data-testid="work-status-column"').slice(1)
    expect(columns).toHaveLength(3)
    const owned = records.filter(r => r.owner === user)
    expect(columns.map(column => column.match(/>(검토 전|검토 중|종결)</)?.[1])).toEqual(['검토 전', '검토 중', '종결'])
    expect(columns.map(column => (column.match(/work-card/g) ?? []).length)).toEqual([
      owned.filter(r => r.status === '검토 전' || r.status === '조사 전').length,
      owned.filter(r => r.status === '검토 중' || r.status === '조사 중').length,
      owned.filter(r => r.status === '종결').length,
    ])
    expect(markup).not.toContain('>신규<')
  })
})
