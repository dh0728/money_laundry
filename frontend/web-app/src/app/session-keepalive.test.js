import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepaliveIntervalMs, startSessionKeepalive } from './session-keepalive';

const minute = 60_000;

describe('session keepalive', () => {
  let target;
  let ping;
  let stop;
  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    ping = vi.fn(() => Promise.resolve());
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });
  const start = (isActive = () => true) => {
    stop = startSessionKeepalive({ ping, isActive, target });
  };
  const click = () => target.dispatchEvent(new Event('pointerdown'));

  it('extends the session every ten minutes while the user keeps clicking', async () => {
    start();
    for (let elapsed = 0; elapsed < 30; elapsed++) {
      click();
      await vi.advanceTimersByTimeAsync(minute);
    }
    expect(keepaliveIntervalMs).toBe(10 * minute);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it('stops extending once the user has been idle for ten minutes', async () => {
    start();
    click();
    await vi.advanceTimersByTimeAsync(40 * minute);
    expect(ping).not.toHaveBeenCalled();
  });

  it('does nothing while signed out and after it is stopped', async () => {
    let signedIn = false;
    start(() => signedIn);
    for (let elapsed = 0; elapsed < 12; elapsed++) {
      click();
      await vi.advanceTimersByTimeAsync(minute);
    }
    expect(ping).not.toHaveBeenCalled();
    signedIn = true;
    stop();
    for (let elapsed = 0; elapsed < 12; elapsed++) {
      click();
      await vi.advanceTimersByTimeAsync(minute);
    }
    expect(ping).not.toHaveBeenCalled();
  });

  it('keeps running after a failed request', async () => {
    ping.mockRejectedValueOnce(new Error('offline'));
    start();
    for (let elapsed = 0; elapsed < 21; elapsed++) {
      click();
      await vi.advanceTimersByTimeAsync(minute);
    }
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
