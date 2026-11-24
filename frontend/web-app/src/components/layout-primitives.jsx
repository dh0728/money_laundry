import React from 'react';
import './layout-primitives.css';

// 화면 파일은 맨 태그 대신 이 배치·글자 부품을 쓴다(component/raw-element).
// Box·Text·Heading은 className·속성을 그대로 넘겨 같은 DOM을 그린다(겉모습은 화면 CSS가 정한다).
// Stack·Grid는 배치를 부품이 정한다. 간격은 space 토큰 숫자만 받는다.
const space = gap => (gap === undefined ? undefined : `var(--aml-space-${gap})`);
/** @typedef {import('react').AllHTMLAttributes<HTMLElement> & import('react').RefAttributes<any> & { as?: import('react').ElementType } & Record<string, any>} PrimitiveProps */
const vars = entries => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

/** 배치 없는 상자(div·section·ul·li·dl·label 등). @param {PrimitiveProps} props */
export function Box({ as: Tag = 'div', ...props }) {
  return <Tag {...props} />;
}

/** @param {PrimitiveProps} props */
export function Stack({ as: Tag = 'div', direction = 'column', gap = 8, align, justify, wrap = false, className = '', style, ...props }) {
  return <Tag {...props} className={`aml-stack ${className}`.trim()} data-direction={direction} data-wrap={wrap || undefined}
    style={{ ...style, ...vars({ '--stack-gap': space(gap), '--stack-align': align, '--stack-justify': justify }) }} />;
}

/** @param {PrimitiveProps} props */
export function Grid({ as: Tag = 'div', columns = 2, min, gap = 8, className = '', style, ...props }) {
  const template = min ? `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))` : `repeat(${columns}, minmax(0, 1fr))`;
  return <Tag {...props} className={`aml-grid ${className}`.trim()}
    style={{ ...style, ...vars({ '--grid-columns': template, '--grid-gap': space(gap) }) }} />;
}

/** 글자(p·span·strong·code·time 등). tone을 주면 공용 글자색을 쓴다. @param {PrimitiveProps} props */
export function Text({ as: Tag = 'p', tone, className, ...props }) {
  const toned = tone ? `aml-text ${className ?? ''}`.trim() : className;
  return <Tag {...props} className={toned} data-tone={tone} />;
}

/** 제목(h1~h6). @param {PrimitiveProps} props */
export function Heading({ level = 2, ...props }) {
  const Tag = `h${Math.min(6, Math.max(1, level))}`;
  return <Tag {...props} />;
}
