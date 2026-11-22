const nativeOverlayOpen = () => document.querySelector('dialog:modal, [popover="auto"]:popover-open');

export function setupOverlayDismissal(layers) {
  const configByButton = new Map(layers.map(layer => [layer.button, layer]));
  const opened = layers.filter(({ button }) => button.getAttribute('aria-expanded') === 'true');
  const top = () => opened.findLast(({ button }) => button.getClientRects().length > 0);
  const inside = (layer, event) => {
    const path = event.composedPath();
    return path.includes(layer.button) || layer.surfaces.some(surface => path.includes(surface)) ||
      Boolean(layer.keepOpenOn && path.some(node => node.matches?.(layer.keepOpenOn)));
  };
  let outsideStart;

  document.addEventListener('pointerdown', event => {
    const layer = top();
    outsideStart = layer && event.isPrimary && event.button === 0 &&
      !nativeOverlayOpen() && !inside(layer, event) ? layer : undefined;
  }, true);

  document.addEventListener('pointercancel', () => { outsideStart = undefined; }, true);

  document.addEventListener('click', event => {
    const layer = outsideStart;
    outsideStart = undefined;
    if (layer && event.detail > 0 && layer === top() && !nativeOverlayOpen() && !inside(layer, event)) {
      layer.dismiss();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || nativeOverlayOpen()) return;
    const layer = top();
    if (!layer) return;
    event.preventDefault();
    layer.dismiss();
    layer.button.focus({ preventScroll: true });
  });

  return {
    mark(button, isOpen) {
      const layer = configByButton.get(button);
      if (!layer) return;
      const index = opened.indexOf(layer);
      if (index !== -1) opened.splice(index, 1);
      if (isOpen) opened.push(layer);
    },
  };
}

export function enableBackdropDismissal(dialog) {
  const onBackdrop = event => {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX >= rect.right ||
      event.clientY < rect.top || event.clientY >= rect.bottom;
  };
  let startedOnBackdrop = false;
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented ||
        dialog.querySelector('[popover]:popover-open')) return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('pointerdown', event => {
    startedOnBackdrop = event.isPrimary && event.button === 0 && onBackdrop(event);
  });
  dialog.addEventListener('pointercancel', () => { startedOnBackdrop = false; });
  dialog.addEventListener('click', event => {
    const shouldClose = startedOnBackdrop && event.detail > 0 && onBackdrop(event);
    startedOnBackdrop = false;
    if (shouldClose) dialog.close();
  });
  dialog.addEventListener('close', () => { startedOnBackdrop = false; });
}
