import React, { Children, useLayoutEffect, useRef, useState } from 'react';
import { typeDisplay } from '@/api/codes';
import { ruleBlocksFor } from '@/features/rules/rules-logic';
import { BranchLines } from '../../components/react-bits/BranchLines';

export function RuleTreeBranches({ children, finalSlot }) {
  const list = useRef(null);
  const [lines, setLines] = useState(null);
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
  return <div className="rule-tree-branches">
    {lines?.height > 0 && <BranchLines rows={lines.rows} width={20} height={lines.height} trunk={5} end={20} radius={6} activeIndex={-1} />}
    <ol ref={list} aria-label="조건 순서">
      {Children.map(children, child => <li>{child}</li>)}
      <li>
        {finalSlot}
        <span className="rule-tree-outcome" data-rule-tree-target>백테스트 검토 대상</span>
      </li>
    </ol>
  </div>;
}

export function RuleConditionFacts({ input, blocks = ruleBlocksFor(input) }) {
  const score = Math.round(input.scoreMin * 10000) / 100;
  const facts = {
    typeCode: ['거래 유형', input.typeCode === null ? '전체 유형' : typeDisplay(input.typeCode).label],
    scoreMin: ['모델 점수', score > 0 ? `${score}점 이상` : '제한 없음'],
    accountWindow: ['같은 송금 계좌', `${input.windowHours}시간 내 ${input.minTransactions}건 이상`],
  };
  return <div className="rule-condition-tree">
    <strong>모든 조건 충족</strong>
    <RuleTreeBranches>
      {blocks.map(kind => <div className="rule-tree-fact" data-rule-tree-target key={kind}>
        <span>{facts[kind][0]}</span><strong>{facts[kind][1]}</strong>
      </div>)}
    </RuleTreeBranches>
  </div>;
}
