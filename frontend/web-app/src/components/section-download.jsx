import React, { useRef } from 'react';
import { LocalQueryTools, visualizationEntries } from './query-controls';
import './section-download.css';

function SectionDownload({ label, entries, host }) {
  return <div className="section-download-tools" ref={host} role="group" aria-label={`${label} 다운로드`}>
    <LocalQueryTools actions={{ entries }} />
  </div>;
}

export function ChartSectionDownload({ label, filename = label }) {
  const host = useRef(null);
  const entries = visualizationEntries({
    label, filename,
    readRoot: () => host.current.closest('[data-export-visualization], .dashboard-chart'),
  });
  return <SectionDownload label={label} entries={entries} host={host} />;
}

export function BoardSectionDownload({ records, label, onDownload }) {
  const entries = [{
    label, format: 'CSV', count: records.length, disabled: !records.length, download: () => onDownload(records),
  }];
  return <SectionDownload label={label} entries={entries} />;
}
