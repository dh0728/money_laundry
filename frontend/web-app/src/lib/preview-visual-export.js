import { createExportCanvas } from '../components/export-canvas';
import { downloadFile } from '../components/file-download';
import { caseShapePath } from '../features/graph/graph-case-groups';

const svgNamespace = 'http://www.w3.org/2000/svg';
const graphSnapshots = new WeakMap();

export function registerGraphSnapshot(container, capture) {
  graphSnapshots.set(container, capture);
  return () => graphSnapshots.delete(container);
}

const visualSelector = [
  '.dashboard-chart', '.dashboard-metric:has(.dashboard-metric-trend)',
  '.overview-evidence-bars', '.preview-evidence-canvas', '.risk-dial',
  '.ledger-transaction-list .animated-list__item[aria-selected="true"] .ledger-transaction',
  '[data-export-visualization]',
].join(', ');
const omitted = [
  'button', 'input', '.icon', '.visually-hidden', '.screen-title-accessible', '.sr-only',
  '[role="tooltip"]',
].join(', ');
const presentationAttributes = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'display', 'visibility', 'color', 'paint-order', 'vector-effect',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor',
  'dominant-baseline', 'stop-color', 'stop-opacity', 'marker-start',
  'marker-mid', 'marker-end', 'clip-path', 'mask', 'overflow',
];

function svg(tag, attributes = {}) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export function makeGraphSnapshot({ width, height, nodes, edges, markers = [] }) {
  const drawing = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
  const textStyle = { 'font-family': 'Pretendard', 'font-size': 11, 'text-anchor': 'middle' };
  const label = (text, attributes) => {
    const element = svg('text', { ...textStyle, ...attributes });
    element.textContent = text;
    return element;
  };
  for (const { path, stroke, width: thickness, text, x, y, textColor = stroke } of edges) {
    drawing.append(svg('path', { d: path, fill: 'none', stroke, 'stroke-width': thickness, 'stroke-linecap': 'round' }));
    if (text) drawing.append(label(text, { x, y: y - 4, fill: textColor }));
  }
  for (const { x, y, r, shape, fill, stroke, strokeWidth, opacity } of markers) {
    drawing.append(svg('path', { d: caseShapePath(shape, x, y, r), fill, opacity,
      ...(stroke ? { stroke, 'stroke-width': strokeWidth, 'stroke-linejoin': 'round' } : {}) }));
  }
  for (const { x, y, r, fill, stroke, text, textColor, ring, badge, badgeFill, badgeInk, badgeHeight } of nodes) {
    drawing.append(svg('circle', { cx: x, cy: y, r, fill, ...(stroke ? { stroke, 'stroke-width': 2 } : {}) }));
    if (ring) {
      const reach = r + 3;
      const circumference = 2 * Math.PI * reach;
      ring.forEach((color, index) => drawing.append(svg('circle', { cx: x, cy: y, r: reach, fill: 'none', stroke: color,
        'stroke-width': 3, 'stroke-dasharray': `${circumference / ring.length} ${circumference}`,
        'stroke-dashoffset': -index * circumference / ring.length, transform: `rotate(-90 ${x} ${y})` })));
    }
    if (badge) {
      const left = x + r + 1;
      const top = y - r - badgeHeight - 1;
      drawing.append(svg('rect', { x: left, y: top, width: badge.length * 8 + 6, height: badgeHeight, rx: badgeHeight / 2, fill: badgeFill }));
      drawing.append(label(badge, { x: left + 5, y: top + badgeHeight - 3, fill: badgeInk, 'text-anchor': 'start', 'font-size': 10 }));
    }
    if (text) drawing.append(label(text, { x, y: y + r + 4, fill: textColor, 'dominant-baseline': 'hanging' }));
  }
  return drawing;
}

function covered(root, element) {
  const excluded = element.closest(omitted);
  return excluded && root.contains(excluded);
}

function hasBox(element) {
  const { width, height } = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return width > 1 && height > 1 && style.visibility === 'visible' && Number(style.opacity) > 0;
}

function visualizations(root) {
  if (!root) return [];
  const matches = root.matches?.(visualSelector) ? [root] : root.querySelectorAll(visualSelector);
  const candidates = [...matches].filter(panel => {
    if (!hasBox(panel)) return false;
    const canvas = panel.querySelector('canvas');
    return (canvas && graphSnapshots.has(panel) && hasBox(canvas))
      || [...panel.querySelectorAll('svg')]
        .some(element => !covered(panel, element) && hasBox(element));
  });
  return candidates.filter(panel => !candidates.some(other => other !== panel && other.contains(panel)));
}

export function hasVisualizations(root = document) {
  return visualizations(root).length !== 0;
}

function localReferences(value) {
  return value.replace(/url\(["']?[^)]*?(#[^"')]+)["']?\)/g, 'url($1)');
}

export function copySVG(source) {
  const copy = source.cloneNode(true);
  const descendants = copy.querySelectorAll('*');
  for (const [index, element] of [source, ...source.querySelectorAll('*')].entries()) {
    const target = index === 0 ? copy : descendants[index - 1];
    const style = getComputedStyle(element);
    for (const property of presentationAttributes) {
      const value = style.getPropertyValue(property);
      if (!value) continue;
      // Resolve theme variables into portable SVG attributes. A cloned inline
      // value could otherwise override the resolved value in the exported file.
      target.setAttribute(property, localReferences(value));
      target.style.removeProperty(property);
    }
    if (!target.style.length) target.removeAttribute('style');
    if (element.hasAttribute('data-svg-width-from-layout')) target.setAttribute('width', String(element.getBBox().width));
  }
  copy.querySelectorAll('[data-graph-transient]').forEach(element => element.remove());
  copy.querySelectorAll('[data-graph-reveal]').forEach(element => {
    element.removeAttribute('mask');
    element.style.removeProperty('mask');
  });
  return copy;
}

function placeSVG(layer, source, bounds, visual = copySVG(source)) {
  const { x, y, width, height } = source.getBoundingClientRect();
  for (const [name, value] of Object.entries({ x: x - bounds.x, y: y - bounds.y, width, height })) {
    visual.setAttribute(name, String(value));
    visual.style.removeProperty(name);
  }
  visual.style.removeProperty('transform');
  visual.style.removeProperty('position');
  visual.style.removeProperty('overflow');
  visual.setAttribute('overflow', 'visible');
  if (!visual.style.length) visual.removeAttribute('style');
  layer.append(visual);
}

function opaquePaint(paint) {
  return paint && paint !== 'transparent' && !/^(?:rgba\(|color\().*(?:,|\/)\s*0\)$/.test(paint);
}

function paintBox(layer, element, bounds, scale = 1) {
  if (!hasBox(element)) return;
  const { x, y, width, height } = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const strokeWidth = parseFloat(style.borderTopWidth) * scale;
  if (!opaquePaint(style.backgroundColor) && !strokeWidth) return;
  layer.append(svg('rect', {
    x: x - bounds.x + strokeWidth / 2, y: y - bounds.y + strokeWidth / 2,
    width: Math.max(0, width - strokeWidth), height: Math.max(0, height - strokeWidth),
    rx: Math.min(parseFloat(style.borderTopLeftRadius) * scale || 0, width / 2, height / 2),
    fill: opaquePaint(style.backgroundColor) ? style.backgroundColor : 'none',
    stroke: strokeWidth ? style.borderTopColor : 'none', 'stroke-width': strokeWidth,
  }));
}

function paintText(layer, root, bounds, textMeasure) {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const value = node.data.trim();
    if (!value || parent.closest('svg') || covered(root, parent)) continue;
    const style = getComputedStyle(parent);
    if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    const start = node.data.length - node.data.trimStart().length;
    range.setStart(node, start);
    range.setEnd(node, start + value.length);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    const draw = (value, left, right, top, height) => {
      if (!value.trim()) return;
      let y = top - bounds.y;
      if (textMeasure) {
        textMeasure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = textMeasure.measureText(value);
        // Native SVG previews may ignore text-before-edge. Use the browser's
        // laid-out font box to encode a regular alphabetic baseline in the file.
        y += Number.isFinite(ascent + descent) ? ascent + (height - ascent - descent) / 2 : height * .8;
      }
      const text = svg('text', {
        x: left - bounds.x, y,
        ...(textMeasure ? {} : { 'dominant-baseline': 'text-before-edge' }),
        fill: style.color, 'font-family': style.fontFamily,
        'font-size': parseFloat(style.fontSize),
        'font-weight': style.fontWeight, textLength: right - left, lengthAdjust: 'spacingAndGlyphs',
      });
      text.textContent = value.trim();
      layer.append(text);
    };
    if (rects.length === 1) {
      const { left, right, top, height } = rects[0];
      draw(value, left, right, top, height);
    } else if (rects.length > 1) {
      // A Range follows CSS wrapping without needing to copy the HTML layout.
      let offset = start;
      const lines = new Map();
      for (const character of value) {
        range.setStart(node, offset);
        offset += character.length;
        range.setEnd(node, offset);
        const { left, right, top, width, height } = range.getBoundingClientRect();
        if (!width) continue;
        const line = lines.get(top) ?? { value: '', left, right, height };
        line.value += character;
        line.left = Math.min(line.left, left);
        line.right = Math.max(line.right, right);
        lines.set(top, line);
      }
      lines.forEach(({ value, left, right, height }, top) => draw(value, left, right, top, height));
    }
  }
}

function paintVisual(layer, panel, bounds, textMeasure) {
  if (panel.matches('.preview-evidence-canvas')) {
    const snapshot = graphSnapshots.get(panel)?.();
    if (snapshot) layer.append(snapshot);
    return;
  }
  paintBox(layer, panel, bounds);
  for (const element of panel.querySelectorAll('i, .semantic-tag, .ledger-party, .risk-dial-thumb')) {
    if (!covered(panel, element)) paintBox(layer, element, bounds);
  }
  for (const chart of panel.querySelectorAll('svg')) {
    // Nested SVGs are already contained in the copied outer drawing.
    if (!chart.parentElement.closest('svg') && !covered(panel, chart) && hasBox(chart)) {
      placeSVG(layer, chart, bounds);
    }
  }
  paintText(layer, panel, bounds, textMeasure);
}

function makeSVG(panels, format) {
  const textMeasure = format === 'svg' ? createExportCanvas(1, 1).context : null;
  const surfaces = panels.map(panel => ({ panel, bounds: panel.getBoundingClientRect() }));
  const theme = getComputedStyle(document.documentElement);
  const spacing = parseFloat(theme.getPropertyValue('--aml-space-16')) || 16;
  const titleHeight = 26;
  const width = Math.ceil(Math.max(...surfaces.map(({ bounds }) => bounds.width)) + spacing * 2);
  const height = Math.ceil(spacing + surfaces.reduce((total, { panel, bounds }) =>
    total + bounds.height + spacing + (panel.matches('.preview-evidence-canvas') ? titleHeight : 0), 0));
  const graphic = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  graphic.append(svg('rect', { width, height, fill: theme.backgroundColor }));
  let y = spacing;
  surfaces.forEach(({ panel, bounds }, index) => {
    const label = panel.getAttribute('aria-label') || panel.querySelector('h2, h3, figcaption')?.textContent;
    if (panel.matches('.preview-evidence-canvas') && label) {
      const title = svg('text', { x: spacing, y: y + 15, fill: getComputedStyle(panel).color,
        'font-family': theme.fontFamily, 'font-weight': 600, 'font-size': 15 });
      title.textContent = label;
      graphic.append(title);
      y += titleHeight;
    }
    const layer = svg('svg', { x: spacing, y, width: bounds.width, height: bounds.height, overflow: 'hidden' });
    layer.setAttribute('aria-label', label || `시각화 ${index + 1}`);
    paintVisual(layer, panel, bounds, textMeasure);
    graphic.append(layer);
    y += bounds.height + spacing;
  });
  const data = new XMLSerializer().serializeToString(graphic);
  return { image: new Blob([data], { type: 'image/svg+xml;charset=utf-8' }), width, height };
}

async function toPNG({ image, width, height }) {
  const url = URL.createObjectURL(image);
  try {
    const illustration = new Image();
    illustration.src = url;
    await illustration.decode();
    const scale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(8_000_000 / (width * height)));
    const surface = createExportCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    if (!surface.context) throw new Error('PNG 파일을 만들 수 없습니다.');
    surface.context.drawImage(illustration, 0, 0, surface.width, surface.height);
    return await surface.encode('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadVisualizations({ format, filename, root = document }) {
  if (format !== 'png' && format !== 'svg') throw new Error('지원하는 이미지 형식은 PNG와 SVG입니다.');
  const panels = visualizations(root);
  if (!panels.length) throw new Error('이 화면에서 저장할 차트나 그래프를 찾을 수 없습니다.');
  const graphic = makeSVG(panels, format);
  const blob = format === 'png' ? await toPNG(graphic) : graphic.image;
  downloadFile(`${filename.replace(/\.(svg|png)$/i, '')}.${format}`, blob);
}
