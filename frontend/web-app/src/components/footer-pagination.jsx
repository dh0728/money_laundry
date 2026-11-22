import React from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from './primary-button';
import { CountTag, StatusTag } from './semantic-tags';
import './footer-pagination.css';

const integer = new Intl.NumberFormat('ko-KR');

/** alwaysShow: 목록 화면처럼 1페이지·0건이어도 이전·다음 위치를 비활성 상태로 보여 준다. */
export function FooterPagination({ host, label, page, pageCount: count, total, onPageChange, unit, children, alwaysShow = false }) {
  if (count <= 1 && !alwaysShow) return null;
  const pageCount = Math.max(1, count);
  const pagination = <nav className="footer-pagination" aria-label={label}>
    <ActionButton shape="pill" surface="floating" disabled={page <= 0} aria-label={unit && `이전 ${unit}`}
      onClick={() => onPageChange(page - 1)}>이전</ActionButton>
    {children}
    {Number.isFinite(total) && <CountTag label="전체" count={total} />}
    <span aria-live="polite">
      <StatusTag preset="neutral">{integer.format(page + 1)} / {integer.format(pageCount)} {unit ?? '페이지'}</StatusTag>
    </span>
    <ActionButton shape="pill" surface="floating" disabled={page >= pageCount - 1} aria-label={unit && `다음 ${unit}`}
      onClick={() => onPageChange(page + 1)}>다음</ActionButton>
  </nav>;
  return host ? createPortal(pagination, host) : pagination;
}
