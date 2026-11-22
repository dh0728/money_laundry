import React from 'react';
import { Search } from 'lucide-react';
import './search-field.css';

export function SearchField({ label, variant = 'default', className = '', children, disabled, ...inputProps }) {
  const Field = children ? 'span' : 'label';
  return <Field className={`search-field ${className}`.trim()} data-search-variant={variant} data-disabled={disabled || undefined}>
    <Search className="icon" aria-hidden="true" />
    <input type="search" aria-label={label} disabled={disabled} spellCheck={false} autoComplete="off" {...inputProps} />
    {children}
  </Field>;
}
