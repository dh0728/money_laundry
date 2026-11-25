import { useEffect, useRef, useState } from 'react';
import { appReducedMotion } from '@/hooks/use-reduced-motion';

const zeroOffset = { x: 0, y: 0 };
const dragThreshold = 5;

export function useSpringNodeDrag(scale = 1) {
  const [offset, setOffset] = useState(null);
  const point = useRef(null);
  const pointer = useRef(null);
  const frame = useRef(null);
  const suppressed = useRef(null);

  function place(next) {
    point.current = next;
    setOffset(next);
  }

  function stopAnimation() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  useEffect(() => stopAnimation, []);

  function returnToOrigin() {
    const from = point.current;
    if (!from) return;
    const reduced = appReducedMotion();
    if (reduced) {
      place(null);
      return;
    }
    const start = performance.now();
    function animate(now) {
      const elapsed = (now - start) / 1000;
      if (elapsed >= 0.58) {
        frame.current = null;
        place(null);
        return;
      }
      const spring = Math.exp(-9 * elapsed) *
        (Math.cos(14 * elapsed) + 9 / 14 * Math.sin(14 * elapsed));
      place({ id: from.id, x: from.x * spring, y: from.y * spring });
      frame.current = requestAnimationFrame(animate);
    }
    frame.current = requestAnimationFrame(animate);
  }

  function finish(event) {
    if (pointer.current?.pointerId !== event.pointerId) return;
    pointer.current = null;
    returnToOrigin();
  }

  function nodeHandlers(id) {
    return {
      onPointerDown(event) {
        if (event.button !== 0 || event.isPrimary === false || pointer.current) return;
        event.stopPropagation();
        stopAnimation();
        suppressed.current = null;
        if (point.current && point.current.id !== id) place(null);
        const origin = point.current ?? zeroOffset;
        pointer.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event) {
        const start = pointer.current;
        if (!start || start.id !== id || start.pointerId !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < dragThreshold) return;
        start.moved = true;
        suppressed.current = id;
        place({ id, x: start.origin.x + dx / scale, y: start.origin.y + dy / scale });
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onClickCapture(event) {
        if (event.detail === 0 || suppressed.current !== id) return;
        event.stopPropagation();
        suppressed.current = null;
      },
    };
  }

  return {
    offsetFor: id => offset?.id === id ? offset : zeroOffset,
    nodeHandlers,
    activeId: offset?.id,
  };
}
