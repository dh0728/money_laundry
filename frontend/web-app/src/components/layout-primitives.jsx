import React from 'react';
import './layout-primitives.css';

// 화면 파일은 맨 태그 대신 이 배치·글자 부품을 쓴다(component/raw-element). 간격은 space 토큰 숫자만 받는다.
const space = gap => (gap === undefined ? undefined : `var(--aml-space-${gap})`);
const vars = entries => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

export function Stack({ as: Tag = 'div', direction = 'column', gap = 8, align, justify, wrap = false, className = '', style, ...props }) {
  return <Tag {...props} className={`aml-stack ${className}`.trim()} data-direction={direction} data-wrap={wrap || undefined}
    style={{ ...style, ...vars({ '--stack-gap': space(gap), '--stack-align': align, '--stack-justify': justify }) }} />;
}

export function Grid({ as: Tag = 'div', columns = 2, min, gap = 8, className = '', style, ...props }) {
  const template = min ? `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))` : `repeat(${columns}, minmax(0, 1fr))`;
  return <Tag {...props} className={`aml-grid ${className}`.trim()}
    style={{ ...style, ...vars({ '--grid-columns': template, '--grid-gap': space(gap) }) }} />;
}

export function Text({ as: Tag = 'p', tone = 'default', className = '', ...props }) {
  return <Tag {...props} className={`aml-text ${className}`.trim()} data-tone={tone} />;
}

export function Heading({ level = 2, className = '', ...props }) {
  const Tag = `h${Math.min(6, Math.max(1, level))}`;
  return <Tag {...props} className={`aml-heading ${className}`.trim()} />;
}
