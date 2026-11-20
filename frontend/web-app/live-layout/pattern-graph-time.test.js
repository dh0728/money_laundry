import { describe, expect, it } from 'vitest';
import { buildPatternTime, patternHomeForce, patternVelocityDecay } from './pattern-graph-time';

const row = (code, timestamp, source, target) => ({ code, timestamp, from: { code: source }, to: { code: target } });
const nodes = (...ids) => ids.map(id => ({ id }));

describe('pattern graph time', () => {
  it('uses the first actual event column and separates accounts tied at the same instant', () => {
    const plan = buildPatternTime([
      row('late', '2026-11-11 12:34', 'B', 'C'),
      row('first', '2026-11-11T01:32:00Z', 'A', 'B'),
      row('same', '2026-11-11 10:32', 'B', 'D'),
    ], nodes('A', 'B', 'C', 'D'), {});
    expect(plan.ticks).toHaveLength(2);
    expect(plan.homes.get('A').x).toBe(plan.homes.get('B').x);
    expect(plan.homes.get('D').x).toBe(plan.homes.get('A').x);
    expect(plan.homes.get('C').x).toBeGreaterThan(plan.homes.get('B').x);
    expect(new Set(['A', 'B', 'D'].map(id => plan.homes.get(id).y)).size).toBe(3);
  });

  it('puts undated evidence in a distinct column and omits the axis with no dated evidence', () => {
    const dated = row('dated', '2026-11-11 10:00', 'A', 'B');
    const undated = row('bad', 'not a date', 'C', 'D');
    const plan = buildPatternTime([dated, undated], nodes('A', 'B', 'C', 'D'), {});
    expect(plan.ticks.at(-1).label).toBe('시각 없음');
    expect(plan.homes.get('D').x).toBeGreaterThan(plan.homes.get('A').x);
    expect(buildPatternTime([undated], nodes('C', 'D'), {})).toBeUndefined();
  });

  it('overshoots after release and settles exactly on its homes without dragging fixed nodes', () => {
    const force = patternHomeForce();
    const released = { x: 160, y: 80, vx: 0, vy: 0, home: { x: 0, y: 0 } };
    const fixed = { x: 30, y: 30, vx: 0, vy: 0, fx: 30, fy: 30, home: { x: 0, y: 0 } };
    force.initialize([released, fixed]);
    let crossed = false;
    for (let step = 0; step < 96; step += 1) {
      force(1);
      released.vx *= 1 - patternVelocityDecay;
      released.vy *= 1 - patternVelocityDecay;
      released.x += released.vx;
      released.y += released.vy;
      crossed ||= released.x < 0;
    }
    expect(crossed).toBe(true);
    expect(released.x).toBeCloseTo(0, 2);
    expect(released.y).toBeCloseTo(0, 2);
    expect(fixed.vx).toBe(0);
    expect(fixed.vy).toBe(0);
  });
});
