import React from 'react';
import { ActionButton } from './primary-button';
import { WorkflowTable } from './workflow-table';
import './preview-case-list-table.css';

export function CaseDataTable({ title, summary, className = '', tools, selection, children }) {
  return <WorkflowTable label={title} summary={summary} className={`case-table-scroll ${className}`}
    tableClassName="preview-case-table" tools={tools} selection={selection}>
    {children}
  </WorkflowTable>;
}

export function RecordIdCell({ code }) {
  return <th scope="row">
    <ActionButton className="case-table-open" data-work-code={code} aria-label={`${code} 상세 열기`}>
      <code>{code}</code>
    </ActionButton>
  </th>;
}
