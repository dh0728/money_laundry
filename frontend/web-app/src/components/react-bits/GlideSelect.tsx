'use client';

import React, { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAppReducedMotion } from '@/hooks/use-reduced-motion';

import './GlideSelect.css';

declare module 'react' {
  interface CSSProperties {
    [name: `--gs-${string}`]: string | undefined;
  }
}

export interface GlideSelectOption {
  value: string;
  label: ReactNode;
  tag?: string;
}

export interface GlideSelectProps {
  options?: (string | GlideSelectOption)[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option: GlideSelectOption) => void;
  placeholder?: string;
  showTags?: boolean;
  accentColor?: string;
  surfaceColor?: string;
  highlightColor?: string;
  textColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  menuWidth?: number;
  placement?: 'top' | 'bottom';
  align?: 'left' | 'right';
  popDuration?: number;
  glideDuration?: number;
  rememberPosition?: boolean;
  disabled?: boolean;
  inlineList?: boolean;
  expandInline?: boolean;
  appearance?: 'panel-title';
  fullWidth?: boolean;
  ariaLabel?: string;
  className?: string;
}

type Phase = 'closed' | 'open' | 'closing';

const DEFAULT_OPTIONS: (string | GlideSelectOption)[] = ['One', 'Two', 'Three'];

const norm = (o: string | GlideSelectOption): GlideSelectOption => (typeof o === 'string' ? { value: o, label: o } : o);
const textOf = (it: GlideSelectOption) => (typeof it.label === 'string' ? it.label : it.value);
const typeaheadIndex = (items: GlideSelectOption[], from: number, ch: string) => {
  const c = ch.toLowerCase();
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (textOf(items[i]).toLowerCase().startsWith(c)) return i;
  }
  return from;
};

const GlideSelect: React.FC<GlideSelectProps> = ({
  options = DEFAULT_OPTIONS,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  showTags = true,
  accentColor,
  surfaceColor,
  highlightColor,
  textColor,
  size = 'md',
  radius,
  menuWidth,
  placement = 'bottom',
  align = 'left',
  popDuration,
  glideDuration,
  rememberPosition = true,
  disabled = false,
  inlineList = false,
  expandInline = false,
  appearance,
  fullWidth = false,
  ariaLabel = 'Select',
  className = ''
}) => {
  const items = options.map(norm);
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const selected = items.findIndex(it => it.value === current);
  const [phase, setPhase] = useState<Phase>(inlineList ? 'open' : 'closed');
  const [active, setActive] = useState<number | null>(inlineList ? Math.max(0, selected) : null);
  if (disabled && phase !== 'closed') {
    setActive(null);
    setPhase('closed');
  }
  const [side, setSide] = useState<'top' | 'bottom'>(placement);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const instant = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrub = useRef<{ id: number } | null>(null);
  const id = useId();
  const reduced = useAppReducedMotion();

  const placeOpenList = useEffectEvent(() => {
    if (phase !== 'open') return;
    const el = menuRef.current;
    const trigger = triggerRef.current;
    if (!el) return;
    const place = () => {
      if (expandInline || !trigger || !el.showPopover) return;
      const r = trigger.getBoundingClientRect();
      const style = getComputedStyle(el);
      const gap = Number.parseFloat(style.getPropertyValue('--aml-space-6'));
      const minimumWidth = Number.parseFloat(style.getPropertyValue('--gs-menu-w'));
      const above = r.top - gap;
      const below = window.innerHeight - r.bottom - gap;
      const need = el.scrollHeight;
      const flip = placement === 'bottom' ? below < need && above > below : above < need && below > above;
      const nextSide = flip ? (placement === 'bottom' ? 'top' : 'bottom') : placement;
      const width = Math.min(Math.max(minimumWidth, r.width), window.innerWidth - 2 * gap);
      setSide(nextSide);
      el.style.setProperty('--gs-positioned-width', `${width}px`);
      el.style.setProperty('--gs-positioned-height', `${Math.max(0, (nextSide === 'top' ? above : below) - gap)}px`);
      el.style.setProperty('--gs-positioned-left', `${Math.max(gap, Math.min(align === 'right' ? r.right - width : r.left, window.innerWidth - width - gap))}px`);
      el.style.setProperty('--gs-positioned-top', nextSide === 'bottom' ? `${r.bottom + gap}px` : 'auto');
      el.style.setProperty('--gs-positioned-bottom', nextSide === 'top' ? `${window.innerHeight - r.top + gap}px` : 'auto');
    };
    if (!expandInline && trigger && el.showPopover && !el.matches(':popover-open')) el.showPopover();
    place();
    el.toggleAttribute('data-instant', instant.current);
    el.dataset.state = 'closed';
    void el.offsetHeight;
    el.dataset.state = 'open';
    const p = pillRef.current;
    if (p) {
      p.dataset.jump = '';
      const option = el.querySelector<HTMLElement>(`[data-index="${Math.max(0, selected)}"]`);
      p.style.setProperty('--gs-pill-offset', `${option?.offsetTop ?? 0}px`);
      p.removeAttribute('data-visible');
      void p.offsetHeight;
      p.removeAttribute('data-jump');
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  });
  useLayoutEffect(() => placeOpenList(), [phase]);

  useLayoutEffect(() => {
    const p = pillRef.current;
    if (!p || phase !== 'open') return;
    if (active === null) {
      p.removeAttribute('data-visible');
      return;
    }
    const menu = menuRef.current;
    const option = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    p.toggleAttribute('data-jump', instant.current || !p.hasAttribute('data-visible'));
    p.style.setProperty('--gs-pill-offset', `${option?.offsetTop ?? 0}px`);
    p.dataset.visible = '';
    if (!inlineList && instant.current && menu && option) {
      const row = option.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      if (row.top < bounds.top) menu.scrollTop -= bounds.top - row.top;
      if (row.bottom > bounds.bottom) menu.scrollTop += row.bottom - bounds.bottom;
    }
    instant.current = false;
  }, [active, inlineList, phase, size]);

  const open = (viaKey: boolean) => {
    if (disabled) return;
    clearTimeout(closeTimer.current);
    instant.current = true;
    setActive(expandInline ? items.findIndex((_, index) => index !== selected) : selected >= 0 ? selected : viaKey ? 0 : null);
    setPhase('open');
  };
  const close = (mode: 'instant' | 'pop') => {
    setActive(null);
    clearTimeout(closeTimer.current);
    const el = menuRef.current;
    if (expandInline || mode === 'instant' || reduced || !el) {
      setPhase('closed');
      return;
    }
    el.removeAttribute('data-instant');
    el.dataset.state = 'closed';
    setPhase('closing');
    const duration = getComputedStyle(el).transitionDuration.split(',')[0];
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
    closeTimer.current = setTimeout(() => setPhase('closed'), milliseconds + 20);
  };
  const pick = (i: number, viaKey: boolean) => {
    const it = items[i];
    if (!it) {
      close('instant');
      return;
    }
    if (inlineList || it.value !== current) {
      if (value === undefined) setInner(it.value);
      onChange?.(it.value, it);
      if (!viaKey && !reduced && rootRef.current) rootRef.current.dataset.swap = '';
    }
    if (!inlineList) {
      close('instant');
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const k = e.key;
    const n = items.length;
    const cur = active ?? Math.max(0, selected);
    if (phase !== 'open') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        open(true);
      }
      return;
    }
    const go = (i: number) => {
      e.preventDefault();
      instant.current = true;
      const index = Math.min(n - 1, Math.max(0, i));
      setActive(expandInline && index === selected ? cur : index);
    };
    if (k === 'ArrowDown' || k === 'ArrowUp') go(active === null ? cur : cur + (k === 'ArrowDown' ? 1 : -1));
    else if (k === 'Home' || k === 'End') go(k === 'Home' ? 0 : n - 1);
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      pick(cur, true);
    } else if (!inlineList && (k === 'Escape' || k === 'Tab')) {
      if (k === 'Escape') e.preventDefault();
      close('instant');
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) go(typeaheadIndex(items, cur, k));
  };

  const watchOutsidePointer = useEffectEvent(() => {
    if (inlineList || phase === 'closed') return undefined;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close('pop');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });
  useEffect(() => watchOutsidePointer(), [phase, inlineList]);
  useEffect(() => {
    if (disabled) clearTimeout(closeTimer.current);
  }, [disabled]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const rowAt = (y: number) => {
    const list = menuRef.current?.firstElementChild;
    if (!scrub.current || !list) return null;
    if (expandInline) {
      const row = [...list.querySelectorAll<HTMLElement>('[data-index]:not([hidden])')].find(option => {
        const { top, bottom } = option.getBoundingClientRect();
        return y >= top && y < bottom;
      });
      return row ? Number(row.dataset.index) : null;
    }
    const option = list.querySelector<HTMLElement>('[data-index]');
    if (!option) return null;
    const step = option.offsetHeight + Number.parseFloat(getComputedStyle(list).rowGap);
    const i = Math.floor((y - list.getBoundingClientRect().top) / step);
    return i >= 0 && i < items.length ? i : null;
  };
  const onListDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrub.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the pointer ended before the list handled it.
    }
    scrub.current = { id: e.pointerId };
    instant.current = true;
    setActive(rowAt(e.clientY));
  };
  const onListMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return;
    const i = rowAt(e.clientY);
    if (i !== active) setActive(i);
  };
  const onListUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return;
    const i = e.type === 'pointerup' ? rowAt(e.clientY) : null;
    scrub.current = null;
    if (i !== null) pick(i, false);
    else if (!rememberPosition) setActive(null);
  };
  const onListOver = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || scrub.current) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!row) return;
    const i = Number(row.dataset.index);
    if (i !== active) setActive(i);
  };

  const origin = `${side === 'bottom' ? 'top' : 'bottom'} ${align}`;
  return (
    <div
      ref={rootRef}
      className={`glide-select${className ? ` ${className}` : ''}`}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      data-inline-list={inlineList ? '' : undefined}
      data-expand-inline={expandInline || undefined}
      data-expanded={expandInline && phase === 'open' || undefined}
      data-appearance={appearance}
      data-full-width={fullWidth || undefined}
      data-motion-reduced={reduced || undefined}
      style={{
          '--gs-accent': accentColor,
          '--gs-surface': surfaceColor,
          '--gs-highlight': highlightColor,
          '--gs-text': textColor,
          '--gs-radius': radius == null ? undefined : `${radius}px`,
          '--gs-inner-radius': radius == null ? undefined : `${Math.max(3, radius - 4)}px`,
          '--gs-menu-w': menuWidth == null ? undefined : `${menuWidth}px`,
          '--gs-pop': popDuration == null ? undefined : `${popDuration}ms`,
          '--gs-pop-out': popDuration == null ? undefined : `${Math.round((popDuration * 2) / 3)}ms`,
          '--gs-glide': glideDuration == null ? undefined : `${glideDuration}ms`,
          '--gs-origin': origin
      }}
      onAnimationEnd={e => {
        if (e.animationName === 'gs-swap' && rootRef.current) delete rootRef.current.dataset.swap;
      }}
    >
      {!inlineList && <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className="glide-select__trigger"
        onPointerDown={e => {
          if (e.button !== 0 || disabled) return;
          e.currentTarget.focus({ preventScroll: true });
          if (phase === 'open') close('pop');
          else open(false);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="glide-select__label" key={current} data-empty={selected < 0 ? '' : undefined}>
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className="glide-select__chevron" aria-hidden="true">
          <ChevronDown className="icon icon-compact" aria-hidden="true" />
        </span>
      </button>}
      {phase !== 'closed' ? (
        <div ref={menuRef} popover={inlineList || expandInline ? undefined : 'manual'} className="glide-select__menu" data-state="open" data-side={side} data-align={align}>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={inlineList ? 0 : undefined}
            aria-activedescendant={inlineList && active !== null ? `${id}-${active}` : undefined}
            className="glide-select__list"
            data-live={active !== null ? '' : undefined}
            onPointerOver={onListOver}
            onPointerLeave={() => {
              if (!scrub.current && !rememberPosition) setActive(null);
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
            onKeyDown={inlineList ? onTriggerKey : undefined}
          >
            <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
            {items.map((it, i) => (
              <div
                key={it.value}
                id={`${id}-${i}`}
                role="option"
                hidden={expandInline && i === selected}
                aria-selected={i === selected}
                data-index={i}
                className="glide-select__option"
              >
                <span className="glide-select__name">{it.label}</span>
                {showTags && it.tag ? <span className="glide-select__tag">{it.tag}</span> : null}
                <span className="glide-select__check" data-on={i === selected ? '' : undefined} aria-hidden="true">
                  <Check className="icon icon-compact" aria-hidden="true" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default GlideSelect;
