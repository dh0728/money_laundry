import { icons } from './icons.js';
export { bindTooltip, hideTooltip } from './warm-tooltip-dom.jsx';

export const Icon = (name, variant = '') =>
  `<svg class="icon ${variant}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

// Animated AML RADAR symbol. Shape comes from /aml_radar_symbol_*.svg; color follows currentColor.
export const BrandSymbol = (variant = '') =>
  `<span class="icon aml-radar-symbol ${variant}" aria-hidden="true"></span>`;

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

// 문자열 화면용 Panel(components/panel.jsx와 같은 면: 화면 안으로 들어간 inner glow).
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
