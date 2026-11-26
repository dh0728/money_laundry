import { createElement } from 'react';
import { act, fireEvent, renderHook, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCaseNetwork, graphRiskBand, graphTableSelection, graphVerdict, transactionsWithinHops } from './case-graph-scope';
import { caseAccountLayout } from './case-pattern-layout';
import { caseSankeyGraph, layoutCaseSankey } from './case-sankey-data';
import { sankeyLinkPath } from '@/components/charts/charts/sankey/sankey-path';
import { ownerGraphLayout, ownerTransferPath } from '../graph/owner-graph-layout';
import { caseGroupColor } from '../graph/graph-case-groups';
import { mountCaseGraph } from './preview-case-graph';
import { previewUrl, readPreviewRoute } from '../../app/preview-route';
import { ScreenLayout, ScreenNavigation } from '../../app/screen-layouts';
import { useTableSelection } from '../../components/workflow-table';

vi.mock('react-force-graph-2d', () => ({
  default: function MockForceGraph({ graphData, nodeVisibility, onNodeClick }) {
    return createElement('div', null, graphData.nodes.filter(nodeVisibility).map(node => createElement('button', {
      key: node.id, type: 'button', onClick: () => onNodeClick(node),
    }, `계좌 노드 ${node.id}`)));
  },
}));

const account = (code, owner = code) => ({ code, owner });
const transfer = (code, from, to, score, verdict = 'unjudged') => ({ code, from, to, score, verdict });

describe('case graph analysis', () => {
  it('reserves the reference color while cycling through the comparison case colors', () => {
    const reference = caseGroupColor(0);
    const comparison = [1, 2, 3, 4].map(caseGroupColor);
    expect(new Set(comparison).size).toBe(4);
    expect(comparison).not.toContain(reference);
    expect([5, 6, 7, 8].map(caseGroupColor)).toEqual(comparison);
  });

  it('distinguishes score zero, exact thresholds and missing scores', () => {
    expect([undefined, null, -1, 101, 0, 69.99, 70, 89.99, 90, 100].map(graphRiskBand))
      .toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'low', 'low', 'medium', 'medium', 'high', 'high']);
  });

  it('collapses linked accounts by owner without fabricating risk or merging verdicts', () => {
    const rows = [
      transfer('T1', account('A1', 'X'), account('B1', 'Y'), 90, 'normal'),
      transfer('T2', account('A2', 'X'), account('B2', 'Y'), 90, 'abnormal'),
      transfer('T3', account('A1', 'X'), account('B1', 'Y'), undefined),
    ];
    const accountGraph = buildCaseNetwork(rows);
    expect(accountGraph.nodes).toHaveLength(4);
    const ownerGraph = buildCaseNetwork(rows, true);
    expect(ownerGraph.nodes.map(node => [node.id, node.accounts.size, node.peakScore]))
      .toEqual([['X', 2, 90], ['Y', 2, 90]]);
    expect(ownerGraph.edges).toHaveLength(1);
    expect(ownerGraph.edges[0].codes.size).toBe(3);
    expect(graphVerdict(ownerGraph.edges[0].verdicts)).toBe('mixed');
    expect(ownerGraph.edges[0].peakScore).toBe(90);
  });

  it('selects direct node evidence, owner accounts, and the chosen timed edge', () => {
    const first = account('A1', 'X'), second = account('A2', 'X'), other = account('B', 'Y');
    const rows = [
      transfer('T1', first, other, 90), transfer('T2', first, other, 80),
      transfer('T3', second, other, 70), transfer('T4', other, account('C', 'Z'), 60),
    ];
    const accountGraph = buildCaseNetwork(rows);
    const ownerGraph = buildCaseNetwork(rows, true);
    const node = accountGraph.nodes.find(node => node.id === first.code);
    const owner = ownerGraph.nodes.find(node => node.id === 'X');
    const edge = accountGraph.edges.find(edge => edge.source === first.code);
    expect(graphTableSelection(rows, node)).toEqual({ accounts: new Set(['A1']), transactions: new Set(['T1', 'T2']) });
    expect(graphTableSelection(rows, owner)).toEqual({ accounts: new Set(['A1', 'A2']), transactions: new Set(['T1', 'T2', 'T3']) });
    expect(graphTableSelection(rows, edge, new Set(['T2']))).toEqual({ accounts: new Set(['A1', 'B']), transactions: new Set(['T2']) });
    expect(graphTableSelection(rows)).toBeUndefined();
  });

  it('keeps manual table picks and honors unchecking graph-linked rows', () => {
    const rows = [{ code: 'T1' }, { code: 'T2' }];
    const { result, rerender } = renderHook(linked => useTableSelection(rows, undefined, linked));
    act(() => result.current.toggleRow('T1', true));
    const linked = new Set(['T1', 'T2']);
    rerender(linked);
    expect(result.current.selectedCount).toBe(2);
    act(() => result.current.toggleRow('T2', false));
    rerender(linked);
    expect(result.current.has('T2')).toBe(false);
    rerender(undefined);
    expect(result.current.has('T1')).toBe(true);
    expect(result.current.has('T2')).toBe(false);
    rerender(new Set(['T2']));
    expect(result.current.selectedCount).toBe(2);
  });

  it('shares analysis table and owner graph selection in both directions', async () => {
    const first = account('A1', 'X'), second = account('A2', 'X'), other = account('B', 'Y');
    const fixture = (index, from, to) => ({ ...transfer(`T-261111-0000000${index}`, from, to, 90),
      timestamp: `2026-11-11 13:0${index}`, method: '계좌이체', currency: 'KRW', amount: 100, status: '처리 전' });
    const transactions = [fixture(1, first, other), fixture(2, second, other), fixture(3, first, other)];
    const active = { code: 'A-261111-000001', related: transactions };
    const host = document.createElement('div');
    host.innerHTML = '<div data-case-flow="analysis" data-lens="owner"></div><div data-case-evidence="거래" data-analysis-table></div><div data-case-accounts></div>';
    document.body.append(host);
    const graph = within(host);
    const checkbox = code => graph.getByRole('checkbox', { name: `${code} 선택` });
    const clearSelection = () => graph.queryByRole('button', { name: '그래프 선택 해제' });
    const edge = (source = 'A1') => graph.getByRole('button', { name: new RegExp(`${source} → B ·`) });
    const node = () => graph.getByRole('button', { name: 'A2 · X' });
    let graphCleanup;
    try {
      await act(async () => {
        graphCleanup = mountCaseGraph(host.children[0], { active, cases: [active] });
      });
      expect(graph.getByRole('region', { name: '그래프' })).toBeInTheDocument();
      expect(graph.queryByRole('heading', { name: '그래프', exact: true })).not.toBeInTheDocument();
      const settingsButton = graph.getByRole('button', { name: '그래프 설정' });
      const settingsBody = document.getElementById(settingsButton.getAttribute('aria-controls'));
      expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
      expect(settingsBody).not.toHaveAttribute('inert');
      fireEvent.click(settingsButton);
      expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
      expect(settingsBody).toHaveAttribute('inert');
      fireEvent.click(settingsButton);
      expect(settingsBody).not.toHaveAttribute('inert');
      expect(graph.getByRole('button', { name: '거래 재생' })).toHaveAttribute('data-button-surface', 'ghost');
      expect(graph.getByRole('button', { name: '그래프 화면에 맞추기' })).toHaveAttribute('data-button-shape', 'circle');

      fireEvent.click(checkbox(transactions[0].code));
      expect(edge()).toHaveAccessibleName(/2건.*13:01 ~ .*13:03 KST/);
      expect(edge()).toHaveAttribute('aria-pressed', 'true');
      expect(edge('A2')).toHaveAttribute('aria-pressed', 'false');
      expect(clearSelection()).toBeInTheDocument();
      expect(graph.queryByRole('complementary', { name: '상세 내용' })).not.toBeInTheDocument();
      fireEvent.click(checkbox('A2'));
      expect(node()).toHaveAttribute('aria-pressed', 'true');
      expect(edge()).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(checkbox(transactions[0].code));
      expect(edge()).toHaveAttribute('aria-pressed', 'false');
      expect(clearSelection()).toBeInTheDocument();
      fireEvent.click(checkbox('A2'));
      expect(node()).toHaveAttribute('aria-pressed', 'false');
      expect(clearSelection()).toBeNull();

      fireEvent.click(edge());
      expect(checkbox(transactions[0].code)).toBeChecked();
      expect(checkbox(transactions[2].code)).toBeChecked();
      expect(checkbox('A1')).toBeChecked();
      expect(checkbox('B')).toBeChecked();
      fireEvent.click(checkbox(transactions[0].code));
      expect(edge()).toHaveAttribute('aria-pressed', 'false');
      expect(checkbox('A1')).not.toBeChecked();
      expect(clearSelection()).toBeNull();

      const owner = graph.getByRole('button', { name: 'X · 계좌 묶음 선택' });
      fireEvent.click(owner);
      expect(owner).toHaveAttribute('aria-pressed', 'true');
      expect(checkbox(transactions[0].code)).toBeChecked();
      expect(checkbox(transactions[1].code)).toBeChecked();
      expect(checkbox('A1')).toBeChecked();
      expect(checkbox('A2')).toBeChecked();
      expect(checkbox('B')).not.toBeChecked();
      fireEvent.keyDown(owner, { key: 'Enter' });
      expect(owner).toHaveAttribute('aria-pressed', 'false');
      expect(checkbox(transactions[0].code)).not.toBeChecked();
      expect(checkbox('A2')).not.toBeChecked();
      expect(clearSelection()).toBeNull();

      const picker = graph.getByRole('combobox', { name: '계좌·연결 선택' });
      fireEvent.keyDown(picker, { key: 'Enter' });
      fireEvent.click(within(document.body).getByRole('option', { name: 'A2' }));
      expect(node()).toHaveAttribute('aria-pressed', 'true');
      expect(checkbox(transactions[1].code)).toBeChecked();
      fireEvent.click(node());
      expect(node()).toHaveAttribute('aria-pressed', 'false');
      expect(checkbox(transactions[1].code)).not.toBeChecked();
      expect(picker).toHaveTextContent('전체 관계');

      fireEvent.click(checkbox('A2'));
      fireEvent.click(checkbox(transactions[0].code));
      fireEvent.click(node());
      expect(checkbox('A2')).not.toBeChecked();
      expect(checkbox(transactions[0].code)).toBeChecked();
    } finally {
      await act(async () => { graphCleanup?.(); });
      host.remove();
    }
  });

  it('restores the full pattern graph and evidence when the selected account is clicked again', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; }
      observe(element) {
        if (element.hasAttribute('data-force-graph')) this.callback([{ contentRect: { width: 600, height: 360 } }]);
      }
      disconnect() {}
    });
    const rows = [
      transfer('T-261111-00000001', account('A1'), account('A2'), 90),
      transfer('T-261111-00000002', account('B1'), account('B2'), 70),
    ].map((row, index) => ({ ...row, timestamp: `2026-11-11 13:0${index + 1}`,
      method: '계좌이체', currency: 'KRW', amount: 100, status: '처리 전' }));
    const active = { code: 'A-261111-000001', pattern: 'FAN-OUT 82%', related: rows };
    const host = document.createElement('div');
    host.innerHTML = '<div data-case-flow="analysis" data-lens="pattern"></div><div data-case-evidence="거래" data-analysis-table></div><div data-case-accounts></div>';
    document.body.append(host);
    const graph = within(host);
    const checkbox = code => graph.queryByRole('checkbox', { name: `${code} 선택` });
    const node = id => graph.queryByRole('button', { name: `계좌 노드 ${id}` });
    let cleanup;
    try {
      await act(async () => { cleanup = mountCaseGraph(host.children[0], { active, cases: [active] }); });
      expect(node('B1')).toBeInTheDocument();
      fireEvent.click(node('A1'));
      expect(node('B1')).not.toBeInTheDocument();
      expect(checkbox(rows[0].code)).toBeChecked();
      expect(checkbox(rows[1].code)).not.toBeInTheDocument();
      fireEvent.click(node('A1'));
      expect(node('B1')).toBeInTheDocument();
      expect(checkbox(rows[0].code)).not.toBeChecked();
      expect(checkbox(rows[1].code)).not.toBeChecked();
    } finally {
      await act(async () => { cleanup?.(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it('opens the third graph lens directly for Alert and Episode, also in read-only views', () => {
    for (const [family, code] of [['alerts', 'A-261111-000001'], ['episodes', 'E-261111-000001']]) {
      for (const tab of ['analysis', 'related']) {
        const url = new URL(`https://radar.test/${family}/${code}?tab=${tab}&view=sankey&access=read-only&data=sample`);
        const route = readPreviewRoute(url);
        const screen = `${family.slice(0, -1)}/${tab}/sankey/staff-readonly`;
        expect(route).toEqual({ screen, code });
        expect(ScreenNavigation(screen, code).secondary.map(item => [item.label, item.active]))
          .toEqual([['패턴별', false], ['소유주별', false], ['생키', true]]);
        expect(ScreenLayout(screen, { code })).toContain('data-lens="sankey"');
        expect(previewUrl(route, url.searchParams)).toBe(url.pathname + url.search);
      }
    }
  });

  it('mounts one Sankey chart for both currencies alongside the two evidence tables', async () => {
    const from = account('A'), to = account('B');
    const rows = [
      { ...transfer('T-261111-00000001', from, to, 90), currency: 'KRW', amount: 750,
        timestamp: '2026-11-11 13:01', method: '계좌이체', status: '처리 전' },
      { ...transfer('T-261111-00000002', from, to, 70), currency: 'USD', amount: 200,
        timestamp: '2026-11-11 13:02', method: '계좌이체', status: '처리 전' },
    ];
    const active = { code: 'A-261111-000001', related: rows };
    const host = document.createElement('div');
    host.innerHTML = '<div data-case-flow="analysis" data-lens="sankey"></div><div data-case-evidence="거래" data-analysis-table></div><div data-case-accounts></div>';
    document.body.append(host);
    let cleanup;
    try {
      await act(async () => { cleanup = mountCaseGraph(host.children[0], { active, cases: [active] }); });
      const graph = within(host);
      expect(graph.getAllByRole('figure')).toHaveLength(1);
      expect(graph.getByRole('figure', { name: '송금에서 수취로 · 계좌 2개 · 경로 1개' })).toHaveTextContent('띠 두께 · 거래 건수');
      expect(graph.getAllByRole('table')).toHaveLength(2);
      expect(graph.queryByRole('complementary', { name: '상세 내용' })).not.toBeInTheDocument();
    } finally {
      await act(async () => { cleanup?.(); });
      host.remove();
    }
  });

  it('combines Sankey currency routes while preserving counts, amounts, risk and return directions', () => {
    const a = account('A'), b = account('B'), c = account('C');
    const rows = [
      { ...transfer('T1', a, b, 18), currency: 'KRW', amount: 100 },
      { ...transfer('T2', a, b, 92), currency: 'KRW', amount: 150 },
      { ...transfer('T3', a, c, 72), currency: 'KRW', amount: 200 },
      { ...transfer('T4', b, a, 101), currency: 'KRW', amount: 300 },
      { ...transfer('T5', a, b, 10), currency: 'USD', amount: 4 },
      { ...transfer('T6', a, b, 99), currency: 'USD', amount: 0 },
      { ...transfer('T7', c, c, 90), currency: 'KRW', amount: 25 },
    ];
    const graph = caseSankeyGraph(rows);
    expect(graph.links.map(link => [link.value, [...link.codes], graphRiskBand(link.peakScore)])).toEqual([
      [4, ['T1', 'T2', 'T5', 'T6'], 'high'], [1, ['T3'], 'medium'],
      [1, ['T4'], 'unknown'], [1, ['T7'], 'high'],
    ]);
    expect(graph.nodes.map(node => node.name)).toEqual(['A', 'B', 'C']);
    expect(graph.links[0].amounts).toEqual(new Map([['KRW', 250], ['USD', 4]]));
    expect(graph.nodes[1].incoming).toEqual(graph.links[0].amounts);
    expect(graph.nodes[1].outgoing).toEqual(new Map([['KRW', 300]]));
    const layout = layoutCaseSankey(graph, { width: 260, height: 180, nodeWidth: 8, nodePadding: 16 });
    expect(layout.links[0].width).toBe(4 * layout.links[2].width);
    expect(layout.links[2].returnY).toBeLessThan(layout.nodes[1].y0);
    expect(layout.links[3].source).toBe(layout.links[3].target);
    const paths = layout.links.map(link => sankeyLinkPath(link, 16));
    expect(paths.every(path => path.startsWith('M') && !/NaN|Infinity/.test(path))).toBe(true);
    expect(paths.map(path => path.includes(' H '))).toEqual([false, false, true, true]);
  });

  it('only claims pattern placement when supported and otherwise shows actual direction', () => {
    const hub = account('A');
    const rows = [transfer('T1', hub, account('B'), 75)];
    const single = caseAccountLayout(buildCaseNetwork(rows), 'Fan-out 82%');
    expect(single.kind).toBe('direction');
    expect(single.positions.A.x).toBeLessThan(single.positions.B.x);
    const fanOut = caseAccountLayout(buildCaseNetwork([...rows, transfer('T2', hub, account('C'), 20)]), 'Fan-out 82%');
    expect(fanOut.kind).toBe('pattern');
    expect(fanOut.positions.B.x).toBe(fanOut.positions.C.x);
    expect(fanOut.positions.B.y).not.toBe(fanOut.positions.C.y);
  });

  it('keeps unknown owners as separate accounts across the graph, hops and flow chart', () => {
    const rows = [
      { ...transfer('T1', account('A1', null), account('B1', 'X'), 70), currency: 'KRW', amount: 100 },
      { ...transfer('T2', account('A2', ''), account('B2', 'Y'), 50), currency: 'KRW', amount: 200 },
    ];
    expect(buildCaseNetwork(rows, true).edges.map(({ source, target }) => [source, target]))
      .toEqual([['A1', 'X'], ['A2', 'Y']]);
    expect(transactionsWithinHops(rows, 'A1', 1, true).map(row => row.code)).toEqual(['T1']);
    expect(caseSankeyGraph(rows, true).nodes.map(node => node.name)).toEqual(['A1', 'X', 'A2', 'Y']);
  });

  it('recognizes fixture abbreviations and preserves a scatter-gather diamond', () => {
    const rows = [
      transfer('T1', account('A'), account('B'), 75), transfer('T2', account('A'), account('C'), 75),
      transfer('T3', account('B'), account('D'), 75), transfer('T4', account('C'), account('D'), 75),
    ];
    const { kind, positions } = caseAccountLayout(buildCaseNetwork(rows), 'SC-GA 82%');
    expect(kind).toBe('pattern');
    expect(positions.A.x).toBeLessThan(positions.B.x);
    expect(positions.B.x).toBe(positions.C.x);
    expect(positions.B.x).toBeLessThan(positions.D.x);
  });

  it('groups account rows by owner and keeps each transaction in its directional link and timestamp', () => {
    const first = account('A1', 'X'), second = account('B1', 'X');
    const rows = [
      { ...transfer('T1', first, second, 75), timestamp: '2026-11-11 13:32' },
      { ...transfer('T2', second, first, 20), timestamp: '2026-11-11 14:33' },
      { ...transfer('T3', first, second, 90), timestamp: '2026-11-11 15:34' },
    ];
    const { owners, links, times, timeByCode } = ownerGraphLayout(rows);
    expect(owners.map(owner => owner.accounts.map(account => account.id))).toEqual([['A1', 'B1']]);
    expect(links.map(({ from, to, rows: evidence }) => [from.id, to.id, evidence.map(row => row.code)]))
      .toEqual([['A1', 'B1', ['T1', 'T3']], ['B1', 'A1', ['T2']]]);
    expect(rows.map(row => timeByCode.get(row.code))).toEqual(times);
    const [{ from, to }] = links;
    const { path, midpoint } = ownerTransferPath(from, to, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(path).toMatch(/^M \d+ \d+ C /);
    expect(midpoint[1]).toBeGreaterThan(owners[0].y + owners[0].height);
  });
});
