import React, { useRef } from 'react';
import { LocalQueryTools, visualizationEntries } from './query-controls';
import './section-download.css';

function SectionDownload({ label, entries, host }) {
  return <div className="section-download-tools" ref={host} role="group" aria-label={`${label} 다운로드`}>
    <LocalQueryTools actions={{ entries }} />
  </div>;
}

function ChartSectionDownload({ label }) {
  const host = useRef(null);
  const entries = visualizationEntries({
    label, filename: label,
    readRoot: () => host.current.closest('[data-export-visualization], .dashboard-chart'),
  });
  return <SectionDownload label={label} entries={entries} host={host} />;
}

export function SectionDownloadHeading({ as: Heading = 'h2', id, className = '', downloadLabel, children }) {
  return <div className={`section-download-heading ${className}`.trim()}>
    <Heading id={id}>{children}</Heading>
    {downloadLabel && <ChartSectionDownload label={downloadLabel} />}
  </div>;
}

export function BoardSectionDownload({ records, label, onDownload }) {
  const entries = [{
    label, format: 'CSV', count: records.length, disabled: !records.length, download: () => onDownload(records),
  }];
  return <SectionDownload label={label} entries={entries} />;
}
