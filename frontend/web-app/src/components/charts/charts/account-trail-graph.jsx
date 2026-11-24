import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { curveBasisClosed, line } from 'd3-shape';
import './account-trail-graph.css';

const diagramWidth = 384;
const lineAdvance = 16;
const contourSamples = 128;
const contourSoftness = 12;
const maxMembers = 3;
const closedSpline = line().curve(curveBasisClosed);

function wrapCode(code, lineLength = 18) {
  const characters = Array.from(code);
  return Array.from({ length: Math.ceil(characters.length / lineLength) }, (_, index) =>
    characters.slice(index * lineLength, (index + 1) * lineLength).join(''));
}

function labelBubble({ x, y, width, height }, padding) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radiusY = halfHeight + padding;
  const radiusX = Math.max(halfWidth + padding, halfWidth / Math.sqrt(1 - (halfHeight / radiusY) ** 2) + padding / 2);
  return { x: x + halfWidth, y: y + halfHeight, radiusX, radiusY };
}

function bubbleOutline(bubbles) {
  // Smooth the maximum of the ellipse support functions to round the enclosing hull.
  const points = Array.from({ length: contourSamples }, (_, index) => {
    const angle = 2 * Math.PI * index / contourSamples;
    const normalX = Math.cos(angle);
    const normalY = Math.sin(angle);
    const supports = bubbles.map(({ x, y, radiusX, radiusY }) => {
      const radius = Math.hypot(radiusX * normalX, radiusY * normalY);
      return {
        distance: x * normalX + y * normalY + radius,
        slope: -x * normalY + y * normalX + (radiusY ** 2 - radiusX ** 2) * normalX * normalY / radius,
      };
    });
    const outermost = Math.max(...supports.map(({ distance }) => distance));
    let totalWeight = 0;
    let weightedSlope = 0;
    for (const { distance, slope } of supports) {
      const weight = Math.exp((distance - outermost) / contourSoftness);
      totalWeight += weight;
      weightedSlope += weight * slope;
    }
    const distance = outermost + contourSoftness * Math.log(totalWeight);
    const slope = weightedSlope / totalWeight;
    return [distance * normalX - slope * normalY, distance * normalY + slope * normalX];
  });
  return { path: closedSpline(points), points };
}

function estimatedBounds({ lines, x, y }) {
  const width = Math.max(...lines.map(line => Array.from(line).length)) * lineAdvance / 2;
  const height = lines.length * lineAdvance;
  return { x: x - width / 2, y: y - height / 2, width, height };
}

export function AccountTrailGraph({ comparison, focus }) {
  const title = useId();
  const intersection = useId();
  const labelLayer = useRef(null);
  const [measurement, setMeasurement] = useState(null);
  const { alert, episode, shared, members, membersComplete, unknownMembers } = comparison;
  const visible = members.toSorted((first, second) =>
    Number(second.shared.includes(focus)) - Number(first.shared.includes(focus)) || second.shared.length - first.shared.length)
    .slice(0, maxMembers);
  const hidden = members.length - visible.length + unknownMembers;
  const alertLines = ['비교 Alert', ...wrapCode(alert)];
  const episodeLines = ['Episode', membersComplete ? `Alert ${members.length + unknownMembers}개 편입` : '편입 정보 일부 확인'];
  const focusLines = ['공유 계좌', ...wrapCode(focus, 12), `총 ${shared.length}개`];
  const titleY = 40;
  const firstMemberY = titleY + lineAdvance * 4;
  const memberSpacing = lineAdvance * 4;
  const focusY = firstMemberY + (Math.max(1, visible.length) - 1) * memberSpacing / 2;
  const memberLabels = visible.map((member, index) => ({
    id: member.code, x: 304, y: firstMemberY + index * memberSpacing,
    lines: [`Alert ${member.code.split('-').at(-1)}`, member.evidenceAvailable ? `공유 ${member.shared.length}개` : '근거 미확인'],
    member,
  }));
  const labels = [
    { id: 'alert', x: 70, y: focusY, lines: alertLines },
    { id: 'episode', x: 302, y: titleY, lines: episodeLines },
    { id: 'shared', x: 187, y: focusY, lines: focusLines },
    ...memberLabels,
    ...(!visible.length ? [{ id: 'empty', x: 302, y: firstMemberY, lines: ['확인된 소속', 'Alert 없음'] }] : []),
    ...(hidden ? [{ id: 'additional', x: 302, y: firstMemberY + Math.max(1, visible.length) * memberSpacing,
      lines: [`나머지 Alert ${hidden}개`] }] : []),
  ];
  const measurementKey = JSON.stringify(labels.map(({ id, x, y, lines }) => [id, x, y, lines]));
  useLayoutEffect(() => {
    let active = true;
    const layer = labelLayer.current;
    const measure = () => {
      if (!active || !layer) return;
      const boxes = Object.fromEntries(Array.from(layer.children).flatMap(node => {
        const bounds = node.getBBox?.();
        if (!bounds?.width) return [];
        const { x, y, width, height } = bounds;
        return [[node.dataset.trailLabel, { x, y, width, height }]];
      }));
      setMeasurement({ key: measurementKey, boxes });
    };
    measure();
    document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { active = false; document.fonts?.removeEventListener('loadingdone', measure); };
  }, [measurementKey]);

  const boxes = Object.fromEntries(labels.map(label => [label.id,
    (measurement?.key === measurementKey && measurement.boxes[label.id]) || estimatedBounds(label)]));
  const margins = { account: 11, group: 18, member: 12 };
  const sharedBubble = labelBubble(boxes.shared, margins.account);
  const memberContours = memberLabels.map(label => ({
    label, bubble: labelBubble(boxes[label.id], margins.member),
  }));
  const episodeContour = bubbleOutline([
    labelBubble(boxes.episode, margins.group), sharedBubble,
    ...memberContours.map(({ bubble }) => ({
      ...bubble, radiusX: bubble.radiusX + margins.member, radiusY: bubble.radiusY + margins.member,
    })),
    ...['empty', 'additional'].filter(id => boxes[id]).map(id => labelBubble(boxes[id], margins.member)),
  ]);
  const episodeLeft = Math.min(...episodeContour.points.map(([x]) => x));
  const alertShift = Math.min(0, episodeLeft - margins.account - boxes.alert.x - boxes.alert.width);
  const alertBubble = labelBubble({ ...boxes.alert, x: boxes.alert.x + alertShift }, margins.group);
  const alertContour = bubbleOutline([alertBubble, sharedBubble]);
  const points = [...alertContour.points, ...episodeContour.points];
  const left = Math.min(0, ...points.map(([x]) => x - margins.account));
  const right = Math.max(diagramWidth, ...points.map(([x]) => x + margins.account));
  const top = Math.min(0, ...points.map(([, y]) => y - margins.account));
  const bottom = Math.max(...points.map(([, y]) => y + margins.account));

  return <svg className="account-trail-graph" viewBox={`${left} ${top} ${right - left} ${bottom - top}`} role="img" aria-labelledby={title}>
    <title id={title}>{`비교 Alert ${alert}와 Episode ${episode}의 공유 계좌 ${shared.length}개 중 확인할 계좌 ${focus}`}</title>
    <defs><clipPath id={intersection}><path d={alertContour.path} /></clipPath></defs>
    <path className="account-trail-bubble" data-case-kind="alert" d={alertContour.path}><title>{alert}</title></path>
    <path className="account-trail-bubble" data-case-kind="episode" d={episodeContour.path}><title>{episode}</title></path>
    <path className="account-trail-intersection" d={episodeContour.path} clipPath={`url(#${intersection})`} />
    {memberContours.map(({ label, bubble }) => <ellipse key={label.id} className="account-trail-member"
      data-member-code={label.id} data-overlap={label.member.shared.length > 0}
      cx={bubble.x} cy={bubble.y} rx={bubble.radiusX} ry={bubble.radiusY}>
      <title>{[label.id, ...label.member.shared].join(' · ')}</title>
    </ellipse>)}
    <g ref={labelLayer}>
      {labels.map(({ id, x, y, lines }) => <g key={id} data-trail-label={id} data-shared-account={id === 'shared' ? focus : undefined}
        transform={id === 'alert' && alertShift ? `translate(${alertShift})` : undefined}>
        {id === 'shared' && <title>{shared.join(' · ')}</title>}
        {lines.map((line, index) => <text key={index} x={x} y={y + (index - (lines.length - 1) / 2) * lineAdvance}
          textAnchor="middle">{line}</text>)}
      </g>)}
    </g>
  </svg>;
}
