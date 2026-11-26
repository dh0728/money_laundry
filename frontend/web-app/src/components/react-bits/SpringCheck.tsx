'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react';
import { useAppReducedMotion } from '@/hooks/use-reduced-motion';

import './SpringCheck.css';

export type StrikeSide = 'left' | 'center' | 'right' | 'none';

export interface SpringCheckProps {
  label?: ReactNode;
  checked?: boolean;
  mixed?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;
  fillColor?: string;
  checkColor?: string;
  boxSize?: number;
  boxRadius?: number;
  fontSize?: number;
  bounce?: number;
  strikeLag?: number;
  doneOpacity?: number;
  strike?: StrikeSide;
  ariaLabel?: string;
  className?: string;
}

const VISUAL_DURATION = 0.2;
const RULE_END = 0.84;
const SWELL = 0.35;
const TICK_PATH = 'M20 6 9 17l-5-5'; // Lucide Check path; the stroke is animated.
const MINUS_PATH = 'M5 12h14'; // Lucide Minus path.
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const zetaOf = (bounce: number) =>
  bounce <= 0 ? 1 : -Math.log(bounce) / Math.sqrt(Math.PI ** 2 + Math.log(bounce) ** 2);

const readings = (t: number, doneOpacity: number, strikeLag: number) => {
  const held = clamp01(t);
  return {
    fill: Math.max(t, 0),
    box: 1 + SWELL * Math.max(0, t - 1),
    tick: 1 - held,
    word: 1 - (1 - doneOpacity) * held,
    rule: clamp01((held - strikeLag) / (RULE_END - strikeLag))
  };
};

const SpringCheck: React.FC<SpringCheckProps> = ({
  label = 'Ship the build',
  checked,
  mixed = false,
  defaultChecked = false,
  onChange,
  disabled = false,
  color,
  fillColor,
  checkColor,
  boxSize,
  boxRadius,
  fontSize,
  bounce = 0.2,
  strikeLag = 0.12,
  doneOpacity = 0.42,
  strike = 'left',
  ariaLabel,
  className = ''
}) => {
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(defaultChecked);
  const on = controlled ? checked : inner;
  const systemReduced = useAppReducedMotion();
  const reduce = systemReduced || document.documentElement.dataset.reducedMotion === 'true';

  const t = useMotionValue(on ? 1 : 0);
  const viaPointer = useRef(false);
  const instant = useRef(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const cfg = useRef({ doneOpacity, strikeLag });

  const write = (value: number) => {
    const style = rowRef.current?.style;
    if (!style) return;
    const r = readings(value, cfg.current.doneOpacity, cfg.current.strikeLag);
    style.setProperty('--sc-fill-scale', String(r.fill));
    style.setProperty('--sc-box-scale', String(r.box));
    style.setProperty('--sc-mark-offset', String(r.tick));
    style.setProperty('--sc-label-opacity', String(r.word));
    style.setProperty('--sc-strike-scale', String(r.rule));
  };
  useMotionValueEvent(t, 'change', write);
  useLayoutEffect(() => {
    cfg.current = { doneOpacity, strikeLag };
    write(t.get());
  });

  useEffect(() => {
    const target = on ? 1 : 0;
    if (reduce || instant.current) {
      instant.current = false;
      t.jump(target);
      return undefined;
    }
    if (t.get() === target && t.getVelocity() === 0) return undefined;
    const controls = animate(t, target, {
      type: 'spring',
      visualDuration: VISUAL_DURATION,
      bounce: 1 - zetaOf(bounce)
    });
    return () => controls.stop();
  }, [on, reduce, bounce, t]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled) return;
    viaPointer.current = true;
    if (!reduce && rowRef.current) rowRef.current.dataset.pressed = '';
  };
  const handlePointerUp = () => {
    if (rowRef.current) delete rowRef.current.dataset.pressed;
  };
  const handlePointerCancel = () => {
    viaPointer.current = false;
    handlePointerUp();
  };
  const toggle = () => {
    if (disabled) return;
    instant.current = !viaPointer.current;
    viaPointer.current = false;
    const next = !on;
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const r = readings(t.get(), doneOpacity, strikeLag);
  return (
    <button
      ref={rowRef}
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`spring-check${className ? ` ${className}` : ''}`}
      data-strike={strike}
      style={{
        '--sc-ink': color,
        '--sc-fill': fillColor,
        '--sc-check': checkColor,
        '--sc-box': boxSize === undefined ? undefined : `${boxSize}px`,
        '--sc-radius': boxRadius === undefined ? undefined : `${boxRadius}px`,
        '--sc-font': fontSize === undefined ? undefined : `${fontSize}px`,
        '--sc-ring': boxSize !== undefined && boxSize < 24 ? 'var(--spring-check-compact-ring)' : undefined,
        '--sc-custom-gap': boxSize === undefined ? undefined : `${Math.round(boxSize * 0.43)}px`,
        '--sc-custom-strike': fontSize === undefined ? undefined : `${Math.round(fontSize / 6) / 2}px`,
        '--sc-fill-scale': r.fill,
        '--sc-box-scale': r.box,
        '--sc-mark-offset': r.tick,
        '--sc-label-opacity': r.word,
        '--sc-strike-scale': r.rule,
      } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onClick={toggle}
    >
      <span className="spring-check__press">
        <span className="spring-check__box">
          <span className="spring-check__ring" aria-hidden="true" />
          <span className="spring-check__fill" />
          <svg className="spring-check__tick" viewBox="0 0 24 24" aria-hidden="true">
            <path className="spring-check__mark" d={TICK_PATH} pathLength={1} />
            {mixed && <path d={MINUS_PATH} stroke="var(--sc-ink)" />}
          </svg>
        </span>
      </span>
      <span className="spring-check__label">
        <span className="spring-check__word">
          {label}
        </span>
        {strike !== 'none' ? (
          <span className="spring-check__rule" aria-hidden="true" />
        ) : null}
      </span>
    </button>
  );
};

export default SpringCheck;
