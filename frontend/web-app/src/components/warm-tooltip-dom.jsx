import React from 'react';
import { createRoot } from 'react-dom/client';
import { WarmTooltipGroup } from './react-bits/WarmTooltip';

const groups = new WeakMap();
const delay = 400;
let triggerId = 0;

function getGroup(host) {
  if (groups.has(host)) return groups.get(host);
  const root = createRoot(document.createDocumentFragment());
  const group = { bindings: 0, pending: null, active: null, api: null, dismissing: false };
  let restoreFrame = 0;
  const attach = api => { group.api = api; };
  const render = () => root.render(<WarmTooltipGroup ref={attach} portalTarget={host} delay={delay}
    reduceMotion={document.documentElement.dataset.reducedMotion === 'true'} />);
  const outside = event => {
    if ((group.active && !group.active.trigger.contains(event.target)) ||
      (group.pending && !group.pending.trigger.contains(event.target))) hideTooltip(host);
  };
  const escape = event => {
    if (event.key !== 'Escape') return;
    group.dismissing = true;
    hideTooltip(host);
    // Capture and shell dismissal run in different listeners for the same key event.
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => { group.dismissing = false; });
  };
  document.addEventListener('aml:appearance', render);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  group.dispose = () => {
    cancelAnimationFrame(restoreFrame);
    document.removeEventListener('aml:appearance', render);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    root.unmount();
    if (host.matches(':popover-open')) host.hidePopover();
    groups.delete(host);
  };
  groups.set(host, group);
  render();
  return group;
}

function clearPending(group) {
  clearTimeout(group.pending?.timer);
  group.pending = null;
}

export function hideTooltip(host) {
  const group = groups.get(host);
  if (!group) return;
  clearPending(group);
  group.active?.restore();
  group.active = null;
  group.api?.reset();
}

export function bindTooltip(trigger, host, { instantOnHover = false, hover = true } = {}) {
  if (!trigger || !host) return () => {};
  const group = getGroup(host);
  const id = `aml-tooltip-trigger-${++triggerId}`;
  group.bindings++;
  const enabled = () => trigger.isConnected && host.isConnected &&
    !trigger.matches(':disabled, [aria-disabled="true"], [aria-expanded="true"][aria-haspopup], [data-query-tool][aria-expanded="true"]');
  function show(mode) {
    const content = trigger.getAttribute('aria-label');
    const api = group.api;
    if (!api || !content || !enabled()) return;
    group.active?.restore();
    const descriptions = () => (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    trigger.setAttribute('aria-describedby', [...new Set([...descriptions(), api.id])].join(' '));
    group.active = {
      trigger,
      restore: () => {
        const remaining = descriptions().filter(value => value !== api.id);
        if (remaining.length) trigger.setAttribute('aria-describedby', remaining.join(' '));
        else trigger.removeAttribute('aria-describedby');
      },
    };
    const rect = trigger.getBoundingClientRect();
    const side = rect.top < 42 && window.innerHeight - rect.bottom > rect.top ? 'bottom' : 'top';
    api.show({
      id, trigger, content, side, gap: 8, arrow: true,
      surfaceColor: 'var(--chart-tooltip-background)', inkColor: 'var(--text)',
      radius: 8, font: 12.5, px: 10, py: 6, popDuration: 160, popScale: 0.94, popBlur: 4,
      warmWindow: api.warmWindow,
    }, mode);
  }
  const hide = instant => {
    if (group.pending?.trigger === trigger) clearPending(group);
    if (group.active?.trigger !== trigger) return;
    group.active.restore();
    group.active = null;
    group.api?.hide(id, instant);
  };
  const listeners = {
    pointerenter(event) {
      if (!hover || event.pointerType === 'touch' || event.buttons !== 0 || !enabled()) return;
      clearPending(group);
      if (instantOnHover) show('instant');
      else if (group.api?.isWarm()) show('warm');
      else group.pending = { trigger, timer: setTimeout(() => {
        group.pending = null;
        show('cold');
      }, delay) };
    },
    pointerleave() { if (!trigger.matches(':focus-visible')) hide(false); },
    pointerdown() { hide(true); },
    focus() {
      if (!group.dismissing && trigger.matches(':focus-visible')) {
        clearPending(group);
        show('instant');
      }
    },
    blur() { hide(true); },
    click() { hide(true); },
  };
  for (const [event, handler] of Object.entries(listeners)) trigger.addEventListener(event, handler);
  return () => {
    hide(true);
    for (const [event, handler] of Object.entries(listeners)) trigger.removeEventListener(event, handler);
    if (--group.bindings === 0) queueMicrotask(() => { if (group.bindings === 0) group.dispose(); });
  };
}
