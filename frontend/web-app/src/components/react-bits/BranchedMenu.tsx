'use client';

import React, { isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bell, Download, Layers, MousePointer2, Palette, Rocket, Settings, Type, type LucideIcon } from 'lucide-react';
import { BranchLines } from './BranchLines';
import { readChartNumber } from '../charts/chart-design-values';

export interface BranchedMenuChild {
  value: string;
  label: string;
  icon?: ReactNode | LucideIcon;
}

export interface BranchedMenuItem {
  label: string;
  value?: string;
  children?: BranchedMenuChild[];
}

export interface BranchedMenuProps {
  items?: BranchedMenuItem[];
  defaultOpen?: number | number[];
  defaultActive?: string;
  onSelect?: (value: string, item: BranchedMenuChild | BranchedMenuItem) => void;
  onToggle?: (index: number, open: boolean) => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
  className?: string;
}

const DEFAULT_ITEMS: BranchedMenuItem[] = [
  {
    label: 'Getting started',
    children: [
      { value: 'install', label: 'Installation', icon: Download },
      { value: 'quick', label: 'Quick start', icon: Rocket },
      { value: 'config', label: 'Configuration', icon: Settings },
      { value: 'theming', label: 'Theming', icon: Palette }
    ]
  },
  {
    label: 'Components',
    children: [
      { value: 'buttons', label: 'Buttons', icon: MousePointer2 },
      { value: 'typography', label: 'Typography', icon: Type },
      { value: 'overlays', label: 'Overlays', icon: Layers },
      { value: 'toasts', label: 'Toasts', icon: Bell }
    ]
  }
];
const renderIcon = (icon: ReactNode | LucideIcon) => {
  if (isValidElement(icon)) return icon;
  const Icon = icon as LucideIcon;
  return <Icon className="branched-menu__symbol" aria-hidden="true" />;
};
const toSet = (open: number | number[]) => new Set(Array.isArray(open) ? open : open >= 0 ? [open] : []);

const BranchedMenu: React.FC<BranchedMenuProps> = ({
  items = DEFAULT_ITEMS,
  defaultOpen = 0,
  defaultActive = '',
  onSelect,
  onToggle,
  color,
  accentColor,
  lineColor,
  width,
  rowHeight,
  indent,
  trunk,
  radius,
  lineWidth,
  fontSize,
  drawDuration,
  foldDuration,
  className = ''
}) => {
  const [open, setOpen] = useState<Set<number>>(() => toSet(defaultOpen));
  const [active, setActive] = useState(() => {
    if (defaultActive) return defaultActive;
    const first = items.find((it, i) => it.children && toSet(defaultOpen).has(i));
    return first?.children?.[0]?.value ?? '';
  });
  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement>(null);
  const latest = useRef({ onSelect, onToggle });
  useLayoutEffect(() => {
    latest.current = { onSelect, onToggle };
  }, [onSelect, onToggle]);

  const activeSection = items.findIndex(it => it.children?.some(kid => kid.value === active));
  const markerShown = activeSection >= 0 && open.has(activeSection);
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current;
      const el = heads.current[activeSection];
      if (!m) return;
      const on = markerShown && el;
      if (!glide) m.setAttribute('data-snap', '');
      if (on) m.style.setProperty('--bm-marker-top', `calc(${el.offsetTop + el.offsetHeight / 2}px - var(--aml-space-16) / 2)`);
      m.toggleAttribute('data-on', Boolean(on));
      if (!glide) {
        void m.offsetHeight;
        m.removeAttribute('data-snap');
      }
    };
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeSection, markerShown, items, fontSize, rowHeight]);

  const select = (value: string, item: BranchedMenuChild | BranchedMenuItem) => {
    setActive(value);
    latest.current.onSelect?.(value, item);
  };
  const toggle = (i: number) => {
    setOpen(prev => {
      const next = new Set(prev);
      const isOpen = !next.has(i);
      if (isOpen) next.add(i);
      else next.delete(i);
      latest.current.onToggle?.(i, isOpen);
      return next;
    });
  };

  const padding = readChartNumber('--aml-space-6', 6);
  const rowSize = rowHeight ?? readChartNumber('--selection-control-height-medium', 36);
  const branchWidth = indent ?? readChartNumber('--aml-space-40', 40);
  const branchTrunk = trunk ?? readChartNumber('--branched-menu-rail-inset', 14);
  const turn = Math.min(radius ?? readChartNumber('--aml-space-10', 10), rowSize / 2 - readChartNumber('--aml-space-2', 2));
  const branchEnd = branchWidth - readChartNumber('--aml-space-8', 8);
  const rowY = (index: number) => padding + (index + 0.5) * rowSize;

  return (
    <nav
      ref={navRef}
      className={`branched-menu${className ? ` ${className}` : ''}`}
      style={
        {
          '--bm-w': width == null ? undefined : `${width}px`,
          '--bm-ink': color,
          '--bm-accent': accentColor,
          '--bm-line': lineColor,
          '--bm-font': fontSize == null ? undefined : `${fontSize}px`,
          '--bm-row': rowHeight == null ? undefined : `${rowHeight}px`,
          '--bm-indent': indent == null ? undefined : `${indent}px`,
          '--bm-line-w': lineWidth,
          '--bm-draw': drawDuration == null ? undefined : `${drawDuration}ms`,
          '--bm-fold': foldDuration == null ? undefined : `${foldDuration}ms`
        } as CSSProperties
      }
    >
      <span ref={markerRef} className="branched-menu__marker" aria-hidden="true" />
      {items.map((item, i) => {
        const kids = item.children;
        const isOpen = kids ? open.has(i) : false;
        const leafValue = item.value ?? item.label;
        const leafActive = !kids && leafValue === active;
        const treeHeight = kids ? padding * 2 + kids.length * rowSize : 0;
        return (
          <div key={item.value ?? item.label} className="branched-menu__section" data-open={isOpen ? '' : undefined}>
            <button
              ref={el => {
                heads.current[i] = el;
              }}
              type="button"
              className="branched-menu__head"
              aria-expanded={kids ? isOpen : undefined}
              aria-current={leafActive ? 'true' : undefined}
              data-active={leafActive ? '' : undefined}
              onClick={() => (kids ? toggle(i) : select(leafValue, item))}
            >
              {item.label}
            </button>
            {kids ? (
              <div className="branched-menu__body" aria-hidden={!isOpen} inert={!isOpen}>
                <div className="branched-menu__fold">
                  <div className="branched-menu__tree" style={{ '--bm-tree-height': `${treeHeight}px` } as CSSProperties}>
                    <BranchLines rows={kids.map((_, index) => rowY(index))} width={branchWidth} height={treeHeight}
                      trunk={branchTrunk} end={branchEnd} radius={turn} activeIndex={kids.findIndex(kid => kid.value === active)} />
                    {kids.map(kid => (
                      <button
                        key={kid.value}
                        type="button"
                        className="branched-menu__item"
                        aria-current={kid.value === active ? 'true' : undefined}
                        data-active={kid.value === active ? '' : undefined}
                        tabIndex={isOpen ? 0 : -1}
                        onClick={() => select(kid.value, kid)}
                      >
                        {kid.icon ? (
                          <span className="branched-menu__icon" aria-hidden="true">
                            {renderIcon(kid.icon)}
                          </span>
                        ) : null}
                        <span className="branched-menu__label">{kid.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
};

export default BranchedMenu;
