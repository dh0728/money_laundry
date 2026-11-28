import React from 'react';
import { ChevronDown } from 'lucide-react';
import './panel.css';

// 누르지 않는 패널은 모두 이 Panel로 그린다. 면은 테두리·안쪽 그림자 없는 평평한 면이다(app/layout.css).
// variant="flush"는 안쪽 여백 없이 면만 쓴다(PanelDisclosure). 누르는 카드는 RecordCard를 쓴다.
export function Panel({ as: Tag = 'section', className = '', embedded = false, variant, fillContent = false, ...props }) {
  const materialClass = variant === 'flush' ? 'panel-material panel-inset' : 'screen-panel';
  return <Tag {...props} data-panel-content-fill={fillContent || undefined} className={embedded ? className : `${materialClass} ${className}`.trim()} />;
}

export function PanelDisclosure({ label, children, inset }) {
  return <Panel as="details" variant="flush" className="panel-disclosure" data-disclosure-inset={inset}>
    <summary className="panel-disclosure-trigger">
      <span>{label}</span>
      <ChevronDown className="icon" aria-hidden="true" />
    </summary>
    <div className="panel-disclosure-body">{children}</div>
  </Panel>;
}
