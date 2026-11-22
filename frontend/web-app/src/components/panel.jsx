import React from 'react';
import { ChevronDown } from 'lucide-react';
import './panel.css';

export function Panel({ as: Tag = 'section', className = '', embedded = false, variant, ...props }) {
  const materialClass = variant === 'inset' ? 'panel-material panel-inset' : 'screen-panel';
  return <Tag {...props} className={embedded ? className : `${materialClass} ${className}`.trim()} />;
}

export function PanelDisclosure({ label, children }) {
  return <Panel as="details" variant="inset" className="panel-disclosure">
    <summary className="panel-disclosure-trigger">
      <span>{label}</span>
      <ChevronDown className="icon" aria-hidden="true" />
    </summary>
    <div className="panel-disclosure-body">{children}</div>
  </Panel>;
}
