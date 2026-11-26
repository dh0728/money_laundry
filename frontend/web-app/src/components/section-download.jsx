import React, { useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { caseCsvDownloadEntry, LocalQueryTools, visualizationEntries } from './query-controls';
import { ActionButton } from './primary-button';
import { printWorkspace } from '../lib/page-export';
import './section-download.css';

export function SectionDownload({ label, entries, host, surface }) {
  return <div className="section-download-tools" ref={host} role="group" aria-label={`${label} 다운로드`}>
    <LocalQueryTools actions={{ entries, downloadLabel: `${label} 다운로드` }} downloadSurface={surface} />
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

export function SectionDownloadHeading({ as: Heading = 'h2', id, className = '', headingClassName, downloadLabel, printLabel, entries = [], readRoot, disclosure, children }) {
  const host = useRef(null);
  const Chevron = disclosure?.expanded ? ChevronDown : ChevronRight;
  const printEntries = printLabel ? [...entries, { label: printLabel, format: 'PDF로 저장',
    download: () => printWorkspace(host.current.closest('#workspace'), host.current.closest('.screen-panel')) }] : entries;
  return <div ref={host} className={`section-download-heading ${className}`.trim()}>
    <Heading id={id} className={headingClassName}>{disclosure ? <ActionButton className="section-heading-disclosure"
      shape="pill" surface="ghost" aria-controls={disclosure.controls} aria-expanded={disclosure.expanded} onClick={disclosure.onToggle}>
      <Chevron className="icon" aria-hidden="true" /><span>{children}</span>
    </ActionButton> : children}</Heading>
    {downloadLabel ? <ChartSectionDownload label={downloadLabel} entries={printEntries} readRoot={readRoot} />
      : printEntries.length > 0 && <SectionDownload label={printLabel ?? printEntries[0].label} entries={printEntries} />}
  </div>;
}

export function boardDownloadEntry(records, label, onDownload) {
  return { label, format: 'CSV', count: records.length, disabled: !records.length, download: () => onDownload(records) };
}

export function BoardSectionDownload({ records, label, file, onDownload }) {
  const entry = file ? caseCsvDownloadEntry(label, file, records) : boardDownloadEntry(records, label, onDownload);
  return <SectionDownload label={label} entries={[entry]} />;
}
