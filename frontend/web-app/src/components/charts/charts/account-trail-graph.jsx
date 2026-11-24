import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import './account-trail-graph.css';

const lineAdvance = 16;
const minimumLabelSeparation = 1.25;
const layouts = new Map();
const layoutPoints = Array.from({ length: 25 }, (_, index) => (index - 12) / 4)
  .flatMap(y => Array.from({ length: 16 }, (_, index) => [0.5 + index / 4, y]))
  .sort(([x, y], [a, b]) => x * 0.45 + Math.abs(y) - a * 0.45 - Math.abs(b) || x - a);

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

function estimatedBounds({ lines, x, y }) {
  const width = Math.max(...lines.map(line => Array.from(line).length)) * lineAdvance / 2;
  const height = lines.length * lineAdvance;
  return { x: x - width / 2, y: y - height / 2, width, height };
}

function alertPositions(overlaps) {
  const key = overlaps.map(row => row.map(Number).join('')).join('/');
  if (key === '1/11') return [[0, 0], [1.55, -0.68], [1.55, 0.68]];
  if (layouts.has(key)) return layouts.get(key);

  // In normalized coordinates, equal ellipses intersect exactly when centers are less than two units apart.
  function place(positions, candidates) {
    const row = overlaps[positions.length - 1];
    if (!row) return positions;
    for (const [x, y] of candidates) {
      if (!positions.every(([otherX, otherY], index) => {
        const horizontal = Math.abs(x - otherX);
        const vertical = Math.abs(y - otherY);
        if (Math.max(horizontal, vertical) < minimumLabelSeparation) return false;
        const distance = horizontal ** 2 + vertical ** 2;
        return row[index] ? distance >= 1.22 ** 2 && distance <= 1.94 ** 2 : distance >= 2.14 ** 2;
      })) continue;
      const result = place([...positions, [x, y]], candidates);
      if (result) return result;
    }
    return null;
  }

  const positions = place([[0, 0]], layoutPoints.filter(([x]) => x >= 1.25)) ?? place([[0, 0]], layoutPoints);
  layouts.set(key, positions);
  return positions;
}

export function AccountTrailGraph({ comparison, focus }) {
  const title = useId();
  const labelLayer = useRef(null);
  const [measurement, setMeasurement] = useState(null);
  const { alert, episode, shared, members, memberRelations, membersComplete, hiddenMembers } = comparison;
  const connections = [
    ...members.filter(member => member.shared.length).map(member => ({ first: alert, second: member.code, accounts: member.shared, transactions: [] })),
    ...memberRelations,
  ];
  const alertLabels = [{ id: alert, lines: ['비교 Alert', ...wrapCode(alert), '공유 계좌', ...wrapCode(focus, 12)] },
    ...members.map(member => ({ id: member.code, lines: [`Alert ${member.code.split('-').at(-1)}`,
      member.evidenceAvailable ? `공유 ${member.shared.length}개` : '근거 미확인'] }))];
  const labels = [
    ...alertLabels,
    { id: episode, lines: ['Episode', membersComplete ? `Alert ${members.length + hiddenMembers}개 편입` : '편입 정보 일부 확인',
      ...(!members.length ? ['확인된 소속 Alert 없음'] : []),
      ...(hiddenMembers ? [`그 외 Alert ${hiddenMembers}개`] : [])] },
  ];
  const measurementKey = JSON.stringify(labels);
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
    (measurement?.key === measurementKey && measurement.boxes[label.id]) || estimatedBounds({ ...label, x: 0, y: 0 })]));
  const labelPadding = 12;
  const positions = alertPositions(alertLabels.slice(1).map(({ id }, index) => alertLabels.slice(0, index + 1)
    .map(({ id: other }) => connections.some(({ first, second }) => first === other && second === id))));
  const sizes = alertLabels.map(({ id }) => labelBubble(boxes[id], labelPadding));
  const radiusX = Math.max(...sizes.map(size => size.radiusX), ...alertLabels.map(({ id }) => boxes[id].width / minimumLabelSeparation));
  const radiusY = Math.max(...sizes.map(size => size.radiusY), ...alertLabels.map(({ id }) => boxes[id].height / minimumLabelSeparation));
  const bubbles = alertLabels.map(({ id }, index) => ({
    id, x: positions[index][0] * radiusX, y: positions[index][1] * radiusY,
    radiusX, radiusY, clip: `${title}-alert-${index}`,
  }));
  const [external, ...episodeAlerts] = bubbles;
  const memberPositions = episodeAlerts.map(bubble => bubble.x);
  const episodeHeading = { id: episode,
    x: memberPositions.length ? (Math.min(...memberPositions) + Math.max(...memberPositions)) / 2 : 2.5 * radiusX,
    y: Math.min(...bubbles.map(bubble => bubble.y)) - radiusY - boxes[episode].height / 2 - labelPadding,
  };
  const left = Math.min(episodeHeading.x - boxes[episode].width / 2, ...bubbles.map(bubble => bubble.x - radiusX)) - labelPadding;
  const right = Math.max(episodeHeading.x + boxes[episode].width / 2, ...bubbles.map(bubble => bubble.x + radiusX)) + labelPadding;
  const top = episodeHeading.y - boxes[episode].height / 2 - labelPadding;
  const bottom = Math.max(...bubbles.map(bubble => bubble.y + radiusY)) + labelPadding;

  const bubbleByCode = new Map(bubbles.map(bubble => [bubble.id, bubble]));
  const ellipse = bubble => ({ cx: bubble.x, cy: bubble.y, rx: bubble.radiusX, ry: bubble.radiusY });
  return <svg className="account-trail-graph" viewBox={`${left} ${top} ${right - left} ${bottom - top}`} role="img" aria-labelledby={title}>
    <title id={title}>{`비교 Alert ${alert}와 Episode ${episode}의 공유 계좌 ${shared.length}개 중 확인할 계좌 ${focus}`}</title>
    <defs>{bubbles.map(bubble => <clipPath id={bubble.clip} key={bubble.id}><ellipse {...ellipse(bubble)} /></clipPath>)}</defs>
    {bubbles.map(bubble => <ellipse key={bubble.id} className="account-trail-member" data-alert-code={bubble.id}
      data-episode-member={bubble !== external || undefined} {...ellipse(bubble)}>
      <title>{bubble.id}</title>
    </ellipse>)}
    {connections.map(({ first, second, accounts, transactions }) => <ellipse key={`${first}:${second}`}
      className="account-trail-intersection" data-pair={`${first}:${second}`} {...ellipse(bubbleByCode.get(second))}
      clipPath={`url(#${bubbleByCode.get(first).clip})`}>
      <title>{[first, second, ...accounts, ...transactions].join(' · ')}</title>
    </ellipse>)}
    <g ref={labelLayer}>
      {[...bubbles, episodeHeading].map(({ id, x, y }, index) => <g key={id} data-trail-label={id}
        className={id === episode ? 'account-trail-episode' : undefined}
        transform={`translate(${x - boxes[id].x - boxes[id].width / 2} ${y - boxes[id].y - boxes[id].height / 2})`}>
        {id === alert && <title>{shared.join(' · ')}</title>}
        {id === episode && <title>{episode}</title>}
        {labels[index].lines.map((line, lineIndex, lines) => <text key={lineIndex} y={(lineIndex - (lines.length - 1) / 2) * lineAdvance}
          textAnchor="middle">{line}</text>)}
      </g>)}
    </g>
  </svg>;
}
