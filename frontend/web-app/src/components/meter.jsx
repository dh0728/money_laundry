import React from 'react';
import { Skeleton } from './ui/skeleton';
import './meter.css';

export function Meter({ className = '', loading = false, ...props }) {
  const classes = `meter ${className}`.trim();
  return loading ? <Skeleton className={classes} /> : <meter {...props} className={classes} />;
}
