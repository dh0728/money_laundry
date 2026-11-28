import { icons } from './icons.js';
export { bindTooltip, hideTooltip } from './warm-tooltip-dom.jsx';

export const Icon = (name, variant = '') =>
  `<svg class="icon ${variant}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

// Lucide Radar geometry with the AML RADAR rings and echoes.
export const BrandSymbol = (variant = '') =>
  `<svg class="icon aml-radar-symbol ${variant}" viewBox="0 0 24 24" aria-hidden="true">
    <g class="aml-radar-symbol__sweep">
      <circle class="aml-radar-symbol__outer" cx="12" cy="12" r="10"/>
      <circle class="aml-radar-symbol__inner" cx="12" cy="12" r="6"/>
      <path class="aml-radar-symbol__echo aml-radar-symbol__echo--outer" d="M4 6h.01"/>
      <path class="aml-radar-symbol__echo aml-radar-symbol__echo--inner" d="M12 18h.01"/>
      <circle cx="12" cy="12" r="2"/>
      <path d="m13.41 10.59 5.66-5.66"/>
    </g>
  </svg>`;

export function buttonPresentation({ className = '', shape, surface, type = 'button' } = {}) {
  return {
    type,
    className: `button ${className}`,
    'data-button-shape': shape ?? (className.split(/\s+/).includes('icon-button') ? 'circle' : 'corner'),
    'data-button-surface': surface,
  };
}

export function Button(content, { variant = '', attributes = '', shape, surface = '' } = {}) {
  const { type, className, 'data-button-shape': buttonShape } = buttonPresentation({ className: variant, shape, surface });
  return `<button type="${type}" class="${className}" data-button-shape="${buttonShape}" ${surface ? `data-button-surface="${surface}"` : ''} ${attributes}>${content}</button>`;
}

export const IconButton = (content, label, attributes, variant = '', surface = 'floating', shape = 'circle') =>
  Button(content, { variant: `icon-button ${variant}`, attributes: `aria-label="${label}" ${attributes}`, shape, surface });

function elementHTML(tag, attributes, content) {
  return `<${tag}${attributes ? ` ${attributes}` : ''}>${content}</${tag}>`;
}

// Mount the string components in the imperative workspace without adding a wrapper.
export function HTMLFragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return document.adoptNode(template.content);
}

export const HTMLNode = markup => HTMLFragment(markup).firstElementChild;

/** @param {'div' | 'section' | 'header' | 'footer' | 'main' | 'nav' | 'ul' | 'ol' | 'li' | 'form'} as */
export function BoxHTML(content = '', attributes = '', as = 'div') {
  return elementHTML(as, attributes, content);
}

/** @param {'span' | 'strong' | 'p' | 'code' | 'time' | 'label'} as */
export function TextHTML(content = '', attributes = '', as = 'span') {
  return elementHTML(as, attributes, content);
}

export function HeadingHTML(content = '', attributes = '', level = 2) {
  return elementHTML(`h${Math.min(6, Math.max(1, level))}`, attributes, content);
}

export const InputHTML = attributes => `<input ${attributes}>`;

export const ProfileAvatarHTML = (src, alt) =>
  `<img class="avatar" data-profile-image src="${src}" alt="${alt}" width="32" height="32">`;

export const DecorativeCanvasHTML = attributes => `<canvas ${attributes} aria-hidden="true"></canvas>`;

// 문자열 화면용 Panel(components/panel.jsx와 같은 면: 테두리·안쪽 그림자 없는 평평한 면).
export const PanelHTML = (content, variant = '') =>
  `<section class="screen-panel ${variant}">${content}</section>`;

export const Divider = () => '<hr class="divider">';

export const ScrollArea = (content, attributes = '') =>
  `<div class="scroll-area" ${attributes}>${content}</div>`;

export const Sidebar = (content, attributes) =>
  `<aside class="sidebar glass" ${attributes}>${content}</aside>`;

export const GlassDialog = (content, { id, variant, attributes = '' }) =>
  `<dialog id="${id}" class="glass-dialog ${variant} glass" ${attributes}>${content}</dialog>`;

export const Tooltip = () => '<div id="tooltip" class="warm-tooltip-popover" popover="manual"></div>';
