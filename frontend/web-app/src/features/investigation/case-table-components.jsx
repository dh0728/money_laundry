import React from 'react';
import { LinkTag } from '../../components/semantic-tags';
import { WorkflowTable } from '../../components/workflow-table';
import './preview-case-list-table.css';

export function CaseDataTable({ title, summary, className = '', tools, selection, children }) {
  return <WorkflowTable label={title} summary={summary} className={`case-table-scroll ${className}`}
    tableClassName="preview-case-table" tools={tools} selection={selection}>
    {children}
  </WorkflowTable>;
}

export function RecordIdCell({ code }) {
  return <th scope="row">
    <LinkTag code={code} />
  </th>;
}
