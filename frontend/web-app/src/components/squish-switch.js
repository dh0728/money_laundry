import { createElement, useEffect, useRef } from 'react';

// React Bits SquishSwitch interaction, adapted for the standalone layout.
// Copyright (c) 2026 David Haz. See react-bits-LICENSE.md.
export function SquishSwitch(id, label) {
  return `<button class="squish-switch" id="${id}" type="button" role="switch"
    aria-checked="false" aria-label="${label}">
    <span class="squish-switch__track" aria-hidden="true"><span class="squish-switch__thumb"></span></span>
  </button>`;
}

export function bindSquishSwitch(button, onChange) {
  const listeners = new AbortController();
  const listen = (type, handler) => button.addEventListener(type, handler, { signal: listeners.signal });
  const thumb = button.querySelector('.squish-switch__thumb');
  const checked = () => button.getAttribute('aria-checked') === 'true';
  let grip;
  let suppressClick = false;

  function commit(next) {
    if (next === checked()) return;
    button.setAttribute('aria-checked', String(next));
    onChange(next);
    if (document.documentElement.dataset.reducedMotion !== 'true') {
      thumb.getAnimations().filter(animation => animation.id === 'squish').forEach(animation => animation.cancel());
      thumb.animate([{ scale: '1' }, { scale: '1.18 0.86', offset: 0.45 }, { scale: '1' }],
        { id: 'squish', duration: 320, easing: 'ease-out' });
    }
  }

  function release(event, canceled) {
    if (event.pointerId !== grip?.id) return;
    const { moved, offset, travel } = grip;
    grip = undefined;
    suppressClick = moved || canceled;
    button.removeAttribute('data-held');
    thumb.style.removeProperty('--drag-offset');
    if (moved && !canceled) commit(offset >= travel / 2);
  }

  listen('pointerdown', event => {
    if (event.button !== 0 || grip) return;
    suppressClick = false;
    const track = thumb.parentElement;
    const inset = thumb.offsetTop;
    const travel = track.clientWidth - thumb.offsetWidth - 2 * inset;
    const start = checked() ? travel : 0;
    grip = { id: event.pointerId, x: event.clientX, start, travel, offset: start, moved: false };
    button.setPointerCapture(event.pointerId);
  });
  listen('pointermove', event => {
    if (event.pointerId !== grip?.id) return;
    const delta = event.clientX - grip.x;
    const slop = event.pointerType === 'touch' ? 8 : 4;
    if (!grip.moved && Math.abs(delta) <= slop) return;
    grip.moved = true;
    grip.offset = Math.max(0, Math.min(grip.travel, grip.start + delta));
    button.setAttribute('data-held', '');
    thumb.style.setProperty('--drag-offset', `${grip.offset}px`);
  });
  listen('pointerup', event => release(event, false));
  listen('pointercancel', event => release(event, true));
  listen('lostpointercapture', event => release(event, true));
  listen('keydown', event => {
    if (event.key === 'Escape' && grip) {
      event.preventDefault();
      release({ pointerId: grip.id }, true);
    }
  });
  listen('click', event => {
    if (!suppressClick || event.detail === 0) commit(!checked());
    suppressClick = false;
  });
  return () => {
    if (grip) release({ pointerId: grip.id }, true);
    listeners.abort();
  };
}

export function SquishSwitchControl({ id, label, checked, onChange }) {
  const button = useRef(null);
  useEffect(() => bindSquishSwitch(button.current, onChange), [onChange]);

  return createElement('button', {
    ref: button, id, className: 'squish-switch', type: 'button', role: 'switch',
    'aria-label': label, 'aria-checked': checked,
  }, createElement('span', { className: 'squish-switch__track', 'aria-hidden': true },
    createElement('span', { className: 'squish-switch__thumb' })));
}
