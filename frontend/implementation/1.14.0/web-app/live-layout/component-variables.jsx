import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from './panel';
import { LinkTag, VerdictTag } from './semantic-tags';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from './workflow-table';
import figmaColors from './figma-colors.json';
import './component-variables.css';

const figmaFoundation = 'https://www.figma.com/design/iWjQL5GdXwenHGeZNHF4Uw?node-id=8-101';
const figmaRoles = new Map(figmaColors.colors.map(([role, light, dark]) =>
  [`--aml-figma-${role.replaceAll('/', '-')}`, { role, light, dark }]));
const colorUses = {
  'contents/neutral/primary': '본문 · 아이콘 · 카드 버튼',
  'surface/neutral/background/primary': '전체 화면 배경',
  'surface/neutral/background/secondary': '그래프 · 상세 패널 · 글래스 표면',
  'surface/brand/accent/default': '강조 버튼 · 필터 · AI 요약',
  'surface/status/danger/accent/default': '이상 판정 · 고위험',
  'surface/status/caution/accent/default': '판정 전 · 주의 점수',
  'surface/status/positive/accent/default': '정상 판정 · 낮은 점수 · 처리 완료',
  'surface/status/pending/accent/default': '검토 대기 · 룰 초안',
  'surface/status/info/accent/default': '처리 중',
};
const cardDimensions = {
  '--aml-radius-card': '카드·패널·표 모서리',
  '--aml-card-header-padding': '체크박스 왼쪽·추가 버튼 여백',
  '--aml-card-title-inset': 'ID만 있을 때 왼쪽 여백',
};

const groups = [
  { id: 'figma', label: '기존 Figma 참조 색상', pattern: /^--aml-figma-(?!light-|dark-)/ },
  { id: 'dimensions', label: '크기와 여백', pattern: /^--(?:aml-(?:space|size|radius|stroke|density|card|layout)-|workspace-(?:gap|padding)|header-(?:gap|control-size|button-padding))/ },
  { id: 'typography', label: '타이포그래피', pattern: /^--aml-(?:type|font)-/ },
  { id: 'surface', label: '표면', pattern: /^--(?:aml-(?:semantic-)?surface-|(?:canvas|workspace|inner|information-panel)-surface|selection-surface)/ },
  { id: 'border', label: '테두리', pattern: /^--(?:aml-(?:semantic-)?border-|divider(?:$|-))/ },
  { id: 'contents', label: '글자와 아이콘', pattern: /^--(?:aml-(?:semantic-contents|text)-|text(?:$|-)|selection-ink)/ },
  { id: 'effects', label: '효과', pattern: /^--(?:aml-(?:semantic-effects|layer|motion|opacity)-|(?:panel-)?glass-|shadow|information-panel-shadow)/ },
  { id: 'status', label: '상태와 브랜드', pattern: /^--(?:aml-status-|brand-|risk-|status-|tag-|record-verdict-|review-(?:status|lane|tag)-|ai-summary-|primary-action-)/ },
  { id: 'palette', label: '팔레트', pattern: /^--aml-[a-z]+-\d{3}$/ },
];

const otherGroup = { id: 'other', label: '기타' };

function readVariables() {
  const styles = getComputedStyle(document.body);
  return Array.from(styles).filter(name => !/^--aml-figma-(?:light|dark)-/.test(name)
    && (name.startsWith('--aml-') || groups.some(group => group.pattern.test(name))))
    .sort()
    .flatMap(name => {
      const value = styles.getPropertyValue(name).trim();
      if (!value) return [];
      const group = groups.find(group => group.pattern.test(name)) ?? otherGroup;
      return [{ name, value, group, figma: figmaRoles.get(name) }];
    });
}

function VariableSample({ token }) {
  const value = `var(${token.name})`;
  if (CSS.supports('color', token.value)) {
    return <span className="variable-swatch" style={{ backgroundColor: value }} aria-hidden="true" />;
  }
  if (CSS.supports('background-image', token.value) && token.value.includes('gradient(')) {
    return <span className="variable-swatch" style={{ backgroundImage: value }} aria-hidden="true" />;
  }
  if (token.name.includes('shadow') && CSS.supports('box-shadow', token.value)) {
    return <span className="variable-swatch" style={{ boxShadow: value }} aria-hidden="true" />;
  }
  return null;
}

export function DesignVariables() {
  const [tokens, setTokens] = useState([]);
  const [group, setGroup] = useState('status');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const refresh = () => setTokens(readVariables());
    refresh();
    document.addEventListener('aml:appearance', refresh);
    return () => document.removeEventListener('aml:appearance', refresh);
  }, []);

  const query = search.trim().toLowerCase();
  const results = tokens.filter(token => (group === 'all' || token.group.id === group)
    && [token.name, token.value, token.group.label, token.figma?.role, colorUses[token.figma?.role], cardDimensions[token.name]]
      .join(' ').toLowerCase().includes(query));
  const sorting = useTableSort(results);
  return <>
    <Panel className="variable-source">
      <div>
        <strong>Figma 프리뷰 디자인 시스템</strong>
        <p>Figma에서 라이트·다크 변수와 원본 컴포넌트를 편집할 수 있습니다.</p>
      </div>
      <LinkTag href={figmaFoundation} target="_blank" rel="noopener">Figma 디자인 시스템 열기</LinkTag>
    </Panel>
    <Panel className="glass variable-radius-example">
      <dl className="variable-card-metrics">
        {Object.entries(cardDimensions).map(([name, label]) => <div key={name}>
          <dt>{label}</dt><dd><code>{tokens.find(token => token.name === name)?.value}</code></dd>
        </div>)}
      </dl>
      <div className="catalogue-actions">
        <VerdictTag verdict="abnormal" /><VerdictTag verdict="unjudged" /><VerdictTag verdict="normal" />
      </div>
    </Panel>
    <div className="variable-filters">
      <label>분류
        <select className="variable-field" value={group} onChange={event => setGroup(event.target.value)}>
          <option value="all">전체</option>
          {[...groups, otherGroup].map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <label>변수 검색
        <Input className="variable-field" type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
    </div>
    <WorkflowTable label="디자인 변수" summary={tableCount(results.length, tokens.length, '개')} className="variable-table" tools={false} panel>
        <TableHeader><TableRow>
          <SortableTableHead sorting={sorting} column="name" value={token => token.name}>이름</SortableTableHead>
          <SortableTableHead sorting={sorting} column="group" value={token => token.group.label}>분류</SortableTableHead>
          <SortableTableHead sorting={sorting} column="value" value={token => token.value}>적용값</SortableTableHead>
        </TableRow></TableHeader>
        <TableBody>
          {sorting.rows.map(token => <TableRow key={token.name}>
            <TableCell>
              <code>{token.figma?.role ?? token.name}</code>
              {token.figma && <small className="variable-css-name">{token.name}</small>}
            </TableCell>
            <TableCell>{colorUses[token.figma?.role] ?? cardDimensions[token.name] ?? token.group.label}</TableCell>
            <TableCell>
              <div className="variable-value">
                <VariableSample token={token} />
                <code>{token.figma ? `Light ${token.figma.light} · Dark ${token.figma.dark}` : token.value}</code>
              </div>
            </TableCell>
          </TableRow>)}
          {!results.length && <TableRow><TableCell colSpan={3}>조건에 맞는 변수가 없습니다.</TableCell></TableRow>}
        </TableBody>
    </WorkflowTable>
  </>;
}
