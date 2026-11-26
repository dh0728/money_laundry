import { glassDisplacementMap } from './glass-map.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const surfaceSelector = [
  '.glass', '.screen-panel', '.screen-overlay', '.panel-material', '[data-glow-surface]',
  '.dashboard-metrics .magic-bento__card', '.workflow-bento .magic-bento__card',
  '[data-button-surface="floating"]', '.star-border',
  '#workflow-notifications .swipe-toast__card',
].join(', ');

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function createFilter(id, width, height, radius, blur, mapOptions) {
  const filter = svgElement('filter', {
    id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB',
  });
  filter.append(
    svgElement('feImage', {
      x: 0, y: 0, width: '100%', height: '100%', preserveAspectRatio: 'none',
      href: glassDisplacementMap(width, height, radius, mapOptions), result: 'map',
    }),
    svgElement('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'map', scale: -Math.min(96, Math.min(width, height) * 0.9),
      xChannelSelector: 'R', yChannelSelector: 'B', result: 'displaced',
    }),
    svgElement('feGaussianBlur', { in: 'displaced', stdDeviation: blur }),
  );
  return filter;
}

function supportsGlassFilter() {
  const agent = navigator.userAgent;
  const unsupportedEngine = /Firefox|iPhone|iPad|iPod/.test(agent) || (/Safari/.test(agent) && !/Chrome/.test(agent));
  return !unsupportedEngine && CSS.supports('backdrop-filter', 'url(#glass-material-test)');
}

export function setupGlassMaterial() {
  if (!supportsGlassFilter()) return;

  const tokens = getComputedStyle(document.documentElement);
  const mapOptions = {
    opacity: parseFloat(tokens.getPropertyValue('--glass-refraction-map-opacity')),
    blur: parseFloat(tokens.getPropertyValue('--glass-refraction-map-blur')),
    reverseHorizontal: true,
  };
  const definitions = svgElement('defs', {});
  const svg = svgElement('svg', { width: 0, height: 0, class: 'glass-refraction', 'aria-hidden': 'true' });
  svg.append(definitions);
  document.body.prepend(svg);
  const filters = new Map();
  const surfaces = new Map();
  let serial = 0;

  function release(surface) {
    const previous = surfaces.get(surface);
    if (!previous) return;
    surfaces.set(surface, null);
    if (--previous.users === 0) {
      previous.element.remove();
      filters.delete(previous.key);
    }
  }

  function update(surface) {
    const { offsetWidth: width, offsetHeight: height } = surface;
    if (!width || !height) {
      release(surface);
      surface.style.removeProperty('--material-refraction');
      return;
    }

    const style = getComputedStyle(surface);
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius,
      style.borderBottomLeftRadius].map(value => Math.min(parseFloat(value) || 0, width / 2, height / 2));
    const blur = parseFloat(style.getPropertyValue('--glass-optical-softness'));
    const key = `${width}:${height}:${radii.join(':')}:${blur}`;
    const current = surfaces.get(surface);
    if (current?.key === key) return;
    release(surface);

    let entry = filters.get(key);
    if (!entry) {
      const id = `glass-material-${++serial}`;
      const element = createFilter(id, width, height, radii, blur, mapOptions);
      definitions.append(element);
      entry = { element, key, id, users: 0 };
      filters.set(key, entry);
    }
    entry.users++;
    surfaces.set(surface, entry);
    surface.style.setProperty('--material-refraction', `url(#${entry.id})`);
  }

  const resize = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (target.isConnected && surfaces.has(target)) update(target);
    }
  });

  function track(surface) {
    if (surfaces.has(surface)) return;
    surfaces.set(surface, null);
    resize.observe(surface);
  }

  function untrack(surface) {
    release(surface);
    resize.unobserve(surface);
    surfaces.delete(surface);
    surface.style.removeProperty('--material-refraction');
  }

  function scan(node) {
    if (!(node instanceof Element) || svg.contains(node)) return;
    if (node.matches(surfaceSelector)) track(node);
    node.querySelectorAll(surfaceSelector).forEach(track);
  }

  scan(document.body);
  const mutations = new MutationObserver(changes => {
    let removed = false;
    for (const change of changes) {
      if (svg.contains(change.target)) continue;
      if (change.type === 'attributes') {
        if (change.target === document.documentElement) {
          for (const surface of surfaces.keys()) {
            if (surface.isConnected) update(surface);
          }
          continue;
        }
        if (change.target.matches(surfaceSelector)) track(change.target);
        else if (surfaces.has(change.target)) untrack(change.target);
        continue;
      }
      change.addedNodes.forEach(scan);
      removed ||= change.removedNodes.length > 0;
    }
    if (!removed) return;
    for (const surface of surfaces.keys()) {
      if (surface.isConnected) continue;
      untrack(surface);
    }
  });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-button-surface'] });
  mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-size'] });

  return () => {
    mutations.disconnect();
    resize.disconnect();
    for (const surface of surfaces.keys()) surface.style.removeProperty('--material-refraction');
    surfaces.clear();
    filters.clear();
    svg.remove();
  };
}
