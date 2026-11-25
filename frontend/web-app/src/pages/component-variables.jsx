import React, { useEffect, useState } from 'react';
import { NativeSelect } from '@/components/ui/select';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '../components/panel';
import { SearchField } from '../components/search-field';
import { LinkTag, VerdictTag } from '../components/semantic-tags';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../components/workflow-table';
import figmaColors from '../config/figma-colors.json';
import './component-variables.css';
import { Box, Text } from '@/components/layout-primitives';

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
    return <Text as="span" className="variable-swatch" data-swatch="color" style={{ '--variable-swatch-value': value }} aria-hidden="true" />;
  }
  if (CSS.supports('background-image', token.value) && token.value.includes('gradient(')) {
    return <Text as="span" className="variable-swatch" data-swatch="gradient" style={{ '--variable-swatch-value': value }} aria-hidden="true" />;
  }
  if (token.name.includes('shadow') && CSS.supports('box-shadow', token.value)) {
    return <Text as="span" className="variable-swatch" data-swatch="shadow" style={{ '--variable-swatch-value': value }} aria-hidden="true" />;
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
      <Box>
        <Text as="strong">Figma 프리뷰 디자인 시스템</Text>
        <Text>Figma에서 라이트·다크 변수와 원본 컴포넌트를 편집할 수 있습니다.</Text>
      </Box>
      <LinkTag href={figmaFoundation} target="_blank" rel="noopener">Figma 디자인 시스템 열기</LinkTag>
    </Panel>
    <Panel className="variable-radius-example">
      <Box as="dl" className="variable-card-metrics">
        {Object.entries(cardDimensions).map(([name, label]) => <Box key={name}>
          <Box as="dt">{label}</Box><Box as="dd"><Text as="code">{tokens.find(token => token.name === name)?.value}</Text></Box>
        </Box>)}
      </Box>
      <Box className="catalogue-actions">
        <VerdictTag verdict="abnormal" /><VerdictTag verdict="unjudged" /><VerdictTag verdict="normal" />
      </Box>
    </Panel>
    <Box className="variable-filters">
      <Box as="label">분류
        <NativeSelect className="variable-field" value={group} onChange={event => setGroup(event.target.value)}
          options={[{ value: 'all', label: '전체' }, ...[...groups, otherGroup].map(({ id, label }) => ({ value: id, label }))]} />
      </Box>
      <SearchField variant="compact" label="변수 검색" placeholder="변수 검색" value={search} onChange={event => setSearch(event.target.value)} />
    </Box>
    <WorkflowTable label="디자인 변수" summary={tableCount(results.length, tokens.length, '개')} className="variable-table" tools={false} panel>
        <TableHeader><TableRow>
          <SortableTableHead sorting={sorting} column="name" value={token => token.name}>이름</SortableTableHead>
          <SortableTableHead sorting={sorting} column="group" value={token => token.group.label}>분류</SortableTableHead>
          <SortableTableHead sorting={sorting} column="value" value={token => token.value}>적용값</SortableTableHead>
        </TableRow></TableHeader>
        <TableBody>
          {sorting.rows.map(token => <TableRow key={token.name}>
            <TableCell>
              <Text as="code">{token.figma?.role ?? token.name}</Text>
              {token.figma && <Text as="small" className="variable-css-name">{token.name}</Text>}
            </TableCell>
            <TableCell>{colorUses[token.figma?.role] ?? cardDimensions[token.name] ?? token.group.label}</TableCell>
            <TableCell>
              <Box className="variable-value">
                <VariableSample token={token} />
                <Text as="code">{token.figma ? `Light ${token.figma.light} · Dark ${token.figma.dark}` : token.value}</Text>
              </Box>
            </TableCell>
          </TableRow>)}
          {!results.length && <TableRow><TableCell colSpan={3}>조건에 맞는 변수가 없습니다.</TableCell></TableRow>}
        </TableBody>
    </WorkflowTable>
  </>;
}
