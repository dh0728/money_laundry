import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { curveBasisClosed, line } from 'd3-shape';
import './account-trail-graph.css';

const diagramWidth = 384;
const lineAdvance = 16;
const contourStep = 4;
const maxMembers = 3;
const closedSpline = line().curve(curveBasisClosed);

function wrapCode(code) {
  const characters = Array.from(code);
  const lineLength = 18;
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
  const ordered = bubbles.toSorted((first, second) => first.y - second.y);
  const top = Math.min(...ordered.map(bubble => bubble.y - bubble.radiusY));
  const bottom = Math.max(...ordered.map(bubble => bubble.y + bubble.radiusY));
  const slices = Math.ceil((bottom - top) / contourStep);
  const left = [];
  const right = [];

  // The measured ellipses protect the labels. A tapered bridge keeps adjacent lobes connected.
  for (let index = 0; index <= slices; index++) {
    const y = top + (bottom - top) * index / slices;
    const bands = [];
    for (const [position, bubble] of ordered.entries()) {
      const vertical = (y - bubble.y) / bubble.radiusY;
      if (Math.abs(vertical) <= 1 + Number.EPSILON * 8) {
        const radius = bubble.radiusX * Math.sqrt(Math.max(0, 1 - vertical ** 2));
        bands.push([bubble.x - radius, bubble.x + radius]);
      }
      const next = ordered[position + 1];
      if (next && y > bubble.y && y < next.y) {
        const fraction = (y - bubble.y) / (next.y - bubble.y);
        const eased = fraction * fraction * (3 - 2 * fraction);
        const center = bubble.x + (next.x - bubble.x) * eased;
        const width = bubble.radiusX + (next.radiusX - bubble.radiusX) * eased;
        const radius = width * (0.68 - 0.17 * Math.sin(Math.PI * fraction));
        bands.push([center - radius, center + radius]);
      }
    }
    left.push([Math.min(...bands.map(([start]) => start)), y]);
    right.push([Math.max(...bands.map(([, end]) => end)), y]);
  }

  return closedSpline([...left, ...right.reverse()]);
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
  const focusLines = ['공유 계좌', ...wrapCode(focus), `총 ${shared.length}개`];
  const titleLines = Math.max(alertLines.length, episodeLines.length);
  const titleY = 40 + (titleLines - 2) * lineAdvance / 2;
  const focusY = titleY + (titleLines + focusLines.length) * lineAdvance / 2 + 18;
  const firstMemberY = focusY + (focusLines.length + 2) * lineAdvance / 2 + 26;
  const memberLabels = visible.map((member, index) => ({
    id: member.code, x: member.shared.length ? 251 : 292, y: firstMemberY + index * lineAdvance * 4,
    lines: [`Alert ${member.code.split('-').at(-1)}`, member.evidenceAvailable ? `공유 ${member.shared.length}개` : '근거 미확인'],
    member,
  }));
  const labels = [
    { id: 'alert', x: 82, y: titleY, lines: alertLines },
    { id: 'episode', x: 289, y: titleY, lines: episodeLines },
    { id: 'shared', x: 179, y: focusY, lines: focusLines },
    ...memberLabels,
    ...(!visible.length ? [{ id: 'empty', x: 280, y: firstMemberY, lines: ['확인된 소속 Alert 없음'] }] : []),
    ...(hidden ? [{ id: 'additional', x: 287, y: firstMemberY + Math.max(1, visible.length) * lineAdvance * 4,
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
  const matchingEdges = memberContours.filter(({ label }) => label.member.shared.length)
    .map(({ bubble }) => ({ x: bubble.x - bubble.radiusX, y: bubble.y, radiusX: margins.group, radiusY: bubble.radiusY }));
  const alertContour = [labelBubble(boxes.alert, margins.group), sharedBubble, ...matchingEdges];
  const episodeContour = [
    labelBubble(boxes.episode, margins.group), sharedBubble,
    ...memberContours.map(({ bubble }) => ({
      ...bubble, radiusX: bubble.radiusX + margins.member, radiusY: bubble.radiusY + margins.member,
    })),
    ...['empty', 'additional'].filter(id => boxes[id]).map(id => labelBubble(boxes[id], margins.member)),
  ];
  const bubbles = [...alertContour, ...episodeContour];
  const left = Math.min(0, ...bubbles.map(({ x, radiusX }) => x - radiusX - margins.account));
  const right = Math.max(diagramWidth, ...bubbles.map(({ x, radiusX }) => x + radiusX + margins.account));
  const top = Math.min(0, ...bubbles.map(({ y, radiusY }) => y - radiusY - margins.account));
  const bottom = Math.max(...bubbles.map(({ y, radiusY }) => y + radiusY + margins.account));
  const alertPath = bubbleOutline(alertContour);
  const episodePath = bubbleOutline(episodeContour);

  return <svg className="account-trail-graph" viewBox={`${left} ${top} ${right - left} ${bottom - top}`} role="img" aria-labelledby={title}>
    <title id={title}>{`비교 Alert ${alert}와 Episode ${episode}의 공유 계좌 ${shared.length}개 중 확인할 계좌 ${focus}`}</title>
    <defs><clipPath id={intersection}><path d={alertPath} /></clipPath></defs>
    <path className="account-trail-bubble" data-case-kind="alert" d={alertPath}><title>{alert}</title></path>
    <path className="account-trail-bubble" data-case-kind="episode" d={episodePath}><title>{episode}</title></path>
    <path className="account-trail-intersection" d={episodePath} clipPath={`url(#${intersection})`} />
    {memberContours.map(({ label, bubble }) => <ellipse key={label.id} className="account-trail-member"
      data-member-code={label.id} data-overlap={label.member.shared.length > 0}
      cx={bubble.x} cy={bubble.y} rx={bubble.radiusX} ry={bubble.radiusY}>
      <title>{[label.id, ...label.member.shared].join(' · ')}</title>
    </ellipse>)}
    <g ref={labelLayer}>
      {labels.map(({ id, x, y, lines }) => <g key={id} data-trail-label={id} data-shared-account={id === 'shared' ? focus : undefined}>
        {id === 'shared' && <title>{shared.join(' · ')}</title>}
        {lines.map((line, index) => <text key={index} x={x} y={y + (index - (lines.length - 1) / 2) * lineAdvance}
          textAnchor="middle">{line}</text>)}
      </g>)}
    </g>
  </svg>;
}
