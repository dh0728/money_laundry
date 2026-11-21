import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PreviewCaseTable } from '../../features/investigation/preview-case-list-table';
import { mountWorkflows } from '../../pages/radar/workflow-components';

function getSelectableTable(scope, label, columns) {
  const table = scope.getByRole('table', { name: label });
  const controls = within(table);
  expect(controls.getAllByRole('columnheader')).toHaveLength(columns + 1);
  expect(controls.getByRole('checkbox', { name: '표시된 행 전체 선택' }).closest('th')).toBe(table.tHead.rows[0].cells[0]);
  expect(table.closest('.data-table-frame').querySelector('.table-selection-gutter')).toBeNull();
  return { table, controls };
}

function rowFor(table, code) {
  return within(table).getByRole('rowheader', { name: new RegExp(code) }).closest('tr');
}

const normalCode = 'A-261111-000008';
const abnormalCode = 'A-261111-000009';
const reportCases = [
  { code: normalCode, kind: 'Alert', verdict: 'normal', status: '처리 완료', pattern: 'FAN-OUT' },
  { code: abnormalCode, kind: 'Alert', verdict: 'abnormal', status: '처리 완료', pattern: 'CYCLE' },
];

it('selects the matching report row inside the table after sorting and filtering', async () => {
  const host = document.createElement('main');
  host.innerHTML = '<div data-workflow="report" data-report-view="table"></div>';
  document.body.append(host);
  let workflows;
  let reportActions;
  try {
    await act(async () => {
      workflows = mountWorkflows(host, undefined, {
        reportData: { cases: reportCases },
        registerTableTools: actions => { reportActions = actions; },
      });
    });
    const report = within(host);
    const { table, controls } = getSelectableTable(report, '판정 로그', 6);
    fireEvent.click(within(table).getByRole('button', { name: '판정 ID · 오름차순 정렬' }));
    fireEvent.click(within(table).getByRole('button', { name: '판정 ID · 내림차순 정렬' }));

    const second = 'J-261111-000002';
    const first = 'J-261111-000001';
    const secondControl = controls.getByRole('checkbox', { name: `${second} 선택` });
    expect(controls.getAllByRole('checkbox').at(1)).toBe(secondControl);
    expect(table.tBodies[0].rows[0]).toBe(rowFor(table, second));
    expect(secondControl.closest('td')).toBe(table.tBodies[0].rows[0].cells[0]);
    fireEvent.click(secondControl);
    expect(rowFor(table, second)).toHaveAttribute('data-selected', 'true');
    expect(rowFor(table, first)).not.toHaveAttribute('data-selected');
    expect(controls.getByRole('checkbox', { name: '표시된 행 전체 선택' })).toHaveAttribute('aria-checked', 'mixed');

    await act(async () => { reportActions.filter.onChange('abnormal'); });
    expect(controls.queryByRole('checkbox', { name: `${first} 선택` })).toBeNull();
    expect(table.tBodies[0].rows).toHaveLength(1);
    expect(rowFor(table, second)).toHaveAttribute('data-selected', 'true');
    fireEvent.click(controls.getByRole('checkbox', { name: '표시된 행 전체 선택' }));
    expect(rowFor(table, second)).not.toHaveAttribute('data-selected');
  } finally {
    await act(async () => { workflows?.unmount(); });
    host.remove();
  }
});

it('keeps investigation row selection keyed by ID when the result order and visible rows change', () => {
  const rows = reportCases.map((row, index) => ({
    ...row, score: index ? 92 : 60, assigned: false, elapsed: 0, open: false, related: [], amountByCurrency: {},
  }));
  const { rerender } = render(<PreviewCaseTable title="조사 Alert" rows={rows} />);
  const { table, controls } = getSelectableTable(screen, '조사 Alert', 10);
  fireEvent.click(within(table).getByRole('button', { name: 'ID · 오름차순 정렬' }));
  fireEvent.click(within(table).getByRole('button', { name: 'ID · 내림차순 정렬' }));

  const abnormalControl = controls.getByRole('checkbox', { name: `${abnormalCode} 선택` });
  expect(controls.getAllByRole('checkbox').at(1)).toBe(abnormalControl);
  expect(table.tBodies[0].rows[0]).toBe(rowFor(table, abnormalCode));
  fireEvent.click(abnormalControl);
  expect(rowFor(table, abnormalCode)).toHaveAttribute('data-selected', 'true');
  expect(rowFor(table, normalCode)).not.toHaveAttribute('data-selected');

  rerender(<PreviewCaseTable title="조사 Alert" rows={[rows[0]]} totalCount={rows.length} />);
  expect(controls.queryByRole('checkbox', { name: `${abnormalCode} 선택` })).toBeNull();
  fireEvent.click(controls.getByRole('checkbox', { name: '표시된 행 전체 선택' }));
  expect(rowFor(table, normalCode)).toHaveAttribute('data-selected', 'true');

  rerender(<PreviewCaseTable title="조사 Alert" rows={rows} />);
  expect(rowFor(table, abnormalCode)).toHaveAttribute('data-selected', 'true');
  expect(rowFor(table, normalCode)).toHaveAttribute('data-selected', 'true');
});
