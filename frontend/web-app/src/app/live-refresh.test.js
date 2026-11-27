import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changedCaseCount, startLiveRefresh } from './live-refresh';

let target;
let shown;
let stop;

beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  shown = true;
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

function start(refresh, options = {}) {
  const handle = startLiveRefresh({ refresh, isActive: () => true, target, visible: () => shown, now: () => Date.now(),
    intervalMs: 60_000, idleMs: 600_000, checkMs: 5_000, ...options });
  stop = handle.stop;
  return handle;
}
const click = () => target.dispatchEvent(new Event('pointerdown'));

it('간격마다 다시 받고, 입력이 끊긴 지 오래면 멈춘다', async () => {
  const refresh = vi.fn();
  start(refresh);
  await vi.advanceTimersByTimeAsync(55_000);
  expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  // 입력 없이 10분이 지나면 더 받지 않는다
  await vi.advanceTimersByTimeAsync(600_000);
  const idle = refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(refresh).toHaveBeenCalledTimes(idle);
  click();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(refresh).toHaveBeenCalledTimes(idle + 1);
});

it('탭이 가려져 있으면 받지 않고, 돌아오면 바로 받는다', async () => {
  const refresh = vi.fn();
  start(refresh);
  shown = false;
  await vi.advanceTimersByTimeAsync(180_000);
  expect(refresh).not.toHaveBeenCalled();
  shown = true;
  target.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('받는 중에는 겹쳐 보내지 않고, 버튼은 간격과 관계없이 바로 받는다', async () => {
  let finish;
  const refresh = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const handle = start(refresh);
  const first = handle.refreshNow();
  expect(handle.refreshNow()).toBe(first);
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(handle.refreshNow()).toBeDefined();
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('받다가 실패해도 다음 간격에 다시 받는다', async () => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue();
  start(refresh);
  click();
  await vi.advanceTimersByTimeAsync(65_000);
  click();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('값이 바뀌거나 새로 생기거나 사라진 사건을 센다', () => {
  const before = new Map([['ALERT:1', 'OPEN'], ['ALERT:2', 'OPEN'], ['EPISODE:3', 'OPEN']]);
  const after = new Map([['ALERT:1', 'OPEN'], ['ALERT:2', 'CLOSED'], ['ALERT:4', 'OPEN']]);
  expect(changedCaseCount(before, after)).toBe(3);
  expect(changedCaseCount(after, after)).toBe(0);
});
