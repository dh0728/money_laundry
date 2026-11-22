'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import './GlideSelect.css';

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
  ariaLabel?: string;
  className?: string;
}

type Phase = 'closed' | 'open' | 'closing';

const SIZES: Record<string, { chip: number; row: number; font: number }> = {
  sm: { chip: 28, row: 26, font: 12 },
  md: { chip: 32, row: 30, font: 13 },
  lg: { chip: 44, row: 40, font: 14 }
};
const GAP = 1;
const MENU_GAP = 6;
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
  radius = 10,
  menuWidth = 176,
  placement = 'bottom',
  align = 'left',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  disabled = false,
  inlineList = false,
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
  const S = SIZES[size] ?? SIZES.md;
  const step = S.row + GAP;
  const popOut = Math.round((popDuration * 2) / 3);

  useLayoutEffect(() => {
    if (phase !== 'open') return;
    const el = menuRef.current;
    const trigger = triggerRef.current;
    if (!el) return;
    const place = () => {
      if (!trigger || !el.showPopover) return;
      const r = trigger.getBoundingClientRect();
      const above = r.top - MENU_GAP;
      const below = window.innerHeight - r.bottom - MENU_GAP;
      const need = el.scrollHeight;
      const flip = placement === 'bottom' ? below < need && above > below : above < need && below > above;
      const nextSide = flip ? (placement === 'bottom' ? 'top' : 'bottom') : placement;
      const width = Math.min(Math.max(menuWidth, r.width), window.innerWidth - 2 * MENU_GAP);
      setSide(nextSide);
      el.style.width = `${width}px`;
      el.style.maxHeight = `${Math.max(0, (nextSide === 'top' ? above : below) - MENU_GAP)}px`;
      el.style.left = `${Math.max(MENU_GAP, Math.min(align === 'right' ? r.right - width : r.left, window.innerWidth - width - MENU_GAP))}px`;
      el.style.top = nextSide === 'bottom' ? `${r.bottom + MENU_GAP}px` : 'auto';
      el.style.bottom = nextSide === 'top' ? `${window.innerHeight - r.top + MENU_GAP}px` : 'auto';
    };
    if (trigger && el.showPopover && !el.matches(':popover-open')) el.showPopover();
    place();
    el.style.transitionDuration = instant.current ? '0ms' : '';
    el.dataset.state = 'closed';
    void el.offsetHeight;
    el.dataset.state = 'open';
    const p = pillRef.current;
    if (p) {
      p.style.transition = 'none';
      p.style.transform = `translateY(${Math.max(0, selected) * step}px)`;
      p.style.opacity = '0';
      void p.offsetHeight;
      p.style.transition = '';
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useLayoutEffect(() => {
    const p = pillRef.current;
    if (!p || phase !== 'open') return;
    if (active === null) {
      p.style.opacity = '0';
      return;
    }
    const jump = instant.current || p.style.opacity !== '1';
    p.style.transitionDuration = jump ? '0ms, 150ms' : '';
    p.style.transform = `translateY(${active * step}px)`;
    p.style.opacity = '1';
    const menu = menuRef.current;
    if (!inlineList && instant.current && menu) {
      const option = menu.querySelector<HTMLElement>(`[data-index="${active}"]`);
      if (option) {
        const row = option.getBoundingClientRect();
        const bounds = menu.getBoundingClientRect();
        if (row.top < bounds.top) menu.scrollTop -= bounds.top - row.top;
        if (row.bottom > bounds.bottom) menu.scrollTop += row.bottom - bounds.bottom;
      }
    }
    instant.current = false;
  }, [active, inlineList, phase, step]);

  const open = (viaKey: boolean) => {
    if (disabled) return;
    clearTimeout(closeTimer.current);
    instant.current = true;
    setActive(selected >= 0 ? selected : viaKey ? 0 : null);
    setPhase('open');
  };
  const close = (mode: 'instant' | 'pop') => {
    setActive(null);
    clearTimeout(closeTimer.current);
    const el = menuRef.current;
    if (mode === 'instant' || !el) {
      setPhase('closed');
      return;
    }
    el.style.transitionDuration = '';
    el.dataset.state = 'closed';
    setPhase('closing');
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20);
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
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = '';
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
      setActive(Math.min(n - 1, Math.max(0, i)));
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

  useEffect(() => {
    if (inlineList || phase === 'closed') return undefined;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close('pop');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, inlineList]);
  useEffect(() => {
    if (disabled) clearTimeout(closeTimer.current);
  }, [disabled]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const rowAt = (y: number) => {
    const list = menuRef.current?.firstElementChild;
    if (!scrub.current || !list) return null;
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
      style={
        {
          '--gs-accent': accentColor,
          '--gs-surface': surfaceColor,
          '--gs-highlight': highlightColor,
          '--gs-text': textColor,
          '--gs-radius': `${radius}px`,
          '--gs-inner-radius': `${Math.max(3, radius - 4)}px`,
          '--gs-chip': `${S.chip}px`,
          '--gs-row': `${S.row}px`,
          '--gs-font': `${S.font}px`,
          '--gs-menu-w': `${menuWidth}px`,
          '--gs-pop': `${popDuration}ms`,
          '--gs-pop-out': `${popOut}ms`,
          '--gs-glide': `${glideDuration}ms`,
          '--gs-origin': origin
        } as CSSProperties
      }
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
        <div ref={menuRef} popover={inlineList ? undefined : 'manual'} className="glide-select__menu" data-state="open" data-side={side} data-align={align}>
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
