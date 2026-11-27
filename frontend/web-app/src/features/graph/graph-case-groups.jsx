// 관련 탭 합친 그래프의 Alert 구분 색. 0번 칸은 기준 Alert, 1번부터 비교에 넣은 순서대로 받는다.
export const caseGroupColors = Array.from({ length: 8 }, (_, index) => `var(--case-group-${index + 1})`);

export function caseGroupColor(slot) {
  return caseGroupColors[slot % caseGroupColors.length];
}

// 비교에서 빠진 Alert의 칸은 비워 두었다가 다음에 넣는 Alert가 가장 앞의 빈 칸을 받는다. 남은 Alert의 색은 바뀌지 않는다.
export function assignCaseColorSlots(previous, codes) {
  const slots = new Map([...previous].filter(([code]) => codes.includes(code)));
  for (const code of codes) {
    if (slots.has(code)) continue;
    const used = new Set(slots.values());
    let slot = 1;
    while (used.has(slot)) slot++;
    slots.set(code, slot);
  }
  return slots;
}

// 화면 라벨에 쓰는 짧은 이름. A-230908-000117 → 117 (사건 번호는 전체에서 겹치지 않는다).
export function caseShortLabel(code) {
  const serial = String(code).split('-').at(-1);
  return /^\d+$/.test(serial) ? String(Number(serial)) : String(code);
}

export function caseMembership(groups, transactionIds) {
  const ids = [...transactionIds];
  return groups.filter(group => ids.some(id => group.transactionIds.has(id))).map(group => group.id);
}

// 그룹 순서(기준이 먼저)대로 영역 폭을 줄여 겹쳐도 가장자리가 따로 보이게 한다.
export function caseRegionWidth(index, widest, step, narrowest) {
  return Math.max(narrowest, widest - index * step);
}

const defaultRegionOpacity = { base: .2, strong: .38, faint: .07 };

// 밝은/어두운 화면별 값은 --case-graph-region-*-opacity 토큰에서 읽어 levels로 넘긴다.
export function caseRegionOpacity(id, highlight, levels = defaultRegionOpacity) {
  if (!highlight) return levels.base;
  return highlight === id ? levels.strong : levels.faint;
}

export function readCaseRegionOpacity(read) {
  return {
    base: read('--case-graph-region-opacity', defaultRegionOpacity.base),
    strong: read('--case-graph-region-strong-opacity', defaultRegionOpacity.strong),
    faint: read('--case-graph-region-faint-opacity', defaultRegionOpacity.faint),
  };
}
