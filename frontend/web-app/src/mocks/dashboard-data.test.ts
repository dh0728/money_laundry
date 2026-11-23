import { describe, expect, it } from 'vitest'
import { cases, transactions, selectDashboard, riskBand, riskSettings, patternName, snapshot } from './dashboard-data'

describe('first bundle data contract', () => {
  it('scopes rows, KPIs and daily counts to current assignee and inclusive date range', () => {
    const data = selectDashboard('mine', '2026-11-09', '2026-11-15', '')
    expect(data.cases.length).toBeGreaterThan(0)
    expect(data.cases.every(c => c.assigneeId === 7)).toBe(true)
    expect(data.daily.reduce((n, day) => n + day.alerts, 0)).toBe(data.cases.filter(c => c.kind === 'ALERT').length)
    expect(data.pendingAlerts).toBe(data.cases.filter(c => c.kind === 'ALERT' && c.status !== 'CLOSED').length)
    const day = selectDashboard('all', '2026-11-15', '2026-11-15', '')
    expect(day.cases.every(c => c.createdDate === '2026-11-15')).toBe(true)
    expect(day.transactions.every(t => t.date === '2026-11-15')).toBe(true)
    expect(selectDashboard('mine', '2026-11-09', '2026-11-15', 'missing').cases).toEqual([])
    expect(selectDashboard('all', '2026-11-09', '2026-11-15', 'missing').transactions).toEqual([])
  })
  it('preserves all codes and excludes only NON_PATTERN from dashboard pattern counts', () => {
    expect(new Set(transactions.map(t => t.typeCode)).size).toBe(9)
    expect(transactions.some(t => t.suspicious && t.typeCode === 0)).toBe(true)
    expect(transactions.some(t => !t.suspicious && t.typeCode !== 0)).toBe(true)
    const data = selectDashboard('all', '2026-11-09', '2026-11-15', '')
    expect(data.patterns.map(p => p.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(data.patterns.reduce((n, p) => n + p.count, 0)).toBe(data.transactions.filter(t => t.suspicious && t.typeCode !== 0).length)
    expect(patternName(3)).toBe('Gather-scatter')
    expect(patternName(4)).toBe('Scatter-gather')
    expect(patternName(0)).toBe('NON_PATTERN')
  })
  it('keeps independent IDs, snapshot age and configurable risk thresholds', () => {
    expect(cases.every(c => /^[AE]-\d{6}-\d{6}$/.test(c.displayId))).toBe(true)
    expect(new Set(cases.map(c => c.displayId)).size).toBe(cases.length)
    expect(cases.every(c => c.caseId !== Number(c.displayId.slice(-6)))).toBe(true)
    expect(snapshot.date).toBe('2026-11-15')
    expect(riskBand(riskSettings.high, riskSettings)).toBe('high')
    expect(riskBand(0.8, { medium: 0.4, high: 0.6 })).toBe('high')
  })
})
