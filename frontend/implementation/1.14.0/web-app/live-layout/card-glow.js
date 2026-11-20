// Pointer geometry adapted from React Bits BorderGlow.
export function updateBorderGlowPointer(card, clientX, clientY) {
  const { left, top, width, height } = card.getBoundingClientRect();
  if (!width || !height) return;
  const x = clientX - left - width / 2;
  const y = clientY - top - height / 2;
  const edge = Math.min(1, Math.max(Math.abs(x) * 2 / width, Math.abs(y) * 2 / height));
  const angle = Math.atan2(y, x) * 180 / Math.PI + 90;
  card.style.setProperty('--edge-proximity', String(edge * 100));
  card.style.setProperty('--cursor-angle', `${angle}deg`);
}

export function bindCardGlow(workspace) {
  const surfaceSelector = '.preview-tilt-cards [data-glow-surface]';
  const page = workspace.ownerDocument;
  let active;
  function clear() {
    active?.removeAttribute('data-card-spotlight');
    active?.style.removeProperty('--card-spotlight-x');
    active?.style.removeProperty('--card-spotlight-y');
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
    const { left, top, width, height } = surface.getBoundingClientRect();
    const x = event.clientX - left;
    const y = event.clientY - top;
    if (!width || !height || x < 0 || y < 0 || x > width || y > height) {
      clear();
      return;
    }
    if (surface !== active) {
      clear();
      active = surface;
    }
    active.style.setProperty('--card-spotlight-x', `${x * 100 / width}%`);
    active.style.setProperty('--card-spotlight-y', `${y * 100 / height}%`);
    active.setAttribute('data-card-spotlight', '');
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
