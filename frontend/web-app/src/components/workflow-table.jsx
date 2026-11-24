import React, { Children, cloneElement, isValidElement, useState } from 'react';
import { Activity, ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpDown, ArrowUpRight, ArrowLeftRight, Banknote, Bell, CalendarDays, CalendarRange,
  CircleGauge, ClipboardCheck, Clock, CreditCard, FileStack, FileText, Fingerprint, Hash, Landmark, Layers,
  ListChecks, Network, Scale, Settings2, Tag, Target, Timer, UserRound, WalletCards } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader } from '@/components/ui/table';
import { ActionButton } from './primary-button';
import SpringCheck from './react-bits/SpringCheck';
import { CountTag } from './semantic-tags';
import './table-frame.css';

const textOrder = new Intl.Collator(['ko', 'en'], { numeric: true, sensitivity: 'base' });
const compareValues = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : textOrder.compare(a, b);
const savedSorts = new Map();
const savedSelections = new Map();
const sortFields = new WeakMap();
const columnIcons = {
  ID: Fingerprint, transaction: ArrowLeftRight, '거래': ArrowLeftRight, '거래 ID': ArrowLeftRight,
  rule: Scale, Alert: Bell, Episode: FileStack, judgment: ClipboardCheck, target: Target, version: Layers,
  account: Landmark, '계좌': Landmark, '상대 계좌': Landmark, '계좌 흐름': Network,
  date: CalendarDays, '거래 기간': CalendarRange, '기간 · KST': CalendarRange, '일자': CalendarDays,
  '거래 시각': Clock, '원본 거래 시각': Clock, '시각': Clock, '경과일': Timer,
  from: ArrowUpRight, '송금 계좌': ArrowUpRight, '송금 은행 · 계좌': ArrowUpRight,
  to: ArrowDownLeft, '수취 계좌': ArrowDownLeft, '수취 은행 · 계좌': ArrowDownLeft, '방향': ArrowLeftRight,
  incoming: WalletCards, outgoing: WalletCards, incomingCount: Hash, outgoingCount: Hash, net: Banknote, amount: Banknote, '금액': Banknote,
  '거래 금액': Banknote, '지급 금액': Banknote, '수취 금액': Banknote, '결제 수단': CreditCard,
  score: CircleGauge, '모델 점수': CircleGauge, '모델 점수·사람 판정': CircleGauge, '조사 신호': Activity,
  owner: UserRound, author: UserRound, '송금 소유주': UserRound, '수취 소유주': UserRound, '담당자': UserRound, '담당': UserRound,
  status: ListChecks, '조사 상태': ListChecks, '처리 상태': ListChecks, '업무 상태': ListChecks,
  verdict: ClipboardCheck, '판정': ClipboardCheck,
  pattern: Network, '패턴': Network, kind: Layers, group: Layers, name: FileText, value: Settings2,
  '거래 건수': Hash, 'Alert 건수': Bell, '거래가 겹치는 Alert 수': Bell,
  '관련 계좌': Landmark, '관련 계좌 수': Landmark, '원본 라벨': Tag,
};

export function TableFieldLabel({ column, children }) {
  const FieldIcon = columnIcons[column] ?? FileText;
  return <span className="table-field-label"><FieldIcon className="icon" aria-hidden="true" />{children}</span>;
}

export function tableSortFields(frame) {
  return Array.from(frame?.querySelectorAll('[data-sort-column]') ?? [], node => sortFields.get(node)).filter(Boolean);
}

export function currencyColumn(readAmounts) {
  return {
    value: row => {
      const amounts = readAmounts(row);
      return Object.keys(amounts).length ? amounts : null;
    },
    groupBy: amounts => Object.keys(amounts).sort().join(' '),
    compare: (a, b) => Object.keys(a).sort().reduce((result, unit) => result || a[unit] - b[unit], 0),
    description: '통화 조합을 묶은 뒤 같은 조합 안에서 통화 코드 순으로 금액을 비교합니다.',
  };
}

function sortRows(rows, active) {
  return active ? rows.toSorted((a, b) => {
    const left = active.value(a);
    const right = active.value(b);
    if (left == null || right == null) return Number(left == null) - Number(right == null);
    const group = active.groupBy ? textOrder.compare(active.groupBy(left), active.groupBy(right)) : 0;
    return group || active.direction * active.compare(left, right);
  }) : rows;
}

export const sortSavedTableRows = (rows, scope) => sortRows(rows, savedSorts.get(scope));

export function useTableSort(rows, scope) {
  const [active, setActive] = useState(() => savedSorts.get(scope) ?? null);
  function select(column, options, direction) {
    const next = direction ? { column, direction, ...options } : null;
    if (scope) {
      if (next) savedSorts.set(scope, next);
      else savedSorts.delete(scope);
    }
    setActive(next);
  }
  return { rows: sortRows(rows, active), active, select };
}

export function SortableTableHead({ sorting, column, value, children, label = children, compare = compareValues,
  groupBy, description, className }) {
  const direction = sorting.active?.column === column ? sorting.active.direction : 0;
  const current = direction === 1 ? 'ascending' : direction === -1 ? 'descending' : undefined;
  const next = direction === 1 ? '내림차순' : direction === -1 ? '기본 순서' : '오름차순';
  const SortIcon = direction === 1 ? ArrowUp : direction === -1 ? ArrowDown : ArrowUpDown;
  const select = direction => sorting.select(column, { value, compare, groupBy }, direction);
  return <TableHead scope="col" className={className} aria-sort={current} data-sort-column={column}
    ref={node => { if (node) sortFields.set(node, { column, label, direction, select }); }}>
    <ActionButton className="table-sort-button" title={description} aria-label={`${label} · ${next} 정렬`}
      onClick={() => select(direction === 1 ? -1 : direction === -1 ? 0 : 1)}>
      <TableFieldLabel column={column}>{children}</TableFieldLabel>
      <SortIcon className="icon table-sort-glyph" aria-hidden="true" />
    </ActionButton>
  </TableHead>;
}

/** 표 제목 옆 개수 태그: 보이는 수 / 전체 수, 선택이 있으면 선택 수 태그를 덧붙인다. */
export function tableCount(count, total = count, unit = '건', selected = 0) {
  return <><CountTag count={count} total={total} unit={unit} />
    {selected > 0 && <CountTag label="선택" count={selected} unit={unit} />}</>;
}

export function useTableSelection(rows, scope, linkedSelection, control) {
  const [selected, setSelected] = useState(() => savedSelections.get(scope) ?? new Set());
  const [overrides, setOverrides] = useState();
  const excluded = overrides?.source === linkedSelection ? overrides?.excluded : undefined;
  const has = code => (control?.selected ?? selected).has(code) || Boolean(linkedSelection?.has(code) && !excluded?.has(code));
  const codes = rows.map(row => row.code);
  const selectedCount = codes.filter(has).length;
  function change(keys, checked) {
    if (control) {
      control.change(keys, checked);
      return;
    }
    const next = new Set(selected);
    for (const code of keys) {
      if (checked) next.add(code);
      else next.delete(code);
    }
    if (scope) savedSelections.set(scope, next);
    setSelected(next);
    if (keys.some(code => linkedSelection?.has(code))) {
      const nextExcluded = new Set(excluded);
      for (const code of keys) {
        if (!linkedSelection.has(code)) continue;
        if (checked) nextExcluded.delete(code);
        else nextExcluded.add(code);
      }
      setOverrides({ source: linkedSelection, excluded: nextExcluded });
    }
  }
  return {
    codes, selectedCount, rowCount: codes.length,
    has,
    toggleRow: (code, checked) => change([code], checked),
    toggleVisible: checked => change(codes, checked),
  };
}

function TableSelectionCheck({ label, checked, mixed, onChange, disabled }) {
  return <SpringCheck className="aml-density-check" label={null} ariaLabel={label} checked={checked} mixed={mixed}
    onChange={onChange} disabled={disabled} color="var(--text)" fillColor="transparent"
    checkColor="var(--text)" strike="none" doneOpacity={1} />;
}

function withSelectionColumn(children, selection) {
  const { codes, rowCount, selectedCount, disabled, has, toggleVisible, toggleRow } = selection;
  const all = rowCount > 0 && selectedCount === rowCount;
  return Children.map(children, section => {
    if (!isValidElement(section)) return section;
    const head = section.type === TableHeader;
    if (!head && section.type !== TableBody) return section;
    return cloneElement(section, {}, Children.map(section.props.children, (row, index) => {
      if (!isValidElement(row)) return row;
      const cells = Children.toArray(row.props.children);
      const code = codes[index];
      if (head) {
        const cell = <TableHead key="selection" scope="col" className="table-selection-cell" aria-label="행 선택">
          <TableSelectionCheck label="표시된 행 전체 선택" checked={all} mixed={!all && selectedCount > 0}
            onChange={toggleVisible} disabled={disabled || rowCount === 0} />
        </TableHead>;
        return cloneElement(row, {}, [cell, ...cells]);
      }
      if (code === undefined && cells.length === 1 && cells[0].props?.colSpan) {
        return cloneElement(row, {}, cloneElement(cells[0], { colSpan: Number(cells[0].props.colSpan) + 1 }));
      }
      const cell = <TableCell key="selection" className="table-selection-cell">
        {code !== undefined && <TableSelectionCheck label={`${code} 선택`} checked={has(code)}
          onChange={checked => toggleRow(code, checked)} disabled={disabled} />}
      </TableCell>;
      return cloneElement(row, {}, [cell, ...cells]);
    }));
  });
}

export function WorkflowQueryHeading({ title, summary, tools = true }) {
  if (!title && !summary && !tools) return null;
  return <header className="data-table-heading">
    {title && <h2>{title}</h2>}
    {summary && <span className="data-table-summary" aria-live="polite" title={typeof summary === 'string' ? summary : undefined}>{summary}</span>}
    <div className="table-query-slot" data-table-query />
    {tools && <div className="data-table-tools" data-table-tools={tools === true ? '' : undefined} hidden={tools === true}>
      {tools === true ? null : tools}
    </div>}
  </header>;
}

export function WorkflowTable({ label, title = label, summary, className = '', tableClassName = 'workflow-data-table',
  tools = true, selection, children }) {
  return <div className="data-table-frame">
    <WorkflowQueryHeading title={title} summary={summary} tools={tools} />
    <div className="data-table-content">
      <div className={`data-table-scroll ${className}`} role="region" aria-label={`${label} 스크롤`} tabIndex={0}>
        <Table className={tableClassName} aria-label={label}>{selection ? withSelectionColumn(children, selection) : children}</Table>
      </div>
    </div>
  </div>;
}
