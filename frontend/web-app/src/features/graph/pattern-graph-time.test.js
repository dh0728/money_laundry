import { describe, expect, it } from 'vitest';
import { accountHops, buildHopTimePlan, patternHomeForce, patternVelocityDecay } from './pattern-graph-time';

const row = (code, timestamp, source, target) => ({ code, timestamp, from: { code: source }, to: { code: target } });
const nodes = (...ids) => ids.map(id => ({ id }));
const hopsOf = (rows, ...ids) => Object.fromEntries(accountHops(rows, ids));
const column = (plan, ...ids) => ids.map(id => plan.homes.get(id).x);

describe('hop-time graph', () => {
  it('puts every money-origin account in hop 0 and the gathering account in hop 1 for a fan-in', () => {
    const rows = [
      row('T3', '2026-11-11 12:00', 'C', 'H'),
      row('T1', '2026-11-11 10:00', 'A', 'H'),
      row('T2', '2026-11-11 11:00', 'B', 'H'),
    ];
    expect(hopsOf(rows, 'A', 'B', 'C', 'H')).toEqual({ A: 0, B: 0, C: 0, H: 1 });
    const plan = buildHopTimePlan(rows, nodes('A', 'B', 'C', 'H'));
    expect(plan.ticks.map(tick => tick.label)).toEqual(['홉 0', '홉 1']);
    expect(new Set(column(plan, 'A', 'B', 'C')).size).toBe(1);
    expect(plan.homes.get('H').x).toBeGreaterThan(plan.homes.get('A').x);
    // 같은 홉 안에서는 위(작은 y)가 이른 시각
    expect(['A', 'B', 'C'].map(id => plan.homes.get(id).y)).toEqual(
      ['A', 'B', 'C'].map(id => plan.homes.get(id).y).toSorted((a, b) => a - b));
    expect(plan.homes.get('A').y).toBeLessThan(plan.homes.get('C').y);
  });

  it('lays out gather-scatter as origins, hub, then receivers in order of arrival', () => {
    const rows = [
      row('T1', '2026-11-11 09:00', 'A', 'H'), row('T2', '2026-11-11 09:10', 'B', 'H'),
      row('T4', '2026-11-11 10:30', 'H', 'Y'), row('T3', '2026-11-11 10:00', 'H', 'X'),
    ];
    const plan = buildHopTimePlan(rows, nodes('A', 'B', 'H', 'X', 'Y'));
    expect(Object.fromEntries(plan.hops)).toEqual({ A: 0, B: 0, H: 1, X: 2, Y: 2 });
    expect(plan.homes.get('X').y).toBeLessThan(plan.homes.get('Y').y);
  });

  it('uses the shortest hop when an account is reached by several paths', () => {
    const rows = [row('T1', '2026-11-11 09:00', 'A', 'B'), row('T2', '2026-11-11 09:10', 'B', 'C'),
      row('T3', '2026-11-11 09:20', 'A', 'C')];
    expect(hopsOf(rows, 'A', 'B', 'C')).toEqual({ A: 0, B: 1, C: 1 });
  });

  it('starts a cycle without any origin from the sender of its earliest transaction', () => {
    const rows = [row('T2', '2026-11-11 10:00', 'B', 'C'), row('T3', '2026-11-11 11:00', 'C', 'A'),
      row('T1', '2026-11-11 09:00', 'A', 'B')];
    expect(hopsOf(rows, 'A', 'B', 'C')).toEqual({ A: 0, B: 1, C: 2 });
  });

  it('keeps separate groups and self transfers from breaking the hop count', () => {
    const rows = [row('T1', '2026-11-11 09:00', 'A', 'B'), row('T2', '2026-11-11 09:30', 'D', 'E'),
      row('T3', '2026-11-11 10:00', 'E', 'D'), row('T4', '2026-11-11 10:10', 'B', 'B')];
    expect(hopsOf(rows, 'A', 'B', 'D', 'E')).toEqual({ A: 0, B: 1, D: 0, E: 1 });
  });

  it('places accounts without dated evidence at the bottom of their hop and handles empty input', () => {
    const rows = [row('T1', '2026-11-11 10:00', 'A', 'B'), row('bad', 'not a date', 'C', 'B')];
    const plan = buildHopTimePlan(rows, nodes('A', 'B', 'C'));
    expect(plan.hops.get('C')).toBe(0);
    expect(plan.homes.get('C').y).toBeGreaterThan(plan.homes.get('A').y);
    expect(buildHopTimePlan([], [])).toBeUndefined();
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
