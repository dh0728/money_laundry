import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { fetchReviewUsers } from '@/api/liveReview';
import { AdminTeamSettings } from './admin-team-settings';
import { changeLiveRole } from './live-settings.js';

vi.mock('@/api/liveReview', () => ({ fetchReviewUsers: vi.fn() }));
vi.mock('./live-settings.js', () => ({ changeLiveRole: vi.fn() }));

it('keeps team management restricted to administrators and scopes fixture edits to fixture rows', () => {
  fetchReviewUsers.mockClear();
  const staff = { id: 1, name: '실제 분석가', role: 'STAFF', source: 'api' };
  const { rerender } = render(<AdminTeamSettings sessionUser={staff} />);
  expect(screen.queryByRole('region', { name: '팀원 권한' })).not.toBeInTheDocument();
  rerender(<AdminTeamSettings sessionUser={{ id: -2, name: '프리뷰 관리자', role: 'ADMIN', source: 'fixture' }} />);
  expect(screen.getByText('현재 계정')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '프리뷰 관리자 권한' })).not.toBeInTheDocument();
  const target = screen.getByRole('combobox', { name: '김서윤 권한' });
  fireEvent.keyDown(target, { key: 'Enter' });
  expect(target).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(target, { key: 'ArrowUp' });
  fireEvent.keyDown(target, { key: 'Enter' });
  expect(target).toHaveTextContent('관리자');
  expect(screen.getByRole('status')).toHaveTextContent('김서윤의 권한을 관리자로 변경했습니다.');
  expect(fetchReviewUsers).not.toHaveBeenCalled();
});

it('reads verified administrator directory entries without exposing mutation controls', async () => {
  fetchReviewUsers.mockReset().mockResolvedValue([{ id: 2, name: '실제 관리자', role: 'ADMIN' }]);
  render(<AdminTeamSettings sessionUser={{ id: 2, name: '실제 관리자', role: 'ADMIN', source: 'api' }} />);
  expect(await screen.findByText('실제 관리자')).toBeInTheDocument();
  expect(screen.getByText('현재 계정')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(fetchReviewUsers).toHaveBeenCalledOnce();
});

it('lets a signed-in administrator change another member role through the server', async () => {
  fetchReviewUsers.mockReset().mockResolvedValue([
    { id: 2, name: '실제 관리자', role: 'ADMIN' }, { id: 3, name: '실제 분석가', role: 'STAFF' },
  ]);
  changeLiveRole.mockReset().mockResolvedValueOnce({ ok: false, error: '관리자만 설정을 바꿀 수 있습니다.' })
    .mockResolvedValueOnce({ ok: true, value: { id: 3, name: '실제 분석가', role: 'ADMIN' } });
  render(<AdminTeamSettings sessionUser={{ id: 2, name: '실제 관리자', role: 'ADMIN', source: 'api' }} />);
  const pick = async () => {
    const target = await screen.findByRole('combobox', { name: '실제 분석가 권한' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyDown(target, { key: 'ArrowUp' });
    fireEvent.keyDown(target, { key: 'Enter' });
    return target;
  };
  expect(screen.queryByRole('combobox', { name: '실제 관리자 권한' })).not.toBeInTheDocument();
  const target = await pick();
  expect(await screen.findByRole('status')).toHaveTextContent('관리자만 설정을 바꿀 수 있습니다.');
  expect(target).toHaveTextContent('분석가');
  await pick();
  expect(await screen.findByText('실제 분석가의 권한을 관리자로 변경했습니다.')).toBeInTheDocument();
  expect(changeLiveRole).toHaveBeenLastCalledWith(3, 'ADMIN');
  expect(target).toHaveTextContent('관리자');
});
