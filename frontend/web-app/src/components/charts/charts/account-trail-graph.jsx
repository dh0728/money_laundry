import React, { useId } from 'react';
import './account-trail-graph.css';

export function AccountTrailGraph({ network, focus }) {
  const arrow = useId();
  const title = useId();
  const [receipt, payment] = network.edges;
  const returned = receipt.source === payment.target;
  const points = new Map([[receipt.source, { x: 54, y: returned ? 76 : 48 }],
    [focus, { x: returned ? 266 : 160, y: returned ? 76 : 104 }]]);
  if (!returned) points.set(payment.target, { x: 266, y: 48 });
  const paths = returned
    ? ['M 63 70 Q 160 2 257 70', 'M 257 82 Q 160 150 63 82']
    : ['M 63 52 Q 113 54 150 98', 'M 170 98 Q 207 54 257 52'];
  return <svg className="account-trail-graph" viewBox="0 0 320 152" role="img" aria-labelledby={title}>
    <title id={title}>{`${receipt.source}에서 ${focus}로 송금, 이후 ${focus}에서 ${payment.target}로 송금`}</title>
    <defs>
      <marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8"
        markerUnits="userSpaceOnUse" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
      </marker>
    </defs>
    {network.edges.map(({ id, source, target, codes }, index) => <path key={id} className="account-trail-edge"
      data-source={source} data-target={target} data-transaction={[...codes].join(' ')} d={paths[index]} markerEnd={`url(#${arrow})`} />)}
    <text className="account-trail-edge-label" x={returned ? 160 : 104} y={returned ? 28 : 82} textAnchor="middle">수취</text>
    <text className="account-trail-edge-label" x={returned ? 160 : 216} y={returned ? 136 : 82} textAnchor="middle">송금</text>
    {network.nodes.map(({ id, owner }) => {
      const { x, y } = points.get(id);
      return <g key={id} className="account-trail-node" data-account={id} data-shared={id === focus || undefined}>
        <title>{owner ? `${id} · ${owner}` : id}</title>
        <circle cx={x} cy={y} />
        <text x={x} y={returned || id === focus ? y + 28 : y - 18} textAnchor="middle"
          textLength={id.length > 12 ? 96 : undefined} lengthAdjust="spacingAndGlyphs">{id}</text>
      </g>;
    })}
  </svg>;
}
