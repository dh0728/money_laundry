import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HoldButton from './react-bits/HoldButton';
import { PrimaryButton } from './primary-button';

afterEach(() => vi.useRealTimers());

it('commits once after a full keyboard hold and cancels early release or blur', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const onHold = vi.fn();
  render(<HoldButton holdTime={2000} resetAfter={0} onHold={onHold}>판정 저장</HoldButton>);
  const button = screen.getByRole('button', { name: '판정 저장' });
  const elapse = ms => act(() => vi.advanceTimersByTime(ms));

  fireEvent.click(button);
  fireEvent.keyDown(button, { key: ' ' });
  elapse(850);
  fireEvent.keyUp(button, { key: ' ' });
  elapse(2200);
  expect(onHold).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: 'Enter' });
  elapse(750);
  fireEvent.blur(button);
  elapse(2200);
  expect(onHold).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: ' ' });
  elapse(1900);
  expect(onHold).not.toHaveBeenCalled();
  elapse(180);
  fireEvent.keyUp(button, { key: ' ' });
  elapse(2500);
  expect(onHold).toHaveBeenCalledTimes(1);
});


it('requires the full hold on the blue primary variant', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const execute = vi.fn();
  render(<PrimaryButton tone="brand" onHold={execute}>AI 보고서 다운로드</PrimaryButton>);
  const button = screen.getByRole('button', { name: 'AI 보고서 다운로드' });
  expect(button.closest('.star-border').querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(button);
  expect(execute).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: 'Enter' });
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.keyUp(button, { key: 'Enter' });
  expect(execute).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: ' ' });
  act(() => vi.advanceTimersByTime(2100));
  fireEvent.keyUp(button, { key: ' ' });
  expect(execute).toHaveBeenCalledOnce();
});

it('uses the same accent in a form without delaying native submit', () => {
  const submit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={submit}>
    <PrimaryButton type="submit" tone="brand">로그인</PrimaryButton>
  </form>);
  const button = screen.getByRole('button', { name: '로그인' });
  expect(button).toHaveAttribute('data-activation', 'press');
  expect(button.closest('.star-border').querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  expect(button).not.toHaveAttribute('aria-describedby');
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledOnce();
});
