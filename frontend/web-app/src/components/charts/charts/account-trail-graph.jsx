import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import './account-trail-graph.css';

const diagramWidth = 384;
const lineAdvance = 16;
const contourSamples = 16;
const maxMembers = 3;

function wrapCode(code) {
  const characters = Array.from(code);
  const lineLength = 18;
  return Array.from({ length: Math.ceil(characters.length / lineLength) }, (_, index) =>
    characters.slice(index * lineLength, (index + 1) * lineLength).join(''));
}

function bubblePoints({ x, y, width, height }, padding) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radiusY = halfHeight + padding;
  const radiusX = Math.max(halfWidth + padding, halfWidth / Math.sqrt(1 - (halfHeight / radiusY) ** 2) + padding / 2);
  return Array.from({ length: contourSamples }, (_, index) => {
    const angle = index * 2 * Math.PI / contourSamples;
    return [x + halfWidth + Math.cos(angle) * radiusX, y + halfHeight + Math.sin(angle) * radiusY];
  });
}

function bubbleOutline(points) {
  const ordered = points.toSorted(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const turn = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const boundary = entries => {
    const side = [];
    for (const point of entries) {
      while (side.length > 1 && turn(side.at(-2), side.at(-1), point) <= 0) side.pop();
      side.push(point);
    }
    return side.slice(0, -1);
  };
  const hull = [...boundary(ordered), ...boundary(ordered.toReversed())];
  const perimeter = hull.flatMap(([x, y], index) => {
    const [nextX, nextY] = hull[(index + 1) % hull.length];
    const dx = nextX - x;
    const dy = nextY - y;
    const length = Math.hypot(dx, dy);
    if (length <= lineAdvance * 3) return [[x, y]];
    const bulge = lineAdvance / (2 * length);
    return [[x, y], [(x + nextX) / 2 + dy * bulge, (y + nextY) / 2 - dx * bulge]];
  });
  const middle = ([ax, ay], [bx, by]) => `${(ax + bx) / 2} ${(ay + by) / 2}`;
  return `M ${middle(perimeter.at(-1), perimeter[0])} ${perimeter.map((point, index) =>
    `Q ${point.join(' ')} ${middle(point, perimeter[(index + 1) % perimeter.length])}`).join(' ')} Z`;
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
  const sharedPoints = bubblePoints(boxes.shared, margins.account);
  const memberContours = memberLabels.map(label => ({
    label, points: bubblePoints(boxes[label.id], margins.member),
  }));
  const matchingEdges = memberContours.filter(({ label }) => label.member.shared.length).flatMap(({ label, points }) => {
    const left = Math.min(...points.map(([x]) => x));
    return bubblePoints({ x: left, y: label.y - lineAdvance / 4, width: margins.member, height: lineAdvance / 2 }, margins.account);
  });
  const alertContour = [...bubblePoints(boxes.alert, margins.group), ...sharedPoints, ...matchingEdges];
  const episodeContour = [
    ...bubblePoints(boxes.episode, margins.group), ...sharedPoints,
    ...memberContours.flatMap(({ label, points }) => points.map(([x, y]) => {
      const angle = Math.atan2(y - label.y, x - label.x);
      return [x + Math.cos(angle) * margins.member, y + Math.sin(angle) * margins.member];
    })),
    ...['empty', 'additional'].flatMap(id => boxes[id] ? bubblePoints(boxes[id], margins.member) : []),
  ];
  const points = [...alertContour, ...episodeContour];
  const left = Math.min(0, ...points.map(([x]) => x - margins.account));
  const right = Math.max(diagramWidth, ...points.map(([x]) => x + margins.account));
  const top = Math.min(0, ...points.map(([, y]) => y - margins.account));
  const bottom = Math.max(...points.map(([, y]) => y + margins.account));
  const alertPath = bubbleOutline(alertContour);
  const episodePath = bubbleOutline(episodeContour);

  return <svg className="account-trail-graph" viewBox={`${left} ${top} ${right - left} ${bottom - top}`} role="img" aria-labelledby={title}>
    <title id={title}>{`비교 Alert ${alert}와 Episode ${episode}의 공유 계좌 ${shared.length}개 중 확인할 계좌 ${focus}`}</title>
    <defs><clipPath id={intersection}><path d={alertPath} /></clipPath></defs>
    <path className="account-trail-bubble" data-case-kind="alert" d={alertPath}><title>{alert}</title></path>
    <path className="account-trail-bubble" data-case-kind="episode" d={episodePath}><title>{episode}</title></path>
    <path className="account-trail-intersection" d={episodePath} clipPath={`url(#${intersection})`} />
    {memberContours.map(({ label, points }) => <path key={label.id} className="account-trail-member"
      data-member-code={label.id} data-overlap={label.member.shared.length > 0} d={bubbleOutline(points)}>
      <title>{[label.id, ...label.member.shared].join(' · ')}</title>
    </path>)}
    <g ref={labelLayer}>
      {labels.map(({ id, x, y, lines }) => <g key={id} data-trail-label={id} data-shared-account={id === 'shared' ? focus : undefined}>
        {id === 'shared' && <title>{shared.join(' · ')}</title>}
        {lines.map((line, index) => <text key={index} x={x} y={y + (index - (lines.length - 1) / 2) * lineAdvance}
          textAnchor="middle">{line}</text>)}
      </g>)}
    </g>
  </svg>;
}
