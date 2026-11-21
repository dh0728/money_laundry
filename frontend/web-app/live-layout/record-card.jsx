import React from 'react';
import './record-card.css';

export function recordCardSurface(verdict, interactive = false) {
  return { 'data-glow-surface': '', 'data-verdict': verdict, 'data-card-interactive': interactive ? '' : undefined };
}

export function activateRecordCard(event, activate) {
  const { target, currentTarget } = event;
  if (event.defaultPrevented || event.button !== 0 ||
      target.closest('button, input, a, label, select, textarea, [role="button"], [role="checkbox"], [contenteditable="true"]')) return;
  const selection = currentTarget.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed && selection.containsNode(currentTarget, true)) return;
  activate();
}

function openRecordCard(event) {
  const button = event.currentTarget.querySelector('.card-header-main[data-work-code]');
  if (button) activateRecordCard(event, () => button.click());
}

export function RecordCard({ label, className, verdict, selected, opensRecord = false, drag, children }) {
  return <article className={className} aria-label={label} {...recordCardSurface(verdict, opensRecord)}
    data-selected={selected || undefined} onClick={opensRecord ? openRecordCard : undefined}
    draggable={drag ? true : undefined} onDragStart={drag?.onDragStart} onDragEnd={drag?.onDragEnd}>
    {children}
  </article>;
}
