import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fixtureReviewStatus, fixtureVerdict } from '../mocks/verdict-fixtures';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DayPicker } from 'react-day-picker';
import { ko } from 'react-day-picker/locale';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { downloadCsv as saveCsv } from '@/lib/report-io';
import { Icon, IconButton, bindTooltip, hideTooltip } from './components.js';
import { ActionButton } from './primary-button';
import { FilterTag, reviewStates, reviewStatusLabel, VerdictTag, verdictLabels } from './semantic-tags';
import { modelRiskBand, modelRiskLabels } from '../features/settings/model-risk-settings';
import { downloadVisualizations, hasVisualizations } from '../lib/preview-visual-export.js';
import JellyRadio from './react-bits/JellyRadio';
import { QueryCheck } from './selection-check';
import { readWorkspaceGap } from '../features/dashboard/workspace-metrics.js';
import { sortSavedTableRows, tableSortFields } from './workflow-table';
import 'react-day-picker/style.css';
import './query-controls.css';

const statuses = reviewStates.map(({ value }) => value);
const scopeOptions = [{ value: 'all', label: '전체' }, { value: 'assigned', label: '내 담당' }];
const elapsedOptions = [
  { value: 'under-three', label: '3일 미만' }, { value: 'three-to-six', label: '3~6일' }, { value: 'week', label: '7일 이상' },
];
const defaultQuery = { sort: '', risks: [], patterns: [], elapsed: [], statuses: [], verdicts: [], assignment: 'all', range: undefined };
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

export function QueryToolbar() {
  const buttons = Object.entries(queryTools).map(([tool, label]) => `<div class="query-control">
    ${queryToolButton(tool, label, 'ghost')}
  </div>`).join('');
  return `<div class="context-query-tools" role="group" aria-label="조회 도구" hidden>${buttons}</div>`;
}

export function PageDownloadControl() {
  return `<div id="page-download" class="query-control">${queryToolButton('download', pageDownloadLabel, 'floating')}</div>`;
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
  return <div ref={host} data-local-query-tools="" dangerouslySetInnerHTML={embeddedToolbar} />;
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

function ActiveFilters({ value, groups, sorts, boardSortHost, onChange, onEdit, popupId, focus, extra = [] }) {
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
  if (value.range) chips.push({
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

function SortPane({ value, sorts, onApply }) {
  const [sort, setSort] = useState(value.sort);
  return <QueryPanel title="정렬 기준" onSubmit={() => onApply({ ...value, sort })}>
    <div className="query-popover-body">
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

function AmlCalendar({ month, onMonth, range, onRange, asOf }) {
  return <DayPicker mode="range" locale={ko} month={month} onMonthChange={onMonth}
    captionLayout="dropdown" navLayout="around" selected={range} today={asOf} onSelect={onRange}
    showOutsideDays resetOnSelect disabled={{ after: asOf }} endMonth={asOf} aria-label="조회 기간 달력"
    formatters={{ formatYearDropdown: date => `${date.getFullYear()}년` }}
    components={{ Chevron: CalendarChevron }} />;
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
  period: '.query-period-presets input:checked, .rdp-dropdown',
  download: '.query-content button:not(:disabled)',
};

export function exportCases(rows, scope) {
  downloadCsv(scope, ['코드', '탐지일', '처리 상태', '담당 범위'], rows.map(row =>
    [row.code, formatDate(row.date), reviewStatusLabel(row.status), row.assigned ? '내 담당' : '다른 담당']));
}

export function downloadCsv(file, headers, rows) {
  saveCsv(`aml-${file}.csv`, headers, rows);
  announceExport('CSV 다운로드', `${rows.length}건 다운로드를 요청했습니다.`);
}

export function csvDownloadEntry(label, file, headers, rows) {
  return { label, format: 'CSV', count: rows.length, disabled: !rows.length,
    download: () => downloadCsv(file, headers, rows) };
}

function announceExport(title, description, status = 'done') {
  document.dispatchEvent(new CustomEvent('aml:result', { detail: { title, description, status } }));
}

function DownloadOptions({ entries, onDone, showLabels = false }) {
  const formats = Map.groupBy(entries, entry => entry.format);
  return <div className="query-popover-body query-download-options">
      {entries.map(({ format, label, count, download, disabled }) => <ActionButton
        key={`${label}-${format}`} className="query-menu-row" disabled={disabled}
        aria-label={`${format} · ${label}${count ? ` · ${count}건` : ''}`} onClick={async () => {
          onDone();
          try {
            await download();
          } catch (error) {
            announceExport('다운로드 실패', error.message, 'failed');
          }
        }}>
        <span>{format}</span>
        {(showLabels || formats.get(format).length > 1) && <span className="query-menu-detail">
          {label}{count ? ` · ${count}건` : ''}
        </span>}
      </ActionButton>)}
    </div>;
}

let nextPopoverId = 0;

export function setupQueryControls({ onChange, workspace, controls, embedded = false, pageDownload, downloadSurface = 'ghost',
  tooltip = document.getElementById('tooltip') }) {
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  const toolbarButtons = [...controls.querySelectorAll('[data-query-tool]')];
  const buttons = pageDownload ? [...toolbarButtons, pageDownload] : toolbarButtons;
  const queryButtons = toolbarButtons.filter(button => button.matches(queryTriggerSelector));
  const downloadButton = toolbarButtons.find(button => button.dataset.queryTool === 'download');
  if (downloadButton) downloadButton.dataset.buttonSurface = downloadSurface;
  const sortControl = toolbarButtons.find(button => button.dataset.queryTool === 'sort')?.parentElement;
  const sortSibling = sortControl?.nextElementSibling;
  const toolbarHome = controls.parentElement;
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
  const tableFrame = () => controls.closest('.data-table-frame');
  function syncConditions() {
    const host = controls.closest('.data-table-heading')?.querySelector('[data-table-query]')
      ?? tableFrame()?.querySelector('[data-table-query]') ?? workspace.querySelector('[data-query-tags]');
    if (!host) return;
    if (conditionTags.parentElement !== host) host.prepend(conditionTags);
    const value = current();
    const groups = filterGroups(rows, scope);
    const sort = tableSortFields(tableFrame()).find(field => field.direction);
    const filter = tableTools?.filter;
    const range = tableTools?.period?.range;
    const extra = [];
    if (sort) extra.push({ tool: 'sort', label: `정렬 · ${sort.label} · ${sort.direction > 0 ? '오름차순' : '내림차순'}`,
      remove: () => sort.select(0), removableOnly: true });
    if (range && !value.range) extra.push({ tool: 'period', label: `${formatDate(range.from)} ~ ${formatDate(range.to)}`,
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
      focus={focus} popupId={popover.id}
      onEdit={(tool, origin, group) => open(buttons.find(button => button.dataset.queryTool === tool), { origin, editingGroup: group })}
      onChange={(next, tool) => {
        queries.set(scope, localTable ? { ...next, sort: queries.get(scope)?.sort ?? '' } : next);
        if (tool === 'sort' && boardSortHost) {
          sortControl?.querySelector('[data-query-tool="sort"]')?.focus({ preventScroll: true });
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
      sort: Boolean(value.sort),
      period: Boolean(tableTools?.period?.range ?? value.range),
    };
    for (const button of queryButtons) {
      button.toggleAttribute('data-query-applied', applied[button.dataset.queryTool]);
    }
  }
  function moveToolbar(target) {
    const previous = controls.parentElement;
    if (previous === target) return;
    if (previous?.matches('[data-table-tools]')) previous.hidden = true;
    target.append(controls);
  }
  function visibleLocalDownloads() {
    return [...workspace.querySelectorAll('[data-local-query-tools] [data-query-tool="download"]:not([hidden])')]
      .filter(button => button.getClientRects().length > 0)
      .map(button => embeddedDownloads.get(button.closest('[data-local-query-tools]')))
      .filter(Boolean);
  }
  function syncTools(hasVisibleVisuals = !localTable && hasVisualizations(workspace), workspaceReady = true) {
    const hasRows = Boolean(scope && rows.length);
    const tableSlot = embedded ? toolbarHome : localTable && workspaceReady
      ? workspace.querySelector('[data-table-tools]') : null;
    const screenSlot = !localTable && workspaceReady ? workspace.querySelector('[data-screen-query-tools]') : null;
    const target = tableSlot ?? screenSlot;
    const dashboardSort = workspaceReady && scope?.startsWith('dashboard-') && workspace.querySelector('[data-dashboard-sort]');
    const sortHost = dashboardSort || controls;
    if (sortControl && sortControl.parentElement !== sortHost) {
      sortHost.insertBefore(sortControl, dashboardSort ? null : sortSibling);
    }
    const hasDownloadEntries = tableTools?.entries?.some(entry => !entry.disabled);
    const available = {
      filter: hasRows || Boolean(tableTools?.filter),
      sort: hasRows && !localTable,
      period: Boolean(tableTools?.period || scope && (hasRows || periodAnchor)),
      download: (hasRows || hasDownloadEntries) && (embedded || localTable || !pageDownload),
    };
    for (const button of toolbarButtons) {
      const hidden = !available[button.dataset.queryTool];
      if (button.hidden !== hidden) button.hidden = hidden;
    }
    if (pageDownload) {
      const hidden = !screen || !(hasRows || hasDownloadEntries || hasVisibleVisuals || workspaceReady && visibleLocalDownloads().length);
      if (pageDownload.hidden !== hidden) pageDownload.hidden = hidden;
    }
    const hideToolbar = !target || toolbarButtons.every(button => button.hidden || !controls.contains(button));
    if (controls.hidden !== hideToolbar) controls.hidden = hideToolbar;
    if (tableSlot && tableSlot.hidden !== hideToolbar) tableSlot.hidden = hideToolbar;
    moveToolbar(target ?? toolbarHome);
    if (resumeTableFocus && tableSlot && !hideToolbar) {
      if (document.activeElement === document.body) {
        resumeTableFocus.focus({ preventScroll: true });
        if (tooltip) hideTooltip(tooltip);
      }
      resumeTableFocus = undefined;
    }
    if (trigger?.hidden && popover.matches(':popover-open')) popover.hidePopover();
    syncAppliedButtons();
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
    const left = Math.max(gap, Math.min(rect.right - width, viewportWidth - gap - width));
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
    const content = isDownload
      ? <DownloadOptions entries={downloadEntries(isPageDownload)} onDone={close} showLabels={isPageDownload} />
      : tableFilter ? <TableFilterPane filter={tableFilter} onApply={next => { close(); tableFilter.onChange(next); }} />
      : tablePeriod ? <PeriodPane value={{ range: tablePeriod.range }} asOf={tablePeriod.asOf}
        onApply={next => { close(); tablePeriod.onChange(next.range); }} onResize={position} />
      : <Panel value={value} groups={filterGroups(rows, scope)} sorts={availableSorts(rows)} asOf={asOf}
          onApply={apply} onResize={position} editingGroup={editingGroup} />;
    flushSync(() => root.render(<QueryActions.Provider value={actions} key={version}>{content}</QueryActions.Provider>));
    if (!popover.matches(':popover-open')) popover.showPopover();
    position();
    if (popover.matches(':popover-open')) focusOpenPopover();
  }
  function downloadEntries(page = false) {
    const entries = [...(tableTools?.entries ?? [])];
    if (scope && rows.length) {
      const filtered = visibleCaseRows(rows, current());
      const visible = localTable ? sortSavedTableRows(filtered, scope) : filtered;
      const dataset = scope === 'related-candidates' ? '연관 후보'
        : scope.startsWith('dashboard-') ? 'Alert·Episode' : scope === 'alerts' ? 'Alert' : 'Episode';
      entries.push({ label: `조회된 ${dataset}`, format: 'CSV', count: visible.length, disabled: !visible.length,
        download: () => exportCases(visible, scope) });
      if (visible.length !== rows.length) entries.push({ label: `전체 ${dataset}`, format: 'CSV', count: rows.length,
        download: () => exportCases(rows, scope) });
    }
    if (page) {
      const localEntries = visibleLocalDownloads().flatMap(instance => instance.downloadEntries())
        .filter(entry => entry.format !== 'PNG' && entry.format !== 'SVG');
      for (const entry of localEntries) {
        if (!entries.some(existing => existing.label === entry.label && existing.format === entry.format)) entries.push(entry);
      }
    }
    if ((page || !pageDownload && !localTable) && hasVisualizations(workspace)) {
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
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-sort', 'hidden'],
  });
  return {
    dispose() {
      opening++;
      events.abort();
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
    renderTags(host) {
      if (!scope || !host) return;
      syncTools();
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
      return result;
    },
    dismiss,
    setScreen(path, codes, data, params) {
      const next = queryScope(path);
      if (path !== screen) {
        resumeTableFocus = undefined;
      }
      dismiss();
      moveToolbar(toolbarHome);
      scope = next;
      screen = path;
      localTable = hasLocalTableTools(path);
      tableTools = undefined;
      rows = data?.rows ?? (scope ? caseFixtureRows(codes) : []);
      if (scope && params) {
        const value = parseQuery(params, scope, rows);
        queries.set(scope, localTable ? { ...value, sort: queries.get(scope)?.sort ?? '' } : value);
      }
      periodAnchor = data?.asOf;
      for (const button of queryButtons) button.removeAttribute('data-query-applied');
      syncTools(false, false);
      return scope && !data?.dashboard ? visibleCaseRows(rows, current()).map(row => row.code) : codes;
    },
  };
}
