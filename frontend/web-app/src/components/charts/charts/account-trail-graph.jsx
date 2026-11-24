import React, { useId } from 'react';
import './account-trail-graph.css';

function circlePath(x, y, radius) {
  return `M ${x} ${y - radius} a ${radius} ${radius} 0 1 0 0 ${2 * radius} a ${radius} ${radius} 0 1 0 0 ${-2 * radius}`;
}

const accountLabel = id => id.length > 13 ? `${id.slice(0, 8)}…` : id;

export function AccountTrailGraph({ comparison, focus }) {
  const arrow = useId();
  const title = useId();
  const { alert, episode, evidence, shared, members, membersComplete, unknownMembers } = comparison;
  const [receipt, payment] = evidence;
  const returned = receipt.source === payment.target;
  const ordered = [...members].sort((first, second) =>
    Number(second.shared.includes(focus)) - Number(first.shared.includes(focus)) || second.shared.length - first.shared.length);
  const visible = ordered.slice(0, 3);
  const positions = visible.length < 3 ? [95, 194] : [77, 145, 213];
  const hidden = members.length - visible.length + unknownMembers;
  const first = { x: 48, y: 307, id: receipt.source };
  const middle = { x: returned ? 272 : 160, y: 307, id: focus };
  const last = { x: 272, y: 307, id: payment.target };
  const paths = returned
    ? ['M 57 302 Q 160 270 263 302', 'M 263 312 Q 160 343 57 312']
    : ['M 57 307 H 150', 'M 170 307 H 262'];

  return <svg className="account-trail-graph" viewBox="0 0 320 345" role="img" aria-labelledby={title}>
    <title id={title}>{`${episode}에 편입된 Alert ${members.length}개. ${alert}와 공유 계좌 ${shared.length}개. 추천 경로 ${receipt.source} → ${focus} → ${payment.target}`}</title>
    <defs>
      <marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8"
        markerUnits="userSpaceOnUse" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
      </marker>
    </defs>
    <path className="account-trail-bubble" data-case-kind="episode"
      d="M 154 40 H 264 Q 310 40 310 86 V 204 Q 310 250 264 250 H 154 Q 108 250 108 204 V 86 Q 108 40 154 40 Z">
      <title>{episode}</title>
    </path>
    <path className="account-trail-bubble" data-case-kind="alert" d={circlePath(86, 146, 81)}>
      <title>{alert}</title>
    </path>
    <text className="account-trail-group-label" x="61" y="28" textAnchor="middle">비교 Alert</text>
    <text className="account-trail-group-label" x="217" y="28" textAnchor="middle">
      {membersComplete ? `Episode · Alert ${members.length + unknownMembers}개` : 'Episode · 확인된 소속 Alert'}
    </text>
    <text className="account-trail-label" x="61" y="132" textAnchor="middle">{alert}</text>
    {visible.map((member, index) => {
      const overlaps = member.shared.length > 0;
      const x = overlaps ? 176 : 253;
      const y = positions[index];
      return <g key={member.code} className="account-trail-member" data-member-code={member.code}
        data-overlap={overlaps} data-focus-match={member.shared.includes(focus)}>
        <title>{member.shared.length ? `${member.code} · 공유 계좌 ${member.shared.join(', ')}` : member.code}</title>
        <path d={circlePath(x, y, visible.length > 2 ? 32 : 41)} />
        <text x={x} y={y - 2} textAnchor="middle">Alert {member.code.split('-').at(-1)}</text>
        <text x={x} y={y + 15} textAnchor="middle">
          {member.evidenceAvailable ? `공유 ${member.shared.length}개` : '근거 미확인'}
        </text>
      </g>;
    })}
    {!visible.length && <text className="account-trail-label" x="219" y="146" textAnchor="middle">확인된 소속 Alert 없음</text>}
    <g className="account-trail-overlap" data-shared-account={focus}>
      <title>{shared.join(' · ')}</title>
      <circle cx="130" cy="146" />
      <text x="118" y="150" textAnchor="end">{accountLabel(focus)}</text>
      <text x="118" y="167" textAnchor="end">공유 {shared.length}개</text>
    </g>
    {hidden > 0 && <text className="account-trail-label" x="259" y="237" textAnchor="middle">Alert 외 {hidden}개</text>}
    <text className="account-trail-group-label" x="160" y="276" textAnchor="middle">추천 거래 경로</text>
    {evidence.map(({ id, source, target, codes }, index) => <path key={id} className="account-trail-edge"
      data-source={source} data-target={target} data-transaction={[...codes].join(' ')}
      d={paths[index]} markerEnd={`url(#${arrow})`}>
      <title>{[...codes].join(' · ')}</title>
    </path>)}
    {(returned ? [first, middle] : [first, middle, last]).map(({ x, y, id }) =>
      <g key={id} className="account-trail-node" data-account={id} data-focus={id === focus || undefined}>
        <title>{id}</title>
        <circle cx={x} cy={y} />
        <text x={x} y={y + 23} textAnchor="middle">{accountLabel(id)}</text>
      </g>)}
  </svg>;
}
