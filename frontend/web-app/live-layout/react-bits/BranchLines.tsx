import React from 'react';
import './BranchedMenu.css';

interface BranchLinesProps {
  rows: number[];
  width: number;
  height: number;
  trunk: number;
  end: number;
  radius: number;
  activeIndex: number;
}

export function BranchLines({ rows, width, height, trunk, end, radius, activeIndex }: BranchLinesProps) {
  if (!rows.length) return null;
  const turn = Math.min(radius, rows[0], end - trunk);
  const curve = (y: number) => `A ${turn} ${turn} 0 0 0 ${trunk + turn} ${y} H ${end}`;
  return (
    <svg className="branched-menu__lines" width={width} height={height} aria-hidden="true">
      <path className="branched-menu__base" d={`M ${trunk} 0 V ${rows[rows.length - 1] - turn}`} />
      {rows.map((y, index) => (
        <path key={index} className="branched-menu__base" d={`M ${trunk} ${y - turn} ${curve(y)}`} />
      ))}
      {rows.map((y, index) => {
        const length = y - turn + (Math.PI * turn) / 2 + (end - trunk - turn);
        return <path key={index} className="branched-menu__reach" d={`M ${trunk} 0 V ${y - turn} ${curve(y)}`}
          style={{ strokeDasharray: length, strokeDashoffset: index === activeIndex ? 0 : length }} />;
      })}
    </svg>
  );
}
