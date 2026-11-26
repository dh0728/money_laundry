// React Bits BellToggle, adapted from the provided source. See ../react-bits-LICENSE.md.
'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useAppReducedMotion } from '@/hooks/use-reduced-motion';
import { Bell } from 'lucide-react';
import './BellToggle.css';

const SPRING_UI = { type: 'spring', duration: 0.3, bounce: 0 };
const SEG_EASE = 'cubic-bezier(0.77, 0, 0.175, 1)';
const WARP = 0.6;
const WOBBLE = { amplitude: 0.4, passes: 3, duration: 420 };
const BELL_BODY = 'M6 16.5V10a6 6 0 0 1 12 0v6.5l1.6 2.3H4.4L6 16.5z';

const passOffset = (k, passes) => 1 - Math.pow(1 - (k + 2 / 3) / (passes + 1), WARP);
const ringKeyframes = (from, amplitude, passes, decay) => {
  const frames = [{ transform: `rotate(${from}deg)`, offset: 0, easing: SEG_EASE }];
  for (let k = 0; k < passes; k++) {
    const angle = amplitude * Math.pow(1 - k / passes, decay) * (k % 2 ? 1 : -1);
    frames.push({ transform: `rotate(${angle.toFixed(2)}deg)`, offset: passOffset(k, passes), easing: SEG_EASE });
  }
  frames.push({ transform: 'rotate(0deg)', offset: 1 });
  return frames;
};
const liveAngle = el => {
  const tf = getComputedStyle(el).transform;
  if (!tf || tf === 'none') return 0;
  const m = new DOMMatrix(tf);
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
};

export default function BellToggle({
  offLabel = 'Notify me',
  onLabel = "You'll be notified",
  icon,
  label,
  color,
  background,
  onColor,
  onBackground,
  size = 'md',
  radius,
  ringAmplitude = 17,
  ringPasses = 5,
  ringDecay = 1,
  ringDuration = 820,
  ringPivot = 16,
  crossfadeMs,
  revealBounce = 0,
  count = 0,
  badge = true,
  badgeColor,
  badgeTextColor,
  waves = true,
  clapper = false,
  pressed,
  defaultPressed = false,
  onChange,
  disabled = false,
  reducedMotion = false,
  ringOnKeyboard = false,
  className = ''
}) {
  const [inner, setInner] = useState(defaultPressed);
  const on = pressed ?? inner;
  const systemReducedMotion = useAppReducedMotion();
  const reduce = reducedMotion || systemReducedMotion;
  const rootRef = useRef(null);
  const glyphRef = useRef(null);
  const clapperRef = useRef(null);
  const waveLeft = useRef(null);
  const waveRight = useRef(null);
  const offRef = useRef(null);
  const onRef = useRef(null);
  const lastInput = useRef('pointer');
  const pending = useRef(null);
  const spring = useRef(null);
  const prevCount = useRef(count);

  const t = useMotionValue(on ? 1 : 0);
  const wOff = useMotionValue(0);
  const wOn = useMotionValue(0);
  const clip = useTransform([t, wOff, wOn], ([v, a, b]) => `${Math.max(a, b) - (a + (b - a) * v)}px`);

  useLayoutEffect(() => {
    const measure = () => {
      if (offRef.current) wOff.set(offRef.current.offsetWidth);
      if (onRef.current) wOn.set(onRef.current.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (offRef.current) observer.observe(offRef.current);
    if (onRef.current) observer.observe(onRef.current);
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [offLabel, onLabel, size]);

  const swing = (amplitude, passes, duration) => {
    const el = glyphRef.current;
    if (!el) return;
    el.getAnimations().forEach(a => a.cancel());
    el.animate(ringKeyframes(liveAngle(el), amplitude, passes, ringDecay), { duration, easing: 'linear' });
    const c = clapperRef.current;
    if (c) {
      c.getAnimations().forEach(a => a.cancel());
      c.animate(ringKeyframes(liveAngle(c), amplitude * 1.6, passes, ringDecay), {
        duration,
        delay: 70,
        easing: 'linear'
      });
    }
    if (!waves) return;
    for (let k = 0; k < passes; k++) {
      const side = k % 2 ? waveRight.current : waveLeft.current;
      if (!side) continue;
      const strength = Math.pow(1 - k / passes, ringDecay);
      side.animate(
        [
          { opacity: 0, transform: 'scale(0.55)' },
          { opacity: 0.9 * strength, offset: 0.3 },
          { opacity: 0, transform: 'scale(1.25)' }
        ],
        { duration: 380, delay: passOffset(k, passes) * duration, easing: 'ease-out' }
      );
    }
  };

  useLayoutEffect(() => {
    const input = pending.current;
    const pointer = input === 'pointer' && !reduce;
    pending.current = null;
    spring.current?.stop();
    if (pointer) spring.current = animate(t, on ? 1 : 0, { ...SPRING_UI, bounce: revealBounce });
    else t.jump(on ? 1 : 0);
    if (on && !reduce && (pointer || (ringOnKeyboard && input === 'keyboard'))) swing(ringAmplitude, ringPasses, ringDuration);
  }, [on]);
  useLayoutEffect(() => () => spring.current?.stop(), []);
  useLayoutEffect(() => {
    if (!reduce) return;
    spring.current?.stop();
    t.jump(on ? 1 : 0);
    for (const ref of [glyphRef, clapperRef, waveLeft, waveRight]) {
      ref.current?.getAnimations().forEach(animation => animation.cancel());
    }
  }, [reduce, on, t]);


  useEffect(() => {
    const was = prevCount.current;
    prevCount.current = count;
    if (count > was && on && !reduce) swing(ringAmplitude * WOBBLE.amplitude, WOBBLE.passes, WOBBLE.duration);
  }, [count]);

  const toggle = () => {
    pending.current = lastInput.current;
    if (pressed === undefined) setInner(!on);
    onChange?.(!on);
  };
  const press = e => {
    lastInput.current = 'pointer';
    if (e.button === 0 && !disabled && !reduce && rootRef.current) rootRef.current.dataset.pressed = '';
  };
  const release = () => {
    if (rootRef.current) delete rootRef.current.dataset.pressed;
  };
  const key = e => {
    if (e.key === 'Enter' || e.key === ' ') lastInput.current = 'keyboard';
  };

  const showBadge = badge && on && count > 0;

  return (
    <motion.span
      ref={rootRef}
      className={`bell-toggle${className ? ` ${className}` : ''}`}
      data-on={on ? 'true' : 'false'}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      data-motion-reduced={reduce || undefined}
      style={{
        '--bt-clip': clip,
        '--bt-color': color,
        '--bt-bg': background,
        '--bt-on-color': onColor,
        '--bt-on-bg': onBackground,
        '--bt-badge': badgeColor,
        '--bt-badge-ink': badgeTextColor,
        '--bt-radius': typeof radius === 'number' ? `${radius}px` : radius,
        '--bt-fade': crossfadeMs == null ? undefined : `${crossfadeMs}ms`,
        '--bt-pivot': `${ringPivot}%`
      }}
    >
      <button
        type="button"
        className="bell-toggle__button"
        aria-pressed={on}
        aria-label={label ?? offLabel}
        disabled={disabled}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onKeyDown={key}
        onClick={toggle}
      >
        <span className="bell-toggle__bell" aria-hidden="true">
          <span ref={glyphRef} className="bell-toggle__glyph">
            {clapper ? (
              <svg
                className="bell-toggle__body"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={BELL_BODY} />
                <path d="M12 2.5V4" />
              </svg>
            ) : (
              (icon ?? <Bell />)
            )}
          </span>
          {clapper ? (
            <span ref={clapperRef} className="bell-toggle__clapper">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="20.4" fill="currentColor" />
              </svg>
            </span>
          ) : null}
          {waves ? (
            <>
              <svg ref={waveLeft} className="bell-toggle__wave bell-toggle__wave--left" viewBox="0 0 14 14">
                <path d="M14 8a6 6 0 0 0-6 6" />
                <path d="M14 4A10 10 0 0 0 4 14" />
              </svg>
              <svg ref={waveRight} className="bell-toggle__wave bell-toggle__wave--right" viewBox="0 0 14 14">
                <path d="M0 8a6 6 0 0 1 6 6" />
                <path d="M0 4a10 10 0 0 1 10 10" />
              </svg>
            </>
          ) : null}
          {badge ? (
            <span className="bell-toggle__badge" data-show={showBadge ? '' : undefined}>
              <span key={count} className="bell-toggle__digit">
                {count > 9 ? '9+' : count}
              </span>
            </span>
          ) : null}
        </span>
        <span className="bell-toggle__say" aria-hidden="true">
          <span ref={offRef} className="bell-toggle__face bell-toggle__face--off">
            {offLabel}
          </span>
          <span ref={onRef} className="bell-toggle__face bell-toggle__face--on">
            {onLabel}
          </span>
        </span>
      </button>
    </motion.span>
  );
}
