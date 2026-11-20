import React, { useEffect, useLayoutEffect, useRef } from 'react';

const count = 100;
const angle = Math.PI * (3 - Math.sqrt(5));
const nodes = Array.from({ length: count }, (_, index) => {
  const y = 1 - (2 * index + 1) / count;
  const radius = Math.sqrt(1 - y * y);
  const score = index * 37 % count;
  return { x: radius * Math.cos(index * angle), y, z: radius * Math.sin(index * angle), score };
});
const nearbyEdges = nodes.flatMap(({ x, y, z, score }, first) => nodes.flatMap((node, second) =>
  second > first && Math.hypot(x - node.x, y - node.y, z - node.z) < 0.42
    ? [{ first, second, endpointScore: Math.max(score, node.score) }] : []));
// Spread illustrative scores uniformly so both marks track the slider proportions.
const edges = nearbyEdges.sort((a, b) => a.endpointScore - b.endpointScore)
  .map(({ first, second }, index) => ({ first, second, score: (index + 0.5) * 100 / nearbyEdges.length }));

const riskBands = ['low', 'medium', 'high'];

function resolveRiskColors(element) {
  const probe = element.ownerDocument.createElement('span');
  probe.hidden = true;
  element.append(probe);
  const colors = riskBands.map(band => {
    probe.style.color = `var(--risk-${band})`;
    return getComputedStyle(probe).color;
  });
  probe.remove();
  return colors;
}

export function ModelGraph({ values: [medium, high] }) {
  const canvas = useRef(null);
  const thresholds = useRef([medium, high]);
  const repaint = useRef(null);
  useLayoutEffect(() => {
    thresholds.current = [medium, high];
    repaint.current?.();
  }, [medium, high]);
  useEffect(() => {
    const element = canvas.current;
    const context = element.getContext('2d');
    if (!context) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let visible = false;
    let last = 0;
    let rotation = 0.4;
    let colors = resolveRiskColors(element);
    const paint = () => {
      const [medium, high] = thresholds.current;
      const color = score => colors[score >= high ? 2 : score >= medium ? 1 : 0];
      const midpoint = element.width / 2;
      const scale = midpoint * 0.83;
      const s = Math.sin(rotation);
      const c = Math.cos(rotation);
      const dots = nodes.map(({ x, y, z, score }) => {
        const depth = z * c - x * s;
        const tilt = y * Math.cos(0.23) + depth * Math.sin(0.23);
        return { x: midpoint + (x * c + z * s) * scale, y: midpoint + tilt * scale, depth, score };
      });
      context.clearRect(0, 0, element.width, element.height);
      context.lineWidth = 1.3;
      for (const { first, second, score } of edges) {
        const a = dots[first], b = dots[second];
        context.strokeStyle = color(score);
        context.globalAlpha = 0.2 + (a.depth + b.depth + 2) * 0.12;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      for (const { x, y, depth, score } of dots) {
        context.fillStyle = color(score);
        context.globalAlpha = 0.46 + (depth + 1) * 0.27;
        context.beginPath();
        context.arc(x, y, 2 + depth, 0, 2 * Math.PI);
        context.fill();
      }
      context.globalAlpha = 1;
    };
    repaint.current = paint;
    const step = time => {
      if (last) rotation += (time - last) * 0.00024;
      last = time;
      paint();
      frame = requestAnimationFrame(step);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && !document.hidden && !media.matches && document.documentElement.dataset.reducedMotion !== 'true') {
        frame = requestAnimationFrame(step);
      } else {
        paint();
      }
    };
    const syncAppearance = () => {
      colors = resolveRiskColors(element);
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    media.addEventListener('change', sync);
    document.addEventListener('aml:appearance', syncAppearance);
    document.addEventListener('visibilitychange', sync);
    paint();
    return () => {
      repaint.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', sync);
      document.removeEventListener('aml:appearance', syncAppearance);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <canvas className="model-graph-sphere" ref={canvas} width={256} height={256}
    role="img" aria-label="연결된 노드로 표현한 그래프 모델 개념도와 예시 위험 구간" />;
}
