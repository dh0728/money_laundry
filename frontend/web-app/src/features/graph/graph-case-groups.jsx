// 관련 탭 합친 그래프의 Alert 구분 색과 모양. 0번 칸은 기준 Alert, 1번부터 비교에 넣은 순서대로 받는다.
export const caseGroupColors = Array.from({ length: 8 }, (_, index) => `var(--case-group-${index + 1})`);

export function caseGroupColor(slot) {
  return caseGroupColors[slot % caseGroupColors.length];
}

// 선 위를 흐르는 표식 모양. 색과 같은 칸 번호를 써서 색 구분이 어려워도 모양으로 Alert를 가린다.
export const caseGroupShapes = ['circle', 'triangle', 'square', 'diamond', 'star', 'hexagon', 'down', 'cross'];

export function caseGroupShape(slot) {
  return caseGroupShapes[slot % caseGroupShapes.length];
}

const hexagon = Array.from({ length: 6 }, (_, index) => {
  const angle = Math.PI / 6 + index * Math.PI / 3;
  return [Math.cos(angle) * 1.08, Math.sin(angle) * 1.08];
});
const star = Array.from({ length: 10 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  const reach = index % 2 ? .56 : 1.25;
  return [Math.cos(angle) * reach, Math.sin(angle) * reach + .08];
});
const shapePoints = {
  triangle: [[0, -1.15], [1.05, .8], [-1.05, .8]],
  square: [[-.86, -.86], [.86, -.86], [.86, .86], [-.86, .86]],
  diamond: [[0, -1.2], [1.05, 0], [0, 1.2], [-1.05, 0]],
  star,
  hexagon,
  down: [[-1.05, -.8], [1.05, -.8], [0, 1.15]],
  cross: [[-.38, -1.08], [.38, -1.08], [.38, -.38], [1.08, -.38], [1.08, .38], [.38, .38], [.38, 1.08],
    [-.38, 1.08], [-.38, .38], [-1.08, .38], [-1.08, -.38], [-.38, -.38]],
};

// 반지름 1 기준 꼭짓점. 원은 undefined다.
export function caseShapePoints(shape) {
  return shapePoints[shape];
}

// SVG polygon/path용 꼭짓점 문자열.
export function caseShapePath(shape, x, y, r) {
  const points = caseShapePoints(shape);
  if (!points) return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return `M ${points.map(([px, py]) => `${x + px * r} ${y + py * r}`).join(' L ')} Z`;
}

// 범례 칩의 CSS clip-path. 꼭짓점 범위 -1.25~1.25를 칩 상자 0~100%에 맞춘다.
export function caseShapeClip(shape) {
  const points = caseShapePoints(shape);
  if (!points) return 'circle(42%)';
  const percent = value => `${Math.round((value + 1.25) / 2.5 * 1000) / 10}%`;
  return `polygon(${points.map(([x, y]) => `${percent(x)} ${percent(y)}`).join(', ')})`;
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

// 선 하나 위에 송금 방향으로 흐르는 표식 위치(0 = 송금 계좌 쪽, 1 = 받는 계좌 쪽).
// Alert 하나마다 spacing 간격으로 놓고, 여러 Alert가 공유한 거래는 그 수만큼 모양이 번갈아 촘촘해진다.
// shift는 지금까지 흐른 칸 수다. 표식은 자기 Alert를 지닌 채 앞으로 움직인다. 멈춘 화면은 shift .5를 쓴다.
export function flowMarkers(caseIds, length, spacing, shift = .5) {
  const kinds = caseIds.length ? caseIds : [undefined];
  const count = Math.max(1, Math.round(length / spacing)) * kinds.length;
  const passed = Math.floor(shift);
  const fraction = shift - passed;
  return Array.from({ length: count }, (_, index) => ({
    t: (index + fraction) / count,
    caseId: kinds[((index - passed) % kinds.length + kinds.length) % kinds.length],
  }));
}
