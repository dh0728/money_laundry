import React, { useId, useState } from 'react';
import { Box, Text } from '../../layout-primitives';
import './account-trail-graph.css';

const width = 384;
const height = 200;
const amountFormat = new Intl.NumberFormat('ko-KR');
const scopeLabels = { comparison: '비교 Alert', episode: 'Episode 소속 거래', shared: '양쪽에 속한 거래' };

const scopeOf = ({ comparison, episode }) => comparison && episode ? 'shared' : comparison ? 'comparison' : 'episode';
const amountLabel = row => Number.isFinite(row.amount) && row.currency ? `${amountFormat.format(row.amount)} ${row.currency}` : '';

function accountLayout(transfers, focus) {
  const [received, sent] = transfers;
  const parties = new Map(transfers.flatMap(row => [[row.from.code, row.from], [row.to.code, row.to]]));
  const placed = new Map([[focus, [width / 2, height / 2]]]);
  placed.set(received.from.code, [width / 8, height / 2]);
  if (sent.to.code !== received.from.code) placed.set(sent.to.code, [width * 7 / 8, height / 2]);
  const additional = [...parties.keys()].filter(code => !placed.has(code));
  const steps = additional.length + 2;
  const right = Math.ceil(steps / 2);
  const angles = Array.from({ length: steps }, (_, index) => index)
    .filter(index => index !== 0 && index !== right);
  additional.forEach((code, index) => {
    const angle = Math.PI + 2 * Math.PI * angles[index] / steps;
    placed.set(code, [width / 2 + Math.cos(angle) * width * 7 / 16, height / 2 + Math.sin(angle) * height * 7 / 16]);
  });
  return [...parties.values()].map(party => {
    const [x, y] = placed.get(party.code);
    return { ...party, x, y };
  });
}

function transferPath(source, target, bend) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) {
    const size = 20 + Math.abs(bend);
    return `M ${source.x - 5} ${source.y - 5} C ${source.x - size} ${source.y - size}, ${source.x + size} ${source.y - size}, ${source.x + 6} ${source.y - 5}`;
  }
  const directionX = dx / distance;
  const directionY = dy / distance;
  const x1 = source.x + directionX * 9;
  const y1 = source.y + directionY * 9;
  const x2 = target.x - directionX * 11;
  const y2 = target.y - directionY * 11;
  return `M ${x1} ${y1} Q ${(x1 + x2) / 2 - directionY * bend} ${(y1 + y2) / 2 + directionX * bend}, ${x2} ${y2}`;
}

export function AccountTrailGraph({ comparison, focus }) {
  const graphId = useId();
  const [selection, setSelection] = useState(null);
  const { transfers } = comparison;
  const leadingAccounts = new Set([focus, transfers[0].from.code, transfers[1].to.code]);
  const accounts = accountLayout(transfers, focus);
  const accountsById = new Map(accounts.map(account => [account.code, account]));
  const pairs = Map.groupBy(transfers, row => [row.from.code, row.to.code].toSorted().join('\u0001'));
  const edges = [...pairs.values()].flatMap(rows => rows.map((row, index) => {
    const direction = row.from.code <= row.to.code ? 1 : -1;
    const bend = (index - (rows.length - 1) / 2) * 24 * direction;
    return { ...row, scope: scopeOf(row), path: transferPath(accountsById.get(row.from.code), accountsById.get(row.to.code), bend) };
  }));
  const selectedTransfer = selection?.type === 'transfer' && transfers.find(row => row.code === selection.code);
  const selectedAccount = accountsById.get(selection?.type === 'account' ? selection.code : focus) ?? accountsById.get(focus);
  const activeAccount = selectedTransfer ? undefined : selectedAccount.code;
  const scopes = [...new Set(['comparison', 'episode', ...edges.map(row => row.scope)])];
  const activate = (type, code) => {
    const target = { type, code };
    return { onPointerEnter: () => setSelection(target), onFocus: () => setSelection(target), onClick: () => setSelection(target) };
  };

  return <Box className="account-trail-network">
    <Box as="ul" className="account-trail-legend" aria-label="거래 소속">
      {scopes.map(scope => <Box as="li" key={scope} data-scope={scope}>
        <Text as="span">{scopeLabels[scope]}</Text>
      </Box>)}
    </Box>
    <svg className="account-trail-graph" viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${graphId}-title`}>
      <title id={`${graphId}-title`}>{`${comparison.alert}와 ${comparison.episode}의 계좌 및 거래`}</title>
      <defs>{scopes.map(scope => <marker key={scope} id={`${graphId}-${scope}`} data-scope={scope}
        viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
        <path className="account-trail-arrow" d="M 0 0 L 8 4 L 0 8 Z" />
      </marker>)}</defs>
      {edges.map(row => <g key={row.code} data-transfer={row.code} data-scope={row.scope}
        data-active={row.code === selectedTransfer?.code || row.from.code === activeAccount || row.to.code === activeAccount || undefined}
        role="graphics-symbol" tabIndex={0} aria-label={`${row.code} · ${row.from.code} → ${row.to.code}`}
        {...activate('transfer', row.code)}>
        <path className="account-trail-edge-hit" d={row.path} />
        <path className="account-trail-edge" d={row.path} markerEnd={`url(#${graphId}-${row.scope})`}
          pathLength={row.scope === 'shared' ? 2 : undefined} strokeDasharray={row.scope === 'shared' ? '1 1' : undefined}
          strokeDashoffset={row.scope === 'shared' ? 1 : undefined} />
        {row.scope === 'shared' && <path className="account-trail-edge account-trail-edge-shared" d={row.path}
          pathLength="2" strokeDasharray="1 1" />}
      </g>)}
      {accounts.map(account => <g key={account.code} data-account={account.code}
        data-shared={comparison.shared.includes(account.code) || undefined} data-focus={account.code === focus || undefined}
        className="account-trail-node" transform={`translate(${account.x} ${account.y})`}
        role="graphics-symbol" tabIndex={0} aria-label={`계좌 ${account.code}`} {...activate('account', account.code)}>
        <circle className="account-trail-node-hit" />
        <circle className="account-trail-node-dot" />
        {leadingAccounts.has(account.code) && <text className="account-trail-node-label" textAnchor="middle">{account.code}</text>}
      </g>)}
    </svg>
    <Box className="account-trail-detail" role="status">
      {selectedTransfer ? <>
        <Text as="strong" data-scope={scopeOf(selectedTransfer)}>{selectedTransfer.code}</Text>
        <Text as="span">{[`${selectedTransfer.from.code} → ${selectedTransfer.to.code}`,
          selectedTransfer.timestamp && `${selectedTransfer.timestamp.slice(5)} KST`, amountLabel(selectedTransfer)].filter(Boolean).join(' · ')}</Text>
        <Text as="span">{[selectedTransfer.comparison && comparison.alert,
          selectedTransfer.episode && (selectedTransfer.memberAlerts.join(', ') || comparison.episode)].filter(Boolean).join(' · ')}</Text>
      </> : <>
        <Text as="strong">{comparison.shared.includes(selectedAccount.code) ? '공유 계좌 ' : '계좌 '}{selectedAccount.code}</Text>
        {selectedAccount.owner && <Text as="span">{selectedAccount.owner}</Text>}
        <Text as="span">표시된 연결 거래 {transfers.filter(row => row.from.code === activeAccount || row.to.code === activeAccount).length}건</Text>
      </>}
    </Box>
    {comparison.omittedTransfers > 0 && <Text as="span" className="account-trail-omitted">이외 근거 거래 {comparison.omittedTransfers}건</Text>}
  </Box>;
}
