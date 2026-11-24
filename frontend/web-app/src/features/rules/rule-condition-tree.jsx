import React, { Children, useLayoutEffect, useRef, useState } from 'react';
import { typeDisplay } from '@/api/codes';
import { ruleBlocksFor } from '@/features/rules/rules-logic';
import { BranchLines } from '../../components/react-bits/BranchLines';
import { Box, Text } from '../../components/layout-primitives';
import { readWorkspaceLength } from '../dashboard/workspace-metrics';

export function RuleTreeBranches({ children, finalSlot }) {
  const list = useRef(null);
  const [lines, setLines] = useState(null);
  const [geometry] = useState(() => ({
    width: readWorkspaceLength('--rule-tree-branch-width') || 20,
    trunk: readWorkspaceLength('--rule-tree-trunk-offset') || 5,
    radius: readWorkspaceLength('--rule-tree-branch-radius') || 6,
  }));
  useLayoutEffect(() => {
    const node = list.current;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      const rows = Array.from(node.children, item => {
        const target = item.querySelector('[data-rule-drag-handle], [data-rule-tree-target]') ?? item;
        const box = target.getBoundingClientRect();
        return Math.round(box.top + box.height / 2 - bounds.top);
      });
      const height = Math.ceil(bounds.height);
      setLines(previous => previous?.height === height && previous.rows.length === rows.length &&
        rows.every((row, index) => row === previous.rows[index]) ? previous : { height, rows });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const item of node.children) observer.observe(item);
    return () => observer.disconnect();
  }, [children]);
  return <Box className="rule-tree-branches">
    {lines?.height > 0 && <BranchLines rows={lines.rows} width={geometry.width} height={lines.height}
      trunk={geometry.trunk} end={geometry.width} radius={geometry.radius} activeIndex={-1} />}
    <Box as="ol" ref={list} aria-label="조건 순서">
      {Children.map(children, child => <Box as="li">{child}</Box>)}
      <Box as="li">
        {finalSlot}
        <Text as="span" className="rule-tree-outcome" data-rule-tree-target>백테스트 검토 대상</Text>
      </Box>
    </Box>
  </Box>;
}

export function RuleConditionFacts({ input, blocks = ruleBlocksFor(input) }) {
  const score = Math.round(input.scoreMin * 10000) / 100;
  const facts = {
    typeCode: ['거래 유형', input.typeCode === null ? '전체 유형' : typeDisplay(input.typeCode).label],
    scoreMin: ['모델 점수', score > 0 ? `${score}점 이상` : '제한 없음'],
    accountWindow: ['같은 송금 계좌', `${input.windowHours}시간 내 ${input.minTransactions}건 이상`],
  };
  return <Box className="rule-condition-tree">
    <Text as="strong">모든 조건 충족</Text>
    <RuleTreeBranches>
      {blocks.map(kind => <Box className="rule-tree-fact" data-rule-tree-target key={kind}>
        <Text as="span">{facts[kind][0]}</Text><Text as="strong">{facts[kind][1]}</Text>
      </Box>)}
    </RuleTreeBranches>
  </Box>;
}
