import React from 'react';
import { TableRowHead } from '@/components/ui/table';
import { LinkTag } from '../../components/semantic-tags';
import { WorkflowTable } from '../../components/workflow-table';
import './preview-case-list-table.css';

export function CaseDataTable({ title, summary, className = '', tools, selection, compact, children }) {
  return <WorkflowTable label={title} summary={summary} className={`case-table-scroll ${className}`}
    tableClassName="preview-case-table" tools={tools} selection={selection} compact={compact}>
    {children}
  </WorkflowTable>;
}

export function RecordIdCell({ code }) {
  return <TableRowHead>
    <LinkTag code={code} />
  </TableRowHead>;
}
