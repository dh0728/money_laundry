import React from 'react';
import { ActionButton, WorkTabAddButton } from './primary-button';
import { QueryCheck } from './query-controls';
import './card-header.css';

export function CardHeader({ code, selection, draggableCard, openRecord = true, showAdd = openRecord, className = '', onAction }) {
  return <header className={`card-header ${className}`}>
    {selection && <QueryCheck label={null} ariaLabel={selection.label ?? `${code} 선택`}
      checked={selection.checked} disabled={selection.disabled} onChange={selection.onChange} />}
    {openRecord
      ? <ActionButton className="card-header-main" data-work-code={code} aria-label={`${code} 상세 열기`}
          onClick={onAction ? () => onAction('open', code) : undefined}
          aria-description={draggableCard ? '이 카드를 그래프로 끌어다 놓아 비교에 추가할 수 있습니다.' : undefined}>
          <code>{code}</code>
        </ActionButton>
      : <h3 className="card-header-main"><code>{code}</code></h3>}
    {showAdd && <WorkTabAddButton code={code} onClick={onAction ? () => onAction('add', code) : undefined} />}
  </header>;
}
