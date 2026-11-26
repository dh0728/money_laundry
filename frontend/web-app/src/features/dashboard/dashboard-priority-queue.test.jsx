import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DashboardPriorityQueue, rankPriorityCases } from './dashboard-priority-queue';

describe('priority case ranking', () => {
  it('uses risk multiplied by age, breaks ties, and keeps at most eight records', () => {
    const first = { code: 'A-1', score: 90, elapsed: 4 };
    const samePriority = { code: 'A-2', score: 60, elapsed: 6 };
    const sameScore = { code: 'A-3', score: 90, elapsed: 4 };
    const older = { code: 'E-4', score: 70, elapsed: 7 };
    const sameDay = { code: 'E-5', score: 99, elapsed: 0 };
    const remaining = Array.from({ length: 8 }, (_, index) => ({ code: `A-low-${index}`, score: 10, elapsed: 1 }));
    const ranked = rankPriorityCases([samePriority, sameScore, sameDay, ...remaining, first, older]);

    expect(ranked.slice(0, 4)).toEqual([older, first, sameScore, samePriority]);
    expect(ranked).toHaveLength(8);
  });

  it('excludes missing or invalid inputs but retains same-day work with a known score', () => {
    const sameDay = { code: 'A-today', score: 90, elapsed: 0 };
    expect(rankPriorityCases([
      { code: 'A-missing', score: 0, elapsed: 3 },
      { code: 'A-invalid', score: 120, elapsed: 3 },
      { code: 'E-no-age', score: 80 },
      { code: 'E-negative-age', score: 89, elapsed: -1 },
      sameDay,
    ])).toEqual([sameDay]);
  });
});

it('uses the shared workflow table without a duplicate title and preserves direct case actions', () => {
  render(<DashboardPriorityQueue rows={[{ code: 'A-1', score: 80, elapsed: 4 }]} />);

  expect(screen.getAllByRole('heading', { name: '우선 처리 큐' })).toHaveLength(1);
  const region = screen.getByRole('region', { name: '우선 처리 큐 상위 1건 스크롤' });
  const table = within(region).getByRole('table', { name: '우선 처리 큐 상위 1건' });
  expect(table.closest('.data-table-frame')).toBeTruthy();
  expect(within(table).getByRole('columnheader', { name: '위험 점수' }).querySelector('.table-field-label')).toBeTruthy();
  expect(within(table).getByRole('button', { name: 'A-1 상세 열기' }).dataset.workCode).toBe('A-1');
});

it('uses shared elapsed tags for all days and shared actor tags for all assignees', () => {
  render(<DashboardPriorityQueue rows={[
    { code: 'A-1', score: 80, elapsed: 4, assigneeName: '분석가 A' },
    { code: 'A-2', score: 80, elapsed: 3, assignee: 'demo-staff-2' },
    { code: 'A-3', score: 80, elapsed: 0 },
  ]} />);

  expect(screen.getByText('4일 경과').dataset.preset).toBe('elapsedOverdue');
  expect(screen.getByText('3일 경과').dataset.preset).toBe('elapsed');
  expect(screen.getByText('0일 경과').dataset.preset).toBe('elapsed');
  for (const name of ['분석가 A', '분석가 01', '미배정']) {
    expect(screen.getByText(name).dataset.tag).toBe('case-actor');
  }
});
