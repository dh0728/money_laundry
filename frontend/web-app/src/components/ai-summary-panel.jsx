import React from 'react';
import { Panel } from './panel';
import './ai-summary-panel.css';

export function AISummaryPanel({ children, className = '', reduced = false, ...props }) {
  return <Panel {...props} className={`dashboard-summary-card ai-summary-blob ${className}`.trim()}
    data-blob-static={reduced || undefined}>
    <span className="ai-summary-blob__light" aria-hidden="true" />
    {children}
  </Panel>;
}
