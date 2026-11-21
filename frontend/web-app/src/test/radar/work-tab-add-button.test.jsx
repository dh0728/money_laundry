import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkTabAddButton } from '../../components/radar/primary-button.jsx';
import { setWorkTabCodes } from '../../app/radar/work-tab-state.js';

afterEach(() => act(() => setWorkTabCodes([])));

it('removes the add button for an existing tab and restores it when the tab closes', () => {
  const code = 'A-261111-001042';
  const name = '사이드바 탭으로 추가';
  render(<WorkTabAddButton code={code} />);
  expect(screen.getByRole('button', { name }).disabled).toBe(false);

  act(() => setWorkTabCodes([code]));
  expect(screen.queryByRole('button', { name })).toBeNull();

  act(() => setWorkTabCodes([]));
  expect(screen.getByRole('button', { name }).disabled).toBe(false);
});

it('still renders a disabled button when its caller disables the action', () => {
  render(<WorkTabAddButton code="A-261111-001042" disabled />);
  expect(screen.getByRole('button', { name: '사이드바 탭으로 추가' }).disabled).toBe(true);
});
