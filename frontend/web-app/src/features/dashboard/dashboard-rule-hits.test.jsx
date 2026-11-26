import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { fetchRule, fetchRules } from '@/api/rules';
import { DashboardRuleHits, rankOperatingRuleHits } from './dashboard-rule-hits';

test('ranks five valid recorded operating hit totals, including previously active rules', () => {
  const rows = [
    { code: 'RULE-020', hitCount: 4 }, { code: 'RULE-003', hitCount: 4 },
    { code: 'RULE-015', hitCount: 9, operatingStatus: 'PAUSED' },
    { code: 'RULE-009', hitCount: 5 }, { code: 'RULE-004', hitCount: 1 },
    { code: 'RULE-005', hitCount: 2 }, { code: 'RULE-007', hitCount: 0 },
    { code: 'RULE-008', hitCount: null }, { code: 'RULE-011', hitCount: '70' },
    { code: 'RULE-010', hitCount: 1.5 }, { code: 'invalid', hitCount: 100 },
  ];
  expect(rankOperatingRuleHits(rows).map(row => row.code)).toEqual(['RULE-015', 'RULE-009', 'RULE-003', 'RULE-020', 'RULE-005']);
  expect(rows[0].code).toBe('RULE-020');
});

test('ranks distinct zero-hit operating rules and excludes unoperated rules', () => {
  const rows = [
    { code: 'RULE-005', hitCount: 0, operatingVersionNo: 1 }, { code: 'RULE-004', hitCount: 0, operatingVersionNo: 2 },
    { code: 'RULE-008', hitCount: 0, status: 'DRAFT', operatingVersionNo: null },
    { code: 'RULE-007', hitCount: 0, status: 'SHADOW', operatingVersionNo: null },
    { code: 'RULE-001', hitCount: 3 }, { code: 'RULE-002', hitCount: 4 }, { code: 'RULE-002', hitCount: 4 },
    { code: 'RULE-009', hitCount: -1, operatingVersionNo: 1 },
  ];
  expect(rankOperatingRuleHits(rows).map(row => row.code)).toEqual(['RULE-002', 'RULE-001', 'RULE-004', 'RULE-005']);
});

test('renders rankings inside the shared scrollable table with the rule detail link', async () => {
  render(<DashboardRuleHits dataSource="sample" />);
  const region = await screen.findByRole('region', { name: '룰 운영 적중 상위 5 스크롤' });
  const table = within(region).getByRole('table', { name: '룰 운영 적중 상위 5' });
  expect(screen.getByRole('heading', { name: '룰 운영 적중 상위 5' })).toBeTruthy();
  for (const name of ['룰', '운영 적중', '최근 적중일']) {
    expect(within(table).getByRole('columnheader', { name }).querySelector('.table-field-label .icon')).toBeTruthy();
  }
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(6);
  const firstRow = rows[1];
  const rowHead = within(firstRow).getByRole('rowheader');
  expect(within(rowHead).getByRole('link', { name: 'RULE-002 고액 거래 감시 상세 열기' }).getAttribute('href')).toBe('/rules?rule=RULE-002');
  expect(within(firstRow).getByText('4건')).toBeTruthy();
  expect(within(rows[4]).getByRole('link', { name: /RULE-008/ })).toBeTruthy();
  expect(within(rows[5]).getByRole('link', { name: /RULE-009/ })).toBeTruthy();
  for (const row of rows.slice(4)) {
    expect(within(row).getByText('0건')).toBeTruthy();
    expect(within(row).getByText('—')).toBeTruthy();
  }
});

test('additional sample rules share the same activated versions in the list and detail', async () => {
  const { content, counts } = await fetchRules();
  expect(counts.ACTIVE).toBe(content.filter(row => row.status === 'ACTIVE').length);
  for (const ruleId of [8, 9]) {
    const row = content.find(rule => rule.ruleId === ruleId);
    const detail = await fetchRule(ruleId);
    expect(row).toMatchObject({ status: 'ACTIVE', hitCount: 0, lastHitDate: null });
    expect(detail.operating).toMatchObject({ versionId: row.versionId, versionNo: row.operatingVersionNo, status: 'ACTIVE' });
    expect(detail.events[0]).toMatchObject({ action: 'APPROVED', versionNo: row.operatingVersionNo });
    expect(detail.executions).toEqual([]);
  }
});
