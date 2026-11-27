// 서비스 모드 화면 데이터(board)를 일정 간격으로 뒤에서 다시 받아, 다른 사람이 처리한 결과와 새 Alert를 보이게 한다.
// 탭이 화면에 보이고 최근에 클릭·키 입력이 있었을 때만 받는다. 자리를 비운 탭은 받지 않는다.
// 받은 데이터는 지금 화면을 바로 다시 그리지 않는다(보던 순서·스크롤이 바뀌지 않게). 바뀐 건수를 알려 주고,
// 사용자가 [반영]을 누르거나 다른 화면으로 이동할 때 새 데이터로 그린다.
export const liveRefreshIntervalMs = 60_000;
// 마지막 입력 뒤 이 시간이 지나면 자리를 비운 것으로 보고 받지 않는다.
export const liveRefreshIdleMs = 10 * 60_000;
const checkEveryMs = 5_000;
const activityEvents = ['pointerdown', 'keydown', 'wheel'];

export function startLiveRefresh({ refresh, isActive, target = document, visible = () => document.visibilityState === 'visible',
  now = () => Date.now(), intervalMs = liveRefreshIntervalMs, idleMs = liveRefreshIdleMs, checkMs = checkEveryMs }) {
  let lastActivity = now();
  let lastRefresh = now();
  const mark = () => { lastActivity = now(); };
  for (const type of activityEvents) target.addEventListener(type, mark, { capture: true, passive: true });
  // 다른 탭에 있다가 돌아오면 입력으로 본다. 오래 묵었으면 다음 확인 때 바로 받는다.
  const returned = () => { if (visible()) mark(); };
  target.addEventListener('visibilitychange', returned);

  let running;
  function run(force = false) {
    const time = now();
    if (running || !isActive()) return running;
    if (!force && (!visible() || time - lastRefresh < intervalMs || time - lastActivity >= idleMs)) return undefined;
    lastRefresh = time;
    running = Promise.resolve().then(refresh).catch(() => undefined).finally(() => { running = undefined; });
    return running;
  }

  const timer = setInterval(() => run(), checkMs);
  return {
    /** 지금 바로 받는다(새로고침 버튼). 받는 중이면 그 요청을 기다린다. 끝나면 풀리는 약속을 돌려준다. */
    refreshNow: () => run(true),
    /** 다른 경로(로그인·저장)로 board 를 새로 받았으면 그때부터 간격을 다시 센다. */
    markFresh: () => { lastRefresh = now(); },
    stop: () => {
      clearInterval(timer);
      for (const type of activityEvents) target.removeEventListener(type, mark, { capture: true });
      target.removeEventListener('visibilitychange', returned);
    },
  };
}

// 화면에 보이는 값이 바뀐 사건 수. 새로 생기거나 사라진 사건도 센다.
export function changedCaseCount(before, after) {
  let changed = 0;
  for (const [key, value] of after) if (before.get(key) !== value) changed++;
  for (const key of before.keys()) if (!after.has(key)) changed++;
  return changed;
}
