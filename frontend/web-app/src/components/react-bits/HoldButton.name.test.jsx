import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PrimaryButton } from '../primary-button';

it('강조 버튼은 보이는 글자를 aria-label 로도 가진다', () => {
  const { rerender } = render(<PrimaryButton tone="brand" onClick={() => {}}>조사 시작</PrimaryButton>);
  const button = screen.getByRole('button', { name: '조사 시작' });
  expect(button).toHaveAttribute('aria-label', '조사 시작');
  rerender(<PrimaryButton tone="brand" onClick={() => {}}>판정</PrimaryButton>);
  expect(screen.getByRole('button', { name: '판정' })).toHaveAttribute('aria-label', '판정');
});

it('호출하는 쪽이 준 aria-label 은 덮지 않는다', () => {
  render(<PrimaryButton tone="negative" onClick={() => {}} aria-label="2건 제외 적용">2건 제외</PrimaryButton>);
  expect(screen.getByRole('button', { name: '2건 제외' })).toHaveAttribute('aria-label', '2건 제외 적용');
});
