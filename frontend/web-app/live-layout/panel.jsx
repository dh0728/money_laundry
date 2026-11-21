import React from 'react';

export function Panel({ as: Tag = 'section', className = '', embedded = false, ...props }) {
  return <Tag {...props} className={embedded ? className : `screen-panel ${className}`.trim()} />;
}
