import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { bindTooltip } from './components';
import { ActionButton } from './primary-button';
import './footer-pagination.css';

const integer = new Intl.NumberFormat('ko-KR');

function PaginationButton({ icon: Icon, label, text, disabled, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const button = ref.current;
    const tooltip = button.ownerDocument.getElementById('tooltip');
    if (!tooltip) {
      button.title = label;
      return undefined;
    }
    return bindTooltip(button, tooltip);
  }, [disabled, label]);

  return <ActionButton ref={ref} className={text ? 'footer-pagination-text-button' : 'icon-button'}
    shape={text ? 'corner' : 'circle'} surface={text ? 'ghost' : 'floating'}
    aria-label={label} title={disabled ? label : undefined} disabled={disabled} onClick={onClick}>
    {text ?? <Icon className="icon" aria-hidden="true" />}
  </ActionButton>;
}

/** alwaysShow: 목록처럼 1페이지·0건이어도 이동 컨트롤을 비활성 상태로 보여 준다. */
export function FooterPagination({ host, label, page, pageCount: count, total, onPageChange, unit, children, alwaysShow = false, compact = false }) {
  if (count <= 1 && !alwaysShow) return null;
  const pageCount = Math.max(1, count);
  const lastPage = pageCount - 1;
  const atStart = page <= 0;
  const atEnd = page >= lastPage;
  const pagination = <nav className="footer-pagination" aria-label={label} data-compact={compact || undefined}>
    {!compact && <PaginationButton icon={ChevronsLeft} label="처음으로 가기" disabled={atStart} onClick={() => onPageChange(0)} />}
    <PaginationButton icon={ChevronLeft} label="이전으로 가기" text={compact ? '이전' : undefined}
      disabled={atStart} onClick={() => onPageChange(page - 1)} />
    {children}
    <span className="footer-pagination-status">
      {Number.isFinite(total) && <span>전체 {integer.format(total)}건</span>}
      <span aria-live="polite">{integer.format(page + 1)} / {integer.format(pageCount)} {unit ?? '페이지'}</span>
    </span>
    <PaginationButton icon={ChevronRight} label="다음으로 가기" text={compact ? '다음' : undefined}
      disabled={atEnd} onClick={() => onPageChange(page + 1)} />
    {!compact && <PaginationButton icon={ChevronsRight} label="마지막으로 가기" disabled={atEnd} onClick={() => onPageChange(lastPage)} />}
  </nav>;
  return host ? createPortal(pagination, host) : pagination;
}
