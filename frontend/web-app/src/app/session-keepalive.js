// 서버 세션은 마지막 요청 뒤 30분이 지나면 만료된다(dev). 화면 안 이동은 서버 요청이 없을 때가 많아서,
// 사용자가 클릭·키 입력을 하는 동안에는 일정 간격으로 가벼운 요청을 보내 세션을 이어 준다.
// 입력이 없으면 보내지 않으므로 자리를 비우면 원래대로 만료된다.
export const keepaliveIntervalMs = 10 * 60_000;
const checkEveryMs = 60_000;
const activityEvents = ['pointerdown', 'keydown', 'wheel'];

export function startSessionKeepalive({ ping, isActive, target = document, now = () => Date.now(),
  intervalMs = keepaliveIntervalMs, checkMs = checkEveryMs }) {
  let lastActivity = now();
  let lastPing = now();
  let pending = false;
  const mark = () => { lastActivity = now(); };
  for (const type of activityEvents) target.addEventListener(type, mark, { capture: true, passive: true });

  const timer = setInterval(() => {
    const time = now();
    if (pending || !isActive() || time - lastPing < intervalMs || time - lastActivity >= intervalMs) return;
    pending = true;
    lastPing = time;
    Promise.resolve().then(ping).catch(() => undefined).finally(() => { pending = false; });
  }, checkMs);

  return () => {
    clearInterval(timer);
    for (const type of activityEvents) target.removeEventListener(type, mark, { capture: true });
  };
}
