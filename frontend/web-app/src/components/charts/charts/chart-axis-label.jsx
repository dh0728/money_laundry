import React from 'react';

export function ChartAxisGroup({ className, children, ...props }) {
  return <g className={className} {...props}>{children}</g>;
}

export function ChartAxisLabel({ x, y, dy, textAnchor, children }) {
  return <text x={x} y={y} dy={dy} textAnchor={textAnchor}>{children}</text>;
}
