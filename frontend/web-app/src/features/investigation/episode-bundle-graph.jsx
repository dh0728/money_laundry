import React, { useMemo, useState } from 'react';
import { ActionButton } from '../../components/primary-button';
import { ForceCaseCanvas } from '../graph/force-case-canvas';
import { caseShapeClip } from '../graph/graph-case-groups';
import { buildCaseNetwork, mergeCaseTransactions } from './case-graph-scope';
import './preview-case-graph.css';
import { Box, Text } from '@/components/layout-primitives';

const noSelection = new Set();
const ignore = () => {};

/**
 * Episode로 묶기 창의 합친 그래프. 관련 탭 그래프와 같은 규칙으로 그린다: 색은 위험도, 선 위 표식 모양은 Alert.
 * 주변 거래(CONTEXT)는 관련 탭 기본값처럼 빼고 그린다.
 */
export default function EpisodeBundleGraph({ rows, groups }) {
  const [highlighted, setHighlighted] = useState();
  const [controlsHost, setControlsHost] = useState(null);
  const transactions = useMemo(() => mergeCaseTransactions(rows).filter(row => row.reviewRole !== 'CONTEXT'), [rows]);
  const network = useMemo(() => buildCaseNetwork(transactions), [transactions]);
  const shownHighlight = groups.some(group => group.id === highlighted) ? highlighted : undefined;
  if (!network.nodes.length) {
    return <Box className="preview-case-network episode-bundle-graph preview-graph-empty" role="status">
      <Text>{rows.length ? '거래 없음' : '선택 없음'}</Text>
    </Box>;
  }
  return <Box className="preview-case-network episode-bundle-graph" aria-label="고른 Alert 합친 그래프">
    <ForceCaseCanvas network={network} visible={network} records={transactions} selection={noSelection}
      onNodeSelect={ignore} onSelect={ignore} controlsHost={controlsHost} groups={groups}
      showDetails highlightedCase={shownHighlight} playing={false} />
    <Box className="preview-graph-actions">
      {groups.length > 1 && <Box as="ul" className="preview-graph-case-chips" aria-label="그래프의 Alert 구분">
        {groups.map(group => <Box as="li" key={group.id}>
          <ActionButton shape="pill" surface="floating" className="preview-graph-case-chip"
            aria-pressed={shownHighlight === group.id}
            style={{ '--case-graph-swatch-ink': group.color, '--case-graph-swatch-clip': caseShapeClip(group.shape) }}
            onClick={() => setHighlighted(previous => previous === group.id ? undefined : group.id)}>
            <Text as="i" className="preview-graph-chip-swatch" aria-hidden="true" />
            <Text as="code">{group.id}</Text>
            <Text as="span">{group.transactionIds.size}건</Text>
          </ActionButton>
        </Box>)}
      </Box>}
      <Box className="preview-graph-controls" ref={setControlsHost} />
    </Box>
  </Box>;
}
