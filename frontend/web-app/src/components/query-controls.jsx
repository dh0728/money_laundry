import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fixtureReviewStatus, fixtureVerdict } from '../mocks/verdict-fixtures';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DayPicker } from 'react-day-picker';
import { ko } from 'react-day-picker/locale';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { createCsv, downloadBlob, downloadCsv as saveCsv } from '@/lib/report-io';
import { Button, Icon, IconButton, bindTooltip, hideTooltip } from './components.js';
import { ActionButton } from './primary-button';
import { FilterTag, reviewStates, reviewStatusLabel, VerdictTag, verdictLabels } from './semantic-tags';
import { modelRiskBand, modelRiskLabels } from '../features/settings/model-risk-settings';
import { createPageCsvZip, printWorkspace } from '../lib/page-export';
import { downloadVisualizations, hasVisualizations } from '../lib/preview-visual-export.js';
import JellyRadio from './react-bits/JellyRadio';
import { QueryCheck } from './selection-check';
import { SearchField } from './search-field';
import { FormDropdown, FormDropdownItem } from './form-dropdown';
import { readWorkspaceGap } from '../features/dashboard/workspace-metrics.js';
import { sortSavedTableRows, tableSortFields } from './workflow-table';
import 'react-day-picker/style.css';
import '../styles/page-export-print.css';
import './query-controls.css';

const statuses = reviewStates.map(({ value }) => value);
const scopeOptions = [{ value: 'all', label: '전체' }, { value: 'assigned', label: '내 담당' }];
const elapsedOptions = [
  { value: 'under-three', label: '3일 미만' }, { value: 'three-to-six', label: '3~6일' }, { value: 'week', label: '7일 이상' },
];
const defaultQuery = { sort: '', risks: [], patterns: [], elapsed: [], statuses: [], verdicts: [], assignment: 'all', range: undefined, search: '' };
const caseSearchPlaceholder = 'ID, 탐지 유형, 담당자 검색';
const searchLimit = 100;

/** 검색어를 띄어쓰기로 나눠 모든 낱말이 fields 어딘가에 들어 있으면 맞는 것으로 본다(대소문자 무시). */
export function matchesSearch(fields, search = '') {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return terms.every(term => text.includes(term));
}

/** Alert·Episode 는 ID, 탐지 유형(패턴), 담당자(이름·아이디·'내 담당')로 찾는다. */
export const caseMatchesSearch = (row, search) => matchesSearch([
  row.code, row.pattern, ...(row.patterns ?? []), row.assigneeName, row.assignee, row.assigned ? '내 담당' : '',
], search);
const caseVerdicts = ['unjudged', 'normal', 'abnormal'].map(value => ({ value, label: verdictLabels[value] }));
const samplePatterns = ['Fan-out 82%', 'Cycle 74%', 'Gather-scatter 71%'];

const queryTools = { filter: '필터', sort: '정렬', period: '기간', download: '다운로드' };
const queryTriggerSelector = '[data-query-tool]:not([data-query-tool="download"])';
const embeddedDownloads = new WeakMap();
const pageDownloadLabel = '현재 페이지 전체 다운로드';

function queryToolButton(tool, label, surface) {
  return IconButton(Icon(tool), label,
    `data-query-tool="${tool}" aria-haspopup="dialog" aria-expanded="false" hidden`, 'query-trigger', surface);
}

export function QueryToolbar({ page = false } = {}) {
  const buttons = Object.entries(queryTools).map(([tool, label]) => {
    const pageExport = page && tool === 'download';
    return `<div class="query-control"${pageExport ? ' id="page-download"' : ''}>
      ${queryToolButton(tool, pageExport ? pageDownloadLabel : label, 'ghost')}
    </div>`;
  }).join('');
  return `<div class="context-query-tools" role="group" aria-label="조회 도구" hidden>${buttons}</div>`;
}

// 화면 맨 위 줄에 두는 조회 도구. [기간 ×] [필터 (개수)] ······ [정렬] [다운로드]
// 아이콘만 있던 버튼에 글자를 붙여 찾기 쉽게 한다. 화면을 그릴 때마다 그 화면의 .screen-query-row 로 옮겨 붙는다.
function queryBarControl(tool, label, { extra = '', id = '' } = {}) {
  const content = Icon(tool) +
    (tool === 'period' ? '<span class="screen-title-accessible">기간 </span>' : '') +
    `<span class="query-trigger-label" data-query-label>${label}</span>` +
    (tool === 'filter' ? '<span class="query-count" data-query-count hidden></span>' : '');
  const button = Button(content, { variant: 'query-trigger query-bar-trigger', surface: 'floating', shape: 'pill',
    attributes: `data-query-tool="${tool}" aria-haspopup="dialog" aria-expanded="false" hidden` });
  return `<div class="query-control query-bar-control"${id ? ` id="${id}"` : ''}>${button}${extra}</div>`;
}

export function QueryBar() {
  const clearPeriod = IconButton(Icon('close'), '기간 지우기', 'data-query-clear="period" hidden', 'query-clear', 'floating', 'pill');
  // 검색창 자리. 공용 SearchField 는 setupQueryControls 가 이 안에 그린다.
  const search = '<div class="query-search" data-query-search-field hidden></div>';
  return `<div class="context-query-tools query-bar" role="group" aria-label="조회 도구" hidden>
    <div class="query-bar-main">${search}${queryBarControl('period', '기간', { extra: clearPeriod })}${queryBarControl('filter', '필터')}</div>
    <div class="query-bar-side">${queryBarControl('sort', '정렬')}${queryBarControl('download', '다운로드', { id: 'page-download' })}</div>
  </div>`;
}

// 도구 줄을 처음 만들어 두는 자리. 화면이 그려지면 그 화면 맨 위로 옮겨 가므로 여기서는 보이지 않는다.
export function WorkspaceQueryDock() {
  return `<div id="workspace-query-dock" hidden>${QueryBar()}</div>`;
}

const embeddedToolbar = { __html: QueryToolbar() };

export function LocalQueryTools({ actions, relatedRows, onRelatedQuery, downloadSurface = 'ghost' }) {
  const host = useRef(null);
  const controller = useRef(null);
  useEffect(() => {
    const element = host.current;
    const instance = setupQueryControls({
      workspace: element, controls: element.firstElementChild, embedded: true, downloadSurface,
      onChange: (_tool, query) => {
        onRelatedQuery?.(query);
        instance.refresh();
      },
    });
    controller.current = instance;
    embeddedDownloads.set(element, instance);
    return () => {
      embeddedDownloads.delete(element);
      instance.dispose();
    };
  }, [onRelatedQuery, downloadSurface]);
  useEffect(() => {
    if (relatedRows) controller.current.setScreen('related-candidates', [], { rows: relatedRows });
  }, [onRelatedQuery, relatedRows, downloadSurface]);
  useEffect(() => controller.current.registerTableTools(actions), [actions, onRelatedQuery, downloadSurface]);
  return <div ref={host} data-local-query-tools=""
    data-page-only-download={actions?.panelDownload === false || undefined} dangerouslySetInnerHTML={embeddedToolbar} />;
}

export { LocalQueryTools as TableQueryTools };

export function visualizationEntries({ label, filename, readRoot }) {
  return ['png', 'svg'].map(format => ({
    label, format: format.toUpperCase(),
    download: () => downloadVisualizations({ format, filename, root: readRoot() }),
  }));
}

function CalendarChevron({ orientation = 'left' }) {
  const Chevron = ({ left: ChevronLeft, right: ChevronRight, down: ChevronDown, up: ChevronUp })[orientation] ?? ChevronLeft;
  return <Chevron className="aml-calendar-chevron" aria-hidden="true" />;
}

const patternValue = row => row.pattern?.replace(/\s+\d+%$/, '');
const elapsedValue = days => !Number.isFinite(days) ? undefined : days >= 7 ? 'week' : days >= 3 ? 'three-to-six' : 'under-three';
const identityOptions = values => values.map(value => ({ value, label: value }));

function filterGroups(rows, scope) {
  const patterns = [...new Set(rows.map(patternValue).filter(Boolean))];
  const labels = modelRiskLabels();
  const riskOptions = ['high', 'medium', 'low'].map(value => ({ value, label: labels[value] }));
  return [
    { key: 'risks', name: 'risk', label: '위험도', options: rows.some(row => Number.isFinite(row.score)) ? riskOptions : [] },
    { key: 'patterns', name: 'pattern', label: '패턴', options: identityOptions(patterns) },
    { key: 'elapsed', name: 'elapsed', label: '경과일', options: rows.some(row => Number.isFinite(row.elapsed)) ? elapsedOptions : [] },
    { key: 'assignment', label: '담당자', options: allowsAssignment(scope) ? scopeOptions : [] },
    { key: 'statuses', name: 'status', label: '처리 상태', options: reviewStates },
    { key: 'verdicts', name: 'verdict', label: '사람 판정', options: scope === 'related-candidates' ? caseVerdicts : [] },
  ].filter(group => group.options.length);
}

function availableSorts(rows) {
  const currencies = [...new Set(rows.flatMap(row => Object.keys(row.amountByCurrency ?? {})))].sort();
  return [
    ...(rows.some(row => Number.isFinite(row.score)) ? [{ value: 'risk', label: '위험도순' }] : []),
    ...(rows.some(row => Number.isFinite(row.elapsed)) ? [{ value: 'elapsed', label: '경과일순' }] : []),
    ...currencies.map(currency => ({ value: `amount:${currency}`, label: `금액순 (${currency})` })),
    { value: 'ascending', label: '코드 오름차순' },
    { value: 'descending', label: '코드 내림차순' },
    { value: '', label: '기본 순서' },
  ];
}

function ActiveFilters({ value, groups, sorts, boardSortHost, onChange, onEdit, popupId, focus, extra = [], showPeriod = true }) {
  const filters = groups.filter(group => group.name).flatMap(({ key, label, options }) =>
    value[key].map(selected => {
      const optionLabel = options.find(option => option.value === selected)?.label ?? selected;
      return {
        tool: 'filter', group: key,
        label: key === 'statuses' ? optionLabel : `${label}: ${optionLabel}`,
        remove: () => onChange({ ...value, [key]: value[key].filter(item => item !== selected) }),
      };
    }));
  if (value.assignment !== 'all') filters.push({
    tool: 'filter', group: 'assignment', label: '내 담당', remove: () => onChange({ ...value, assignment: 'all' }),
  });
  const chips = [];
  const sortChip = value.sort && {
    tool: 'sort', label: `정렬 · ${sorts.find(option => option.value === value.sort)?.label ?? value.sort}`,
    remove: () => onChange({ ...value, sort: '' }, 'sort'),
  };
  if (sortChip && !boardSortHost) chips.push(sortChip);
  if (value.range && showPeriod) chips.push({
    tool: 'period',
    label: `${formatDate(value.range.from)} ~ ${formatDate(value.range.to)}`,
    remove: () => onChange({ ...value, range: undefined }),
  });
  chips.push(...extra, ...filters);
  const focused = Math.max(0, chips.findIndex(chip => chip.tool === focus));
  const tag = ({ tool, group, label, remove, removableOnly }, autoFocus) => <FilterTag key={`${tool}:${label}`} onRemove={remove}
    onEdit={removableOnly ? undefined : event => onEdit(tool, event.currentTarget, group)} popupId={removableOnly ? undefined : popupId}
    autoFocus={autoFocus}>{label}</FilterTag>;
  return <>
    {chips.length > 0 && <div className="active-query-tags" role="group" aria-label="적용된 조회 조건">
      {chips.map((chip, index) => tag(chip, Boolean(focus) && !(boardSortHost && focus === 'sort') && index === focused))}
    </div>}
    {sortChip && boardSortHost && createPortal(tag(sortChip, focus === 'sort'), boardSortHost)}
  </>;
}

export function dateFromCode(code) {
  const [, date] = code.split('-');
  return new Date(2000 + Number(date.slice(0, 2)), Number(date.slice(2, 4)) - 1, Number(date.slice(4, 6)));
}

export function inDateRange(date, range) {
  return !range || (date >= range.from && date <= range.to);
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const queryScope = path => {
  if (path === 'related-candidates') return path;
  return path?.startsWith('dashboard/')
    ? path.replace('/', '-') : /^add-tab\/(alerts|episodes)(?:-|\/|$)/.exec(path ?? '')?.[1];
};
const hasLocalTableTools = path => /^(add-tab\/(alerts|episodes)-table|report\/write\/(?:table|card)|rule-engine\/draft-(list(?:\/reason)?|backtest))$/
  .test(path?.replace(/\/(no-filter|sidebar-collapsed)$/, '') ?? '');
const allowsAssignment = scope => scope !== 'dashboard-mine';

function parseQuery(params, scope, rows) {
  const parseDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return undefined;
    const date = new Date(`${value}T00:00:00`);
    return formatDate(date) === value ? date : undefined;
  };
  const from = parseDate(params.get('from'));
  const to = parseDate(params.get('to'));
  const sort = params.get('sort');
  return {
    ...defaultQuery,
    sort: availableSorts(rows).some(option => option.value === sort) ? sort : '',
    ...Object.fromEntries(filterGroups(rows, scope).filter(group => group.name).map(({ key, name, options }) => [
      key, options.map(option => option.value).filter(value => params.getAll(name).includes(value)),
    ])),
    assignment: allowsAssignment(scope) && params.get('assignment') === 'assigned' ? 'assigned' : 'all',
    range: from && to && from <= to ? { from, to } : undefined,
    search: (params.get('q') ?? '').slice(0, searchLimit),
  };
}

export function caseFixtureRows(codes) {
  return codes.map((code, index) => {
    const verdict = fixtureVerdict(code);
    return {
      code,
      verdict,
      date: dateFromCode(code),
      status: fixtureReviewStatus(verdict, statuses[Math.floor(index / 2) % 2]),
      assigned: index % 2 === 0,
      pattern: samplePatterns[index % samplePatterns.length],
    };
  });
}

export function visibleCaseRows(rows, query) {
  const filtered = rows.filter(row => (
    (!query.statuses.length || query.statuses.includes(row.status))
    && (!query.verdicts?.length || query.verdicts.includes(row.verdict))
    && (!query.risks?.length || query.risks.includes(modelRiskBand(row.score)))
    && (!query.patterns?.length || query.patterns.includes(patternValue(row)))
    && (!query.elapsed?.length || query.elapsed.includes(elapsedValue(row.elapsed)))
    && (query.assignment === 'all' || row.assigned)
    && inDateRange(row.date, query.range)
    && caseMatchesSearch(row, query.search)
  ));
  if (!query.sort) return filtered;
  if (query.sort === 'ascending' || query.sort === 'descending') {
    const sign = query.sort === 'ascending' ? 1 : -1;
    return filtered.sort((left, right) => sign * left.code.localeCompare(right.code));
  }
  const sortValue = row => query.sort === 'risk' ? row.score : query.sort === 'elapsed' ? row.elapsed
    : row.amountByCurrency?.[query.sort.slice('amount:'.length)];
  return filtered.sort((left, right) => {
    const l = sortValue(left) ?? -Infinity;
    const r = sortValue(right) ?? -Infinity;
    return (l === r ? 0 : r - l) || left.code.localeCompare(right.code);
  });
}

export { QueryCheck };

export function QueryRadio({ items, label, value, onChange }) {
  return <JellyRadio className="aml-density-radio" items={items} ariaLabel={label} value={value} onChange={onChange}
    size="sm" gap="var(--aml-space-4)" radius="var(--aml-space-8)" chipColor="var(--glass-surface)" activeColor="var(--selection-surface)"
    textColor="var(--text)" activeTextColor="var(--selection-ink)" />;
}

const presets = [
  { value: 'today', label: '오늘' },
  { value: '3', label: '최근 3일' },
  { value: 'week', label: '이번 주' },
  { value: 'month', label: '이번 달' },
  { value: 'quarter', label: '이번 분기' },
  { value: 'year', label: '올해' },
];

function presetRange(value, asOf) {
  const from = new Date(asOf);
  if (value === 'month') from.setDate(1);
  else if (value === 'year') from.setMonth(0, 1);
  else if (value === 'quarter') from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
  else if (value === 'week') from.setDate(from.getDate() - from.getDay());
  else if (value !== 'today') from.setDate(from.getDate() - (Number(value) - 1));
  return { from, to: asOf };
}

const rangeLabel = range => range?.from
  ? `${formatDate(range.from)} ~ ${range.to ? formatDate(range.to) : '종료일 선택'}` : '전체 기간';

function QueryChoices({ options, value, onChange, label, className = '' }) {
  const name = useId();
  return <fieldset className={`query-choice-group ${className}`}>
    <legend className="visually-hidden">{label}</legend>
    {options.map(option => <label className="query-choice" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value}
        onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </fieldset>;
}

const QueryActions = createContext(null);

function QueryPanel({ title, onSubmit, children, invalid = false }) {
  const formId = useId();
  const actions = useContext(QueryActions);
  const apply = useRef(null);
  useEffect(() => bindTooltip(apply.current, actions.tooltip), [actions]);
  return <>
    {createPortal(<ActionButton ref={apply} className="query-apply icon-button" surface="floating"
      type="submit" form={formId} aria-label="적용" disabled={invalid}>
      <Check className="icon" aria-hidden="true" />
    </ActionButton>, actions.host)}
    <form id={formId} aria-label={title} onSubmit={event => { event.preventDefault(); if (!invalid) onSubmit(); }}>
      {children}
    </form>
  </>;
}

function FilterPane({ value, groups, onApply, onResize, editingGroup }) {
  const [draft, setDraft] = useState(value);
  const [group, setGroup] = useState(() => editingGroup ?? groups.find(({ key }) =>
    key === 'assignment' ? value.assignment !== 'all' : value[key].length)?.key ?? '');
  const groupId = useId();
  useLayoutEffect(() => { onResize(); }, [group, onResize]);
  return <QueryPanel title="필터 속성" onSubmit={() => onApply(draft)}>
    <div className="query-popover-body query-filter-groups">
      {groups.map(({ key, label, options }) => {
        const assignment = key === 'assignment';
        const active = assignment ? Number(draft.assignment !== 'all') : draft[key].length;
        const open = key === group;
        const id = `${groupId}-${key}`;
        return <div key={key}>
          <ActionButton className="query-filter-group" aria-expanded={open} aria-controls={id}
            onClick={() => setGroup(open ? '' : key)}>
            <span>{label}</span>
            {active > 0 && <span className="query-menu-detail">{active}개</span>}
            <ChevronRight className="icon icon-compact" aria-hidden="true" />
          </ActionButton>
          <div className="query-filter-values" id={id} hidden={!open}>
            {assignment ? <QueryChoices label={label} options={options} value={draft.assignment}
              onChange={next => setDraft(previous => ({ ...previous, assignment: next }))} />
              : <fieldset className="query-filter-values-group">
                <legend className="visually-hidden">{label}</legend>
                {options.map(option => <QueryCheck key={option.value}
                  label={key === 'verdicts' ? <VerdictTag verdict={option.value} /> : option.label}
                  ariaLabel={option.label}
                  checked={draft[key].includes(option.value)} onChange={checked => setDraft(previous => ({
                    ...previous, [key]: checked ? [...previous[key], option.value]
                      : previous[key].filter(item => item !== option.value),
                  }))} />)}
              </fieldset>}
          </div>
        </div>;
      })}
      {groups.some(({ key }) => key === 'assignment' ? draft.assignment !== 'all' : draft[key].length) &&
        <ActionButton className="query-reset" onClick={() => setDraft({ ...defaultQuery, sort: draft.sort, range: draft.range })}>
          필터 초기화
        </ActionButton>}
    </div>
  </QueryPanel>;
}

function SortPane({ value, sorts, onApply, sortScope }) {
  const [sort, setSort] = useState(value.sort);
  return <QueryPanel title="정렬 기준" onSubmit={() => onApply({ ...value, sort })}>
    <div className="query-popover-body">
      {sortScope && <p className="query-popover-note">대시보드에서는 ‘{sortScope}’ 섹션에만 적용됩니다.</p>}
      <QueryChoices label="정렬 기준" options={sorts} value={sort} onChange={setSort} />
    </div>
  </QueryPanel>;
}

function TableFilterPane({ filter, onApply }) {
  const [value, setValue] = useState(filter.value);
  return <QueryPanel title={filter.label} onSubmit={() => onApply(value)}>
    <div className="query-popover-body">
      <QueryChoices label={filter.label} options={filter.options} value={value} onChange={setValue} />
    </div>
  </QueryPanel>;
}

function CalendarDropdown({ 'aria-label': label, disabled, options, value, onChange }) {
  const { host } = useContext(QueryActions);
  return <FormDropdown label={label} value={String(value)} disabled={disabled}
    onValueChange={value => onChange({ target: { value } })}
    triggerClassName="query-calendar-select" optionsClassName="query-calendar-options"
    portalContainer={host.closest('.query-tool-popover')}>
    {options.map(({ value, label, disabled }) => <FormDropdownItem key={value} value={String(value)} disabled={disabled}>{label}</FormDropdownItem>)}
  </FormDropdown>;
}

function AmlCalendar({ month, onMonth, range, onRange, asOf }) {
  return <DayPicker mode="range" locale={ko} month={month} onMonthChange={onMonth}
    captionLayout="dropdown" navLayout="around" selected={range} today={asOf} onSelect={onRange}
    showOutsideDays resetOnSelect disabled={{ after: asOf }} endMonth={asOf} aria-label="조회 기간 달력"
    formatters={{ formatYearDropdown: date => `${date.getFullYear()}년` }}
    components={{ Chevron: CalendarChevron, Dropdown: CalendarDropdown }} />;
}

function PeriodPane({ value, asOf, onApply, onResize }) {
  const [preset, setPreset] = useState(() => value.range
    ? presets.find(item => rangeLabel(presetRange(item.value, asOf)) === rangeLabel(value.range))?.value ?? ''
    : '');
  const [draft, setDraft] = useState(value.range);
  const [month, setMonth] = useState(value.range?.from ?? asOf);
  useLayoutEffect(() => { onResize(); }, [month, onResize]);
  const changePreset = next => {
    const range = next ? presetRange(next, asOf) : undefined;
    setPreset(next);
    setDraft(range);
    setMonth(range?.from ?? asOf);
  };
  return <QueryPanel title="조회 기간" invalid={Boolean(draft?.from && !draft.to)}
    onSubmit={() => onApply({ ...value, range: draft })}>
    <div className="query-period-body">
      <QueryChoices label="빠른 기간" className="query-period-presets" options={presets} value={preset} onChange={changePreset} />
      <div className="query-period-calendar" data-complete-range={Boolean(draft?.to) || undefined}>
        <AmlCalendar month={month} onMonth={setMonth} range={draft} asOf={asOf}
          onRange={next => { setPreset(''); setDraft(next); }} />
        <div className="query-period-footer">
          <p className="query-period-selection" aria-live="polite">{draft && rangeLabel(draft)}</p>
          <ActionButton className="query-reset" disabled={!draft} onClick={() => changePreset('')}>기간 초기화</ActionButton>
        </div>
      </div>
    </div>
  </QueryPanel>;
}

const queryPanels = { filter: FilterPane, sort: SortPane, period: PeriodPane };
const firstQueryControl = {
  filter: '.query-filter-group',
  sort: '.query-choice input:checked',
  period: '.query-period-presets input:checked, .query-calendar-select',
  download: '.query-content button:not(:disabled)',
};

export function exportCases(rows, scope) {
  caseCsvDownloadEntry('', scope, rows).download();
}

function caseDetectionDate({ code, date }) {
  if (date instanceof Date && Number.isFinite(date.getTime())) return formatDate(date);
  const stamp = /^[AE]-(\d{6})-\d{6,}$/.exec(code)?.[1];
  if (!stamp) return '';
  const inferred = formatDate(dateFromCode(code));
  return inferred.slice(2).replaceAll('-', '') === stamp ? inferred : '';
}

export function caseCsvDownloadEntry(label, file, rows) {
  return createCsvDownloadEntry(label, file, ['코드', '탐지일', '처리 상태', '담당 범위'], rows.length,
    () => rows.map(row => [row.code, caseDetectionDate(row), reviewStatusLabel(row.status), row.assigned ? '내 담당' : '다른 담당']));
}

export function downloadCsv(file, headers, rows) {
  saveCsv(`aml-${file}.csv`, headers, rows);
  announceExport('CSV 다운로드', `${rows.length}건 다운로드를 요청했습니다.`);
}

export function csvDownloadEntry(label, file, headers, rows) {
  return createCsvDownloadEntry(label, file, headers, rows.length, () => rows);
}

function createCsvDownloadEntry(label, file, headers, count, readRows) {
  return { label, format: 'CSV', count, disabled: !count,
    csv: { filename: `aml-${file}.csv`, headers, get rows() { return readRows(); } },
    download: () => downloadCsv(file, headers, readRows()) };
}

function announceExport(title, description, status = 'done') {
  document.dispatchEvent(new CustomEvent('aml:result', { detail: { title, description, status } }));
}

function DownloadOptions({ entries, onDone }) {
  const formats = Map.groupBy(entries, entry => entry.format);
  return <div className="query-popover-body query-download-options">
      {entries.map(({ format, label, count, download, disabled }) => <ActionButton
        key={`${label}-${format}`} className="query-menu-row" disabled={disabled}
        aria-label={label ? `${format} · ${label}${count ? ` · ${count}건` : ''}` : format} onClick={async () => {
          onDone();
          try {
            await download();
          } catch (error) {
            announceExport('다운로드 실패', error.message, 'failed');
          }
        }}>
        <span>{format}</span>
        {formats.get(format).length > 1 && <span className="query-menu-detail">
          {label}{count ? ` · ${count}건` : ''}
        </span>}
      </ActionButton>)}
    </div>;
}

let nextPopoverId = 0;

export function setupQueryControls({ onChange, workspace, controls, embedded = false, downloadSurface = 'ghost',
  tooltip = document.getElementById('tooltip') }) {
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  const pageDownload = controls.querySelector('#page-download [data-query-tool]');
  const buttons = [...controls.querySelectorAll('[data-query-tool]')];
  const toolbarButtons = buttons.filter(button => button !== pageDownload);
  const queryButtons = toolbarButtons.filter(button => button.matches(queryTriggerSelector));
  const downloadButton = toolbarButtons.find(button => button.dataset.queryTool === 'download');
  if (downloadButton) downloadButton.dataset.buttonSurface = downloadSurface;
  const sortButton = queryButtons.find(button => button.dataset.queryTool === 'sort');
  const popover = document.createElement('div');
  popover.id = `query-tool-popover-${++nextPopoverId}`;
  popover.popover = 'auto';
  popover.className = 'query-tool-popover glass';
  popover.setAttribute('role', 'dialog');
  const triggerRow = document.createElement('div');
  triggerRow.className = 'query-trigger-row';
  const actionHost = document.createElement('div');
  actionHost.className = 'query-actions';
  const popoverLabel = document.createElement('span');
  popoverLabel.className = 'query-popover-label';
  triggerRow.append(popoverLabel, actionHost);
  const actions = { host: actionHost, tooltip };
  const queryContent = document.createElement('div');
  queryContent.className = 'query-content';
  popover.append(triggerRow, queryContent);
  const conditionTags = document.createElement('div');
  conditionTags.className = 'query-condition-tags';

  let root;
  let tagsRoot;
  let focusTags = false;
  let trigger;
  let triggerSlot;
  let triggerOrigin;
  let opening = 0;
  let scope;
  let screen;
  let sortScope;
  let tableTools;
  let localTable = embedded;
  let rows = [];
  let periodAnchor;
  let closingOnClick;
  let resumeTableFocus;
  const queries = new Map();
  const current = () => {
    const value = queries.get(scope) ?? defaultQuery;
    return localTable && value.sort ? { ...value, sort: '' } : value;
  };
  const tableArea = () => embedded ? controls : workspace.querySelector('[data-table-tools]');
  function syncConditions() {
    const table = tableArea();
    const frame = table?.closest('.data-table-frame');
    const host = workspace.querySelector('[data-query-tags]')
      ?? table?.closest('.data-table-heading')?.querySelector('[data-table-query]')
      ?? frame?.querySelector('[data-table-query]');
    if (!host) return;
    if (conditionTags.parentElement !== host) host.prepend(conditionTags);
    const value = current();
    const groups = filterGroups(rows, scope);
    const sort = tableSortFields(frame).find(field => field.direction);
    const filter = tableTools?.filter;
    const range = tableTools?.period?.range;
    const extra = [];
    if (sort) extra.push({ tool: 'sort', label: `정렬 · ${sort.label} · ${sort.direction > 0 ? '오름차순' : '내림차순'}`,
      remove: () => sort.select(0), removableOnly: true });
    if (range && !value.range && embedded) extra.push({ tool: 'period', label: `${formatDate(range.from)} ~ ${formatDate(range.to)}`,
      remove: () => tableTools.period.onChange(undefined) });
    if (filter && filter.value !== 'all') extra.push({
      tool: 'filter', label: `${filter.label}: ${filter.options.find(option => option.value === filter.value)?.label ?? filter.value}`,
      remove: () => filter.onChange('all'),
    });
    const focus = focusTags;
    focusTags = false;
    tagsRoot ??= createRoot(conditionTags);
    const boardSortHost = workspace.querySelector('[data-dashboard-sort-tags]');
    tagsRoot.render(<ActiveFilters value={value} groups={groups} sorts={availableSorts(rows)} boardSortHost={boardSortHost} extra={extra}
      showPeriod={embedded}
      focus={focus} popupId={popover.id}
      onEdit={(tool, origin, group) => open(buttons.find(button => button.dataset.queryTool === tool), { origin, editingGroup: group })}
      onChange={(next, tool) => {
        queries.set(scope, localTable ? { ...next, sort: queries.get(scope)?.sort ?? '' } : next);
        if (tool === 'sort' && boardSortHost) {
          sortButton?.focus({ preventScroll: true });
        } else focusTags = true;
        onChange(tool, current());
      }} />);
  }
  function syncAppliedButtons() {
    const value = current();
    const groups = filterGroups(rows, scope);
    const applied = {
      filter: tableTools?.filter ? tableTools.filter.value !== 'all'
        : groups.some(({ key }) => key === 'assignment' ? value.assignment !== 'all' : value[key].length),
      sort: tableTools?.sort ? tableTools.sort.value !== tableTools.sort.defaultValue : Boolean(value.sort),
      period: Boolean(tableTools?.period?.range ?? value.range),
    };
    for (const button of queryButtons) {
      button.toggleAttribute('data-query-applied', applied[button.dataset.queryTool]);
    }
    // 글자 버튼(화면 도구 줄)에는 적용한 필터 수와 기간을 바로 보여 준다.
    const filterCount = tableTools?.filter ? Number(tableTools.filter.value !== 'all')
      : groups.reduce((sum, { key }) => sum + (key === 'assignment' ? Number(value.assignment !== 'all') : value[key].length), 0);
    const count = controls.querySelector('[data-query-count]');
    if (count) {
      count.textContent = filterCount ? String(filterCount) : '';
      count.hidden = !filterCount;
    }
    const range = tableTools?.period?.range ?? value.range;
    const periodLabel = controls.querySelector('[data-query-tool="period"] [data-query-label]');
    if (periodLabel) periodLabel.textContent = range ? `${formatDate(range.from)} → ${formatDate(range.to)}` : '기간';
    const clearPeriod = controls.querySelector('[data-query-clear="period"]');
    if (clearPeriod) clearPeriod.hidden = !range || periodButtonHidden();
  }
  const periodButtonHidden = () => queryButtons.find(button => button.dataset.queryTool === 'period')?.hidden ?? true;
  // 검색창: Alert·Episode 목록은 조회 조건(q)으로, 보고서처럼 표가 직접 거르는 화면은 그 표의 search 로 보낸다.
  const searchField = controls.querySelector('[data-query-search-field]');
  const searchRoot = searchField && createRoot(searchField);
  if (searchRoot) flushSync(() => searchRoot.render(<SearchField variant="compact" label="목록 검색"
    placeholder={caseSearchPlaceholder} maxLength={searchLimit} data-query-search="" />));
  const searchInput = searchField?.querySelector('[data-query-search]');
  let searchTimer;
  let restoreSearch;
  const searchesCases = () => scope === 'alerts' || scope === 'episodes';
  function syncSearch() {
    if (!searchField) return;
    const tableSearch = tableTools?.search;
    const visible = Boolean(tableSearch || searchesCases() && rows.length);
    if (searchField.hidden === visible) searchField.hidden = !visible;
    if (!visible) return;
    searchInput.placeholder = tableSearch?.placeholder ?? caseSearchPlaceholder;
    searchInput.setAttribute('aria-label', tableSearch?.label ?? '목록 검색');
    if (document.activeElement !== searchInput) searchInput.value = tableSearch?.value ?? current().search ?? '';
  }
  function applySearch() {
    clearTimeout(searchTimer);
    const text = searchInput.value.slice(0, searchLimit);
    if (tableTools?.search) {
      if (text !== tableTools.search.value) tableTools.search.onChange(text);
      return;
    }
    if (!searchesCases() || text === (current().search ?? '')) return;
    // 목록이 다시 그려지며 검색창이 잠시 빠지므로, 다시 붙을 때 입력 자리를 되돌린다.
    restoreSearch = { start: searchInput.selectionStart, end: searchInput.selectionEnd };
    const next = { ...current(), search: text };
    queries.set(scope, localTable ? { ...next, sort: queries.get(scope)?.sort ?? '' } : next);
    onChange('search', current());
  }
  const scheduleSearch = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 250);
  };
  function clearPeriod() {
    if (tableTools?.period?.range) {
      tableTools.period.onChange(undefined);
      return;
    }
    const next = { ...current(), range: undefined };
    queries.set(scope, localTable ? { ...next, sort: queries.get(scope)?.sort ?? '' } : next);
    onChange('period', current());
  }
  function visibleLocalDownloads() {
    return [...workspace.querySelectorAll('[data-local-query-tools]')]
      .filter(element => {
        const anchor = element.matches('[data-page-only-download]') ? element.closest('.data-table-heading, .data-table-frame') ?? element
          : element.querySelector('[data-query-tool="download"]:not([hidden])');
        return anchor?.getClientRects().length > 0;
      })
      .map(element => embeddedDownloads.get(element))
      .filter(Boolean);
  }
  function syncTools(workspaceReady = true) {
    const hasRows = Boolean(scope && rows.length);
    const hasDownloadEntries = tableTools?.entries?.some(entry => !entry.disabled);
    const available = {
      filter: hasRows || Boolean(tableTools?.filter),
      sort: hasRows && !localTable || Boolean(tableTools?.sort),
      period: Boolean(tableTools?.period || scope && (hasRows || periodAnchor)),
      download: tableTools?.panelDownload !== false && (hasRows || hasDownloadEntries),
    };
    for (const button of toolbarButtons) {
      const hidden = !available[button.dataset.queryTool];
      if (button.hidden !== hidden) button.hidden = hidden;
    }
    if (pageDownload) {
      const hidden = !screen || !workspaceReady;
      if (pageDownload.hidden !== hidden) pageDownload.hidden = hidden;
    }
    const hideToolbar = !workspaceReady || buttons.every(button => button.hidden);
    if (controls.hidden !== hideToolbar) controls.hidden = hideToolbar;
    if (resumeTableFocus && !hideToolbar) {
      if (document.activeElement === document.body) {
        resumeTableFocus.focus({ preventScroll: true });
        if (tooltip) hideTooltip(tooltip);
      }
      resumeTableFocus = undefined;
    }
    if (trigger?.hidden && popover.matches(':popover-open')) popover.hidePopover();
    syncAppliedButtons();
    syncSearch();
    syncConditions();
  }
  function position() {
    if (!trigger || !popover.matches(':popover-open')) return;
    const gap = readWorkspaceGap();
    const viewportWidth = document.documentElement.clientWidth;
    const rect = triggerSlot.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) {
      popover.hidePopover();
      return;
    }
    popover.style.removeProperty('--query-expanded-width');
    const width = Math.min(popover.offsetWidth, viewportWidth - gap * 2);
    // 도구 줄 왼쪽 묶음(기간·필터)은 버튼 왼쪽 끝에, 나머지는 오른쪽 끝에 맞춰 연다.
    const alignStart = Boolean(triggerSlot.closest('.query-bar-main'));
    const left = Math.max(gap, Math.min(alignStart ? rect.left : rect.right - width, viewportWidth - gap - width));
    const above = rect.top - gap;
    const below = innerHeight - rect.bottom - gap;
    popover.style.setProperty('--query-expanded-width', `${width}px`);
    const panelHeight = queryContent.scrollHeight + triggerRow.offsetHeight + popover.offsetHeight - popover.clientHeight;
    const openAbove = below < panelHeight && above > below;
    const fitsBeneathOrAbove = panelHeight <= Math.max(above, below);
    const fitViewport = popover.dataset.tool === 'period' && !fitsBeneathOrAbove;
    const maxHeight = Math.max(0, fitViewport ? innerHeight - 2 * gap : openAbove ? above : below);
    const top = rect.bottom + gap;
    popover.style.setProperty('--query-placement-top',
      fitViewport ? `${Math.max(gap, Math.min(top, innerHeight - gap - panelHeight))}px` : openAbove ? 'auto' : `${top}px`);
    popover.style.setProperty('--query-placement-bottom', openAbove && !fitViewport ? `${innerHeight - rect.top + gap}px` : 'auto');
    popover.style.setProperty('--query-placement-max-height', `${maxHeight}px`);
    popover.style.setProperty('--query-placement-left', `${left}px`);
  }
  function resetTrigger(button) {
    button?.setAttribute('aria-expanded', 'false');
  }
  function dismiss() {
    if (popover.matches(':popover-open')) popover.hidePopover();
  }
  function close(returnFocus = triggerOrigin ?? trigger) {
    const version = opening;
    const pressed = trigger;
    if (tooltip) hideTooltip(tooltip);
    dismiss();
    resetTrigger(pressed);
    if (!returnFocus) return;
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (version === opening && !popover.matches(':popover-open') &&
        (focused === document.body || focused?.matches('[data-query-tool]') || popover.contains(focused))) {
        (returnFocus?.isConnected ? returnFocus : pressed)?.focus({ preventScroll: true });
        if (tooltip) hideTooltip(tooltip);
      }
    });
  }
  function apply(next) {
    queries.set(scope, localTable ? { ...next, sort: queries.get(scope)?.sort ?? '' } : next);
    if (localTable) resumeTableFocus = trigger;
    const tool = trigger.dataset.queryTool;
    if (triggerOrigin !== trigger) focusTags = tool;
    close();
    onChange(tool, current());
  }
  function focusOpenPopover() {
    const tool = trigger.dataset.queryTool;
    const focusTarget = popover.querySelector('.query-filter-group[aria-expanded="true"]')
      ?? popover.querySelector(tool === 'filter' && tableTools?.filter ? '.query-choice input:checked' : firstQueryControl[tool]);
    (focusTarget ?? popover).focus({ preventScroll: true });
  }
  function open(button, { origin = button, editingGroup } = {}) {
    if (!button || button.hidden) return;
    if (trigger === button && popover.matches(':popover-open')) return close();
    if (tooltip) hideTooltip(tooltip);
    if (popover.matches(':popover-open')) popover.hidePopover();
    resetTrigger(trigger);
    trigger = button;
    triggerSlot = button.parentElement;
    triggerOrigin = origin;
    const version = ++opening;
    trigger.setAttribute('aria-expanded', 'true');
    const tool = button.dataset.queryTool;
    const isDownload = tool === 'download';
    const isPageDownload = button === pageDownload;
    const label = isPageDownload ? pageDownloadLabel : queryTools[tool];
    popover.dataset.tool = tool;
    popover.setAttribute('aria-label', label);
    triggerSlot.append(popover);
    popoverLabel.textContent = label;
    const value = current();
    const asOf = periodAnchor ?? rows.reduce((latest, row) => row.date > latest ? row.date : latest, new Date(0));
    root ??= createRoot(queryContent);
    const Panel = queryPanels[tool];
    const tableFilter = tool === 'filter' ? tableTools?.filter : undefined;
    const tablePeriod = tool === 'period' ? tableTools?.period : undefined;
    const tableSort = tool === 'sort' ? tableTools?.sort : undefined;
    const content = isDownload
      ? <DownloadOptions entries={isPageDownload ? pageDownloadEntries() : downloadEntries()} onDone={close} />
      : tableFilter ? <TableFilterPane filter={tableFilter} onApply={next => { close(); tableFilter.onChange(next); }} />
      : tableSort ? <SortPane value={{ sort: tableSort.value }} sorts={tableSort.options}
        onApply={({ sort }) => { close(); tableSort.onChange(sort); }} />
      : tablePeriod ? <PeriodPane value={{ range: tablePeriod.range }} asOf={tablePeriod.asOf}
        onApply={next => { close(); tablePeriod.onChange(next.range); }} onResize={position} />
      : <Panel value={value} groups={filterGroups(rows, scope)} sorts={availableSorts(rows)} asOf={asOf}
          onApply={apply} onResize={position} editingGroup={editingGroup} sortScope={sortScope} />;
    flushSync(() => root.render(<QueryActions.Provider value={actions} key={version}>{content}</QueryActions.Provider>));
    if (!popover.matches(':popover-open')) popover.showPopover();
    position();
    if (popover.matches(':popover-open')) focusOpenPopover();
  }
  function pageDownloadEntries() {
    const formats = [{ format: 'PDF로 저장', download: () => printWorkspace(workspace) }];
    const datasets = [...downloadEntries(), ...visibleLocalDownloads().flatMap(instance => instance.downloadEntries())]
      .filter(entry => entry.format === 'CSV' && !entry.disabled);
    if (datasets.length && datasets.every(entry => entry.csv)) {
      formats.push({ format: 'CSV 묶음 (.zip)', download: () => {
        const files = datasets.map(({ csv }) => ({ filename: csv.filename, content: createCsv(csv.headers, csv.rows) }));
        downloadBlob(`aml-${screen.replaceAll('/', '-')}-csv.zip`, createPageCsvZip(files));
        announceExport('CSV 묶음 다운로드', '현재 페이지의 CSV 묶음 다운로드를 요청했습니다.');
      } });
    }
    return formats;
  }

  function downloadEntries() {
    const entries = [...(tableTools?.entries ?? [])];
    if (scope && rows.length) {
      const filtered = visibleCaseRows(rows, current());
      const visible = localTable ? sortSavedTableRows(filtered, scope) : filtered;
      const dataset = scope === 'related-candidates' ? '연관 후보'
        : scope.startsWith('dashboard-') ? 'Alert·Episode' : scope === 'alerts' ? 'Alert' : 'Episode';
      entries.push(caseCsvDownloadEntry(`조회된 ${dataset}`, scope, visible));
      if (visible.length !== rows.length) entries.push(caseCsvDownloadEntry(`전체 ${dataset}`, scope, rows));
    }
    if (!pageDownload && !localTable && hasVisualizations(workspace)) {
      const segment = screen?.replaceAll('/', '-') ?? 'transaction';
      entries.push(...visualizationEntries({
        label: '현재 차트·그래프', filename: `aml-${segment}-visualizations`, readRoot: () => workspace,
      }));
    }
    return entries;
  }
  const queryTooltipDisposers = buttons.map(button => {
    button.setAttribute('aria-controls', popover.id);
    return bindTooltip(button, tooltip, { hover: true });
  });
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      closingOnClick = event.button === 0 && button === trigger && popover.matches(':popover-open') ? button : undefined;
    }, eventOptions);
    button.addEventListener('pointercancel', () => { closingOnClick = undefined; }, eventOptions);
    button.addEventListener('click', event => {
      const toggleClosed = event.detail > 0 && button === closingOnClick;
      closingOnClick = undefined;
      if (toggleClosed) close(button);
      else open(button);
    }, eventOptions);
  }
  // 한글 조합 중에는 거르지 않고, 조합이 끝나거나 잠깐 멈추면 거른다. Enter 는 바로 거른다.
  searchInput?.addEventListener('input', event => { if (!event.isComposing) scheduleSearch(); }, eventOptions);
  searchInput?.addEventListener('compositionend', scheduleSearch, eventOptions);
  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) applySearch();
  }, eventOptions);
  const clearPeriodButton = controls.querySelector('[data-query-clear="period"]');
  clearPeriodButton?.addEventListener('click', clearPeriod, eventOptions);
  if (clearPeriodButton) queryTooltipDisposers.push(bindTooltip(clearPeriodButton, tooltip, { hover: true }));
  popover.tabIndex = -1;
  popover.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close();
  }, eventOptions);
  popover.addEventListener('toggle', () => {
    if (popover.matches(':popover-open')) return;
    resetTrigger(trigger);
    trigger = undefined;
    triggerSlot = undefined;
    triggerOrigin = undefined;
    root?.unmount();
    root = undefined;
  }, eventOptions);
  window.addEventListener('resize', position, eventOptions);
  document.addEventListener('aml:appearance', position, eventOptions);
  window.addEventListener('scroll', position, { ...eventOptions, passive: true, capture: true });
  let checkDownload;
  const watchVisualizations = new MutationObserver(records => {
    if (records.every(record => conditionTags.contains(record.target))) return;
    if (checkDownload) return;
    checkDownload = requestAnimationFrame(() => { checkDownload = 0; syncTools(); });
  });
  const observationRoot = embedded ? workspace.closest('.data-table-frame') : workspace;
  if (observationRoot) watchVisualizations.observe(observationRoot, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-sort', 'hidden', 'data-page-only-download'],
  });
  return {
    dispose() {
      opening++;
      events.abort();
      clearTimeout(searchTimer);
      searchRoot?.unmount();
      watchVisualizations.disconnect();
      cancelAnimationFrame(checkDownload);
      for (const dispose of queryTooltipDisposers) dispose();
      resetTrigger(trigger);
      popover.remove();
      conditionTags.remove();
      queueMicrotask(() => {
        root?.unmount();
        tagsRoot?.unmount();
      });
    },
    hasQuery() { return Boolean(scope); },
    refresh() { syncTools(); },
    downloadEntries,
    registerTableTools(options) {
      tableTools = options;
      downloadButton?.setAttribute('aria-label', options?.downloadLabel ?? queryTools.download);
      syncTools();
      return () => {
        if (tableTools === options) tableTools = undefined;
      };
    },
    unmountTags() {
      tagsRoot?.unmount();
      tagsRoot = undefined;
      conditionTags.remove();
    },
    renderTags() {
      if (!embedded) {
        const row = workspace.querySelector('.screen-query-row');
        if (row && controls.parentElement !== row) row.prepend(controls);
      }
      syncTools();
      if (restoreSearch && searchInput && !searchField.hidden) {
        searchInput.focus({ preventScroll: true });
        searchInput.setSelectionRange(restoreSearch.start, restoreSearch.end);
      }
      restoreSearch = undefined;
    },
    caseRows() {
      return new Map(rows.map(row => [row.code, row]));
    },
    selection() {
      const query = current();
      const visible = visibleCaseRows(rows, query);
      return { rows: visible, population: query.range ? visibleCaseRows(rows, { ...query, range: undefined }) : visible,
        range: query.range, sort: query.sort };
    },
    params(path) {
      const result = new URLSearchParams();
      const scope = queryScope(path);
      const value = queries.get(scope);
      if (value?.sort && !hasLocalTableTools(path)) result.set('sort', value.sort);
      if (value) filterGroups(rows, scope).filter(group => group.name).forEach(({ key, name }) => {
        value[key].forEach(option => result.append(name, option));
      });
      if (allowsAssignment(scope) && value?.assignment === 'assigned') result.set('assignment', 'assigned');
      if (value?.range) {
        result.set('from', formatDate(value.range.from));
        result.set('to', formatDate(value.range.to));
      }
      if (value?.search?.trim()) result.set('q', value.search);
      return result;
    },
    dismiss,
    setScreen(path, codes, data, params) {
      const next = queryScope(path);
      if (path !== screen) {
        resumeTableFocus = undefined;
      }
      dismiss();
      scope = next;
      screen = path;
      sortScope = data?.sortScope;
      localTable = hasLocalTableTools(path);
      tableTools = undefined;
      rows = data?.rows ?? (scope ? caseFixtureRows(codes) : []);
      if (scope && params) {
        const value = parseQuery(params, scope, rows);
        queries.set(scope, localTable ? { ...value, sort: queries.get(scope)?.sort ?? '' } : value);
      }
      periodAnchor = data?.asOf;
      for (const button of queryButtons) button.removeAttribute('data-query-applied');
      syncTools(false);
      return scope && !data?.dashboard ? visibleCaseRows(rows, current()).map(row => row.code) : codes;
    },
  };
}
