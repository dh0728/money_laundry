import React, { useRef } from 'react';
import { LocalQueryTools, visualizationEntries } from './query-controls';
import './section-download.css';

export function SectionDownload({ label, entries, host, surface }) {
  return <div className="section-download-tools" ref={host} role="group" aria-label={`${label} 다운로드`}>
    <LocalQueryTools actions={{ entries }} downloadSurface={surface} />
  </div>;
}

export function ChartSectionDownload({ label, entries = [], readRoot, surface }) {
  const host = useRef(null);
  const visuals = visualizationEntries({
    label, filename: label,
    readRoot: () => readRoot ? readRoot(host.current) : host.current.closest('[data-export-visualization], .dashboard-chart'),
  });
  return <SectionDownload label={label} entries={[...entries, ...visuals]} host={host} surface={surface} />;
}

export function SectionDownloadHeading({ as: Heading = 'h2', id, className = '', headingClassName, downloadLabel, entries = [], readRoot, children }) {
  return <div className={`section-download-heading ${className}`.trim()}>
    <Heading id={id} className={headingClassName}>{children}</Heading>
    {downloadLabel ? <ChartSectionDownload label={downloadLabel} entries={entries} readRoot={readRoot} />
      : entries.length > 0 && <SectionDownload label={entries[0].label} entries={entries} />}
  </div>;
}

export function BoardSectionDownload({ records, label, onDownload }) {
  const entries = [{
    label, format: 'CSV', count: records.length, disabled: !records.length, download: () => onDownload(records),
  }];
  return <SectionDownload label={label} entries={entries} />;
}
