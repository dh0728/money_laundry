import React from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select';
import './form-dropdown.css';

export { SelectGroup as FormDropdownGroup, SelectItem as FormDropdownItem, SelectLabel as FormDropdownLabel };

export function FormDropdown({ id, label, size, triggerClassName = '', optionsClassName = '', portalContainer, children, ...props }) {
  return <Select {...props}>
    <SelectTrigger id={id} size={size} aria-label={label} className={`form-dropdown-trigger ${triggerClassName}`.trim()}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent className={`form-dropdown-options ${optionsClassName}`.trim()} position="popper" align="start"
      portalContainer={portalContainer}>
      {children}
    </SelectContent>
  </Select>;
}
