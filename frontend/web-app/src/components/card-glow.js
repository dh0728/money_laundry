// Pointer geometry adapted from React Bits BorderGlow.
export function updateBorderGlowPointer(card, clientX, clientY, bounds = card.getBoundingClientRect()) {
  const { left, top, width, height } = bounds;
  if (!width || !height) return;
  const x = clientX - left - width / 2;
  const y = clientY - top - height / 2;
  const edge = Math.min(1, Math.max(Math.abs(x) * 2 / width, Math.abs(y) * 2 / height));
  const angle = Math.atan2(y, x) * 180 / Math.PI + 90;
  card.style.setProperty('--edge-proximity', String(edge * 100));
  card.style.setProperty('--cursor-angle', `${angle}deg`);
}

export function bindCardGlow(workspace) {
  const surfaceSelector = '[data-card-interactive]';
  const page = workspace.ownerDocument;
  let active;
  let tiltBounds;
  let clipping;

  function clipArea(surface) {
    const area = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
    for (let parent = surface.parentElement; parent && parent !== workspace; parent = parent.parentElement) {
      const style = page.defaultView.getComputedStyle(parent);
      const { overflowX, overflowY } = style;
      if (overflowX === 'visible' && overflowY === 'visible') continue;
      const { left, top, right, bottom } = parent.getBoundingClientRect();
      if (overflowX !== 'visible') {
        const reservesGlow = parent.classList.contains('record-card-scroll');
        area.left = Math.max(area.left, left + (reservesGlow ? parseFloat(style.paddingLeft) : 0));
        const scrollRight = overflowX === 'clip' ? right : left + parent.clientLeft + parent.clientWidth;
        area.right = Math.min(area.right, scrollRight - (reservesGlow ? parseFloat(style.paddingRight) : 0));
      }
      if (overflowY !== 'visible') {
        area.top = Math.max(area.top, top);
        area.bottom = Math.min(area.bottom, overflowY === 'clip' ? bottom : top + parent.clientTop + parent.clientHeight);
      }
    }
    return area;
  }

  function tiltScale(surface, bounds, area, rx, ry) {
    const halfWidth = bounds.width / 2;
    const halfHeight = bounds.height / 2;
    const centerX = bounds.left + halfWidth;
    const centerY = bounds.top + halfHeight;
    const perspective = page.defaultView.getComputedStyle(surface).getPropertyValue('--record-card-tilt-perspective').trim();
    if (!perspective) return 1;
    const matrix = new DOMMatrix(`perspective(${perspective}) rotateX(${rx}deg) rotateY(${ry}deg)`);
    let scale = 1;
    for (const x of [-halfWidth, halfWidth]) for (const y of [-halfHeight, halfHeight]) {
      const point = matrix.transformPoint({ x, y });
      const dx = point.x >= 0 ? area.right - centerX : centerX - area.left;
      const dy = point.y >= 0 ? area.bottom - centerY : centerY - area.top;
      // Solve the perspective projection against each scroll edge before applying the transform.
      for (const [extent, distance] of [[Math.abs(point.x), dx], [Math.abs(point.y), dy]]) {
        if (extent / point.w > distance) scale = Math.min(scale, distance / (extent - distance * (point.w - 1)));
      }
    }
    return scale;
  }
  function clear() {
    active?.removeAttribute('data-card-spotlight');
    active?.removeAttribute('data-card-tilted');
    active?.style.removeProperty('--card-tilt-x');
    active?.style.removeProperty('--card-tilt-y');
    active?.style.removeProperty('--card-tilt-scale');
    tiltBounds = undefined;
    active = undefined;
  }
  function move(event) {
    if (event.pointerType === 'touch') {
      clear();
      return;
    }
    const surface = event.target.closest?.(surfaceSelector);
    if (!surface || !workspace.contains(surface) || surface.closest('#sidebar, :disabled, [aria-disabled="true"]')) {
      clear();
      return;
    }
    const bounds = surface.getBoundingClientRect();
    const { left, top, width, height } = bounds;
    const x = event.clientX - left;
    const y = event.clientY - top;
    if (!width || !height || x < 0 || y < 0 || x > width || y > height) {
      clear();
      return;
    }
    if (surface !== active) {
      clear();
      active = surface;
      if (surface.hasAttribute('data-card-interactive')) {
        clipping = clipArea(surface);
        if (bounds.left >= clipping.left - 1 && bounds.right <= clipping.right + 1
            && bounds.top >= clipping.top - 1 && bounds.bottom <= clipping.bottom + 1) tiltBounds = bounds;
      }
    }
    updateBorderGlowPointer(active, event.clientX, event.clientY, bounds);
    active.setAttribute('data-card-spotlight', '');
    if (tiltBounds) {
      const rx = (0.5 - y / height) * 12;
      const ry = (x / width - 0.5) * 12;
      active.setAttribute('data-card-tilted', '');
      active.style.setProperty('--card-tilt-x', `${rx}deg`);
      active.style.setProperty('--card-tilt-y', `${ry}deg`);
      active.style.setProperty('--card-tilt-scale', String(tiltScale(active, tiltBounds, clipping, rx, ry)));
    }
  }
  workspace.addEventListener('pointermove', move, { passive: true });
  workspace.addEventListener('pointerleave', clear);
  workspace.addEventListener('pointercancel', clear);
  page.addEventListener('scroll', clear, { passive: true, capture: true });
  page.addEventListener('aml:appearance', clear);
  return () => {
    clear();
    workspace.removeEventListener('pointermove', move);
    workspace.removeEventListener('pointerleave', clear);
    workspace.removeEventListener('pointercancel', clear);
    page.removeEventListener('scroll', clear, true);
    page.removeEventListener('aml:appearance', clear);
  };
}
