import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnerGraphTimeline } from './owner-graph-timeline';

it('pans the canvas and drags a node independently without selecting it', () => {
  const clientWidth = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(300);
  const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(240);
  const controls = document.createElement('div');
  document.body.append(controls);
  const onNodeSelect = vi.fn();
  const from = { code: 'A1', owner: 'X' };
  const to = { code: 'B1', owner: 'Y' };
  const records = [1, 2, 3].map(index => ({
    code: `T-261111-0000000${index}`, timestamp: `2026-11-11 13:0${index}`,
    from, to, verdict: 'unjudged', score: 80,
  }));
  try {
    render(<OwnerGraphTimeline records={records} visible={records} groups={[]}
      onNodeSelect={onNodeSelect} onSelect={() => {}} controlsHost={controls} />);
    const plot = screen.getByRole('group', { name: '소유주별 자금 흐름 그래프' });
    const world = plot.querySelector('g[clip-path] > g');
    const initial = world.getAttribute('transform');
    const node = screen.getByRole('button', { name: 'A1 · X' });
    const pointer = (target, type, clientX, clientY, pointerType = 'touch') => fireEvent(target, Object.assign(
      new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }),
      { pointerId: 1, pointerType, isPrimary: true },
    ));
    const fit = screen.getByRole('button', { name: '그래프 화면에 맞추기' });
    const readScale = () => Number(world.getAttribute('transform').match(/scale\(([^)]+)\)/)[1]);
    const readTranslation = () => world.getAttribute('transform').match(/^translate\(([^ ]+) ([^)]+)\)/).slice(1).map(Number);
    const [fitX, fitY] = readTranslation();

    expect(plot.querySelector('svg')).toHaveAttribute('viewBox', '0 0 300 240');
    expect(screen.getByRole('group', { name: 'X' })).toContainElement(node);
    fireEvent.keyDown(plot, { key: 'ArrowDown' });
    expect(world.getAttribute('transform')).not.toBe(initial);
    fireEvent.click(fit);

    pointer(plot, 'pointerdown', 80, 80, 'mouse');
    pointer(plot, 'pointermove', 110, 100, 'mouse');
    expect(readTranslation()).toEqual([fitX + 30, fitY + 20]);
    pointer(plot, 'pointerup', 110, 100, 'mouse');
    fireEvent.click(fit);
    expect(world).toHaveAttribute('transform', initial);
    pointer(plot, 'pointerdown', 80, 80);
    pointer(plot, 'pointermove', 50, 60);
    expect(readTranslation()).toEqual([fitX - 30, fitY - 20]);
    pointer(plot, 'pointerup', 50, 60);
    fireEvent.click(fit);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(readTranslation()).toEqual([fitX + 48, fitY]);
    fireEvent.click(fit);
    const fitScale = readScale();
    fireEvent.click(screen.getByRole('button', { name: '그래프 축소' }));
    expect(readScale()).toBeLessThan(fitScale);
    fireEvent.click(fit);

    fireEvent.click(screen.getByRole('button', { name: '그래프 확대' }));
    fireEvent.click(screen.getByRole('button', { name: '그래프 확대' }));
    const zoomed = world.getAttribute('transform');
    expect(zoomed).not.toBe(initial);

    const line = plot.querySelector('.owner-edge-visible');
    const pathStart = () => line.getAttribute('d').split(' ').slice(1, 3).map(Number);
    const [initialX, initialY] = pathStart();
    pointer(node, 'pointerdown', 180, 160);
    pointer(node, 'pointermove', 115, 130);
    expect(node).toHaveAttribute('data-dragging', 'true');
    expect(plot).not.toHaveAttribute('data-panning');
    expect(world.getAttribute('transform')).toBe(zoomed);
    expect(pathStart()[0]).toBeCloseTo(initialX - 65 / readScale());
    expect(pathStart()[1]).toBeCloseTo(initialY - 30 / readScale());
    pointer(node, 'pointerup', 115, 130);
    fireEvent.click(node, { detail: 1 });
    expect(onNodeSelect).not.toHaveBeenCalled();
    expect(plot).not.toHaveAttribute('data-panning');

    pointer(node, 'pointerdown', 115, 130);
    pointer(node, 'pointerup', 115, 130);
    fireEvent.click(node, { detail: 1 });
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onNodeSelect.mock.calls).toEqual([['A1'], ['A1']]);

    const beforeWheel = world.getAttribute('transform');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40, clientX: 150, clientY: 120 });
    fireEvent(plot, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(world.getAttribute('transform')).not.toBe(beforeWheel);

    fireEvent.click(fit);
    expect(world).toHaveAttribute('transform', initial);
  } finally {
    clientWidth.mockRestore();
    clientHeight.mockRestore();
    controls.remove();
  }
});
