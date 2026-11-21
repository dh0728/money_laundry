import React from 'react';
import { createPortal } from 'react-dom';
import './screen-actions.css';

export function ScreenActions({ host, stackOnNarrow, children }) {
  const row = <div className="screen-actions" data-stack-on-narrow={stackOnNarrow || undefined}>{children}</div>;
  return host ? createPortal(row, host) : row;
}
