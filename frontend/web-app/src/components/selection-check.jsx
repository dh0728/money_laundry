import React from 'react';
import SpringCheck from './react-bits/SpringCheck';

export function QueryCheck({ label, ariaLabel, checked, mixed, onChange, disabled = false }) {
  return <SpringCheck className="aml-density-check" label={label} ariaLabel={ariaLabel} checked={checked}
    mixed={mixed} onChange={onChange} disabled={disabled} color="var(--text)"
    fillColor="var(--selection-surface)" checkColor="var(--selection-ink)" strike="none" doneOpacity={1} />;
}
