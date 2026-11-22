import React from 'react';
import { X } from 'lucide-react';
import { ActionButton } from './primary-button';
import './dialog-parts.css';

export function DialogHeader({ title, titleId, titleRef, closeId, closeLabel = '닫기' }) {
  return <header className="dialog-header">
    <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
    <DialogClose id={closeId} label={closeLabel} />
  </header>;
}

export function DialogClose({ id, label = '닫기' }) {
  return <ActionButton id={id} className="icon-button dialog-close" shape="circle" aria-label={label}
    onClick={event => event.currentTarget.closest('dialog').close()}>
    <X className="icon" aria-hidden="true" />
  </ActionButton>;
}

export function DialogFooter({ children }) {
  return <footer className="dialog-actions-fill">{children}</footer>;
}

export function DialogFrame({ title, titleId, titleRef, closeLabel, actions, children, onSubmit, className = '', ...dialogProps }) {
  const Frame = onSubmit ? 'form' : 'div';
  return <dialog {...dialogProps} className={`glass-dialog glass ${className}`.trim()} aria-labelledby={titleId}>
    <Frame className="dialog-frame" onSubmit={onSubmit}>
      <DialogHeader title={title} titleId={titleId} titleRef={titleRef} closeLabel={closeLabel} />
      {children}
      {actions && <DialogFooter>{actions}</DialogFooter>}
    </Frame>
  </dialog>;
}
