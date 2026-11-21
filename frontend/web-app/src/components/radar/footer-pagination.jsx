import React from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from './primary-button';
import './footer-pagination.css';

const integer = new Intl.NumberFormat('ko-KR');

export function FooterPagination({ host, label, page, pageCount, onPageChange, unit, children }) {
  if (pageCount <= 1) return null;
  const pagination = <nav className="footer-pagination" aria-label={label}>
    <ActionButton shape="pill" surface="floating" disabled={page === 0} aria-label={unit && `이전 ${unit}`}
      onClick={() => onPageChange(page - 1)}>이전</ActionButton>
    {children}
    <span className="footer-pagination__status" aria-live="polite">
      {integer.format(page + 1)} / {integer.format(pageCount)} {unit ?? '페이지'}
    </span>
    <ActionButton shape="pill" surface="floating" disabled={page === pageCount - 1} aria-label={unit && `다음 ${unit}`}
      onClick={() => onPageChange(page + 1)}>다음</ActionButton>
  </nav>;
  return host ? createPortal(pagination, host) : pagination;
}
