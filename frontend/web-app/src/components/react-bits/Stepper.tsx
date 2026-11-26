'use client';

import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Check as CheckIcon } from 'lucide-react';
import { appReducedMotion } from '@/hooks/use-reduced-motion';
import './Stepper.css';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface StepProps {
  children?: ReactNode;
  title?: ReactNode;
}

interface StepperProps {
  children: ReactNode;
  step: number;
  transition: 'fade' | 'none';
}

interface StepView {
  step: number;
  previous: number | null;
  id: number;
}

const readNumber = (styles: CSSStyleDeclaration, token: string) => Number.parseFloat(styles.getPropertyValue(token));

function StepCheck() {
  const ref = useRef<HTMLSpanElement>(null);
  useIsomorphicLayoutEffect(() => {
    const path = ref.current?.querySelector('path');
    if (!path || typeof path.animate !== 'function' || appReducedMotion()) return;
    const styles = getComputedStyle(path);
    const dash = readNumber(styles, '--stepper-check-dash');
    path.style.setProperty('--stepper-check-active-dash', 'var(--stepper-check-dash)');
    path.animate([{ strokeDashoffset: dash }, { strokeDashoffset: 0 }], {
      duration: readNumber(styles, '--stepper-draw-duration'),
      easing: styles.getPropertyValue('--stepper-settle').trim(),
    });
  }, []);

  return <span ref={ref} className="stepper__check">
    <CheckIcon className="icon icon-compact" strokeWidth="var(--stepper-check-stroke)" aria-hidden="true" />
  </span>;
}

export function Step({ children }: StepProps) {
  return <div className="stepper__step">{children}</div>;
}

export default function Stepper({ children, step, transition }: StepperProps) {
  const steps = Children.toArray(children).filter(isValidElement) as ReactElement<StepProps>[];
  const total = steps.length;
  const current = Math.min(Math.max(1, Math.round(step)), total + 1);
  const hasTitles = steps.some(entry => entry.props.title);
  const [tight, setTight] = useState(false);
  const [view, setView] = useState<StepView>({ step: current, previous: null, id: 0 });
  if (view.step !== current) {
    setView({ step: current, previous: view.step, id: view.id + 1 });
  }

  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gliderRef = useRef<HTMLSpanElement>(null);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const labelWidths = useRef<number[]>([]);
  const tightRef = useRef(tight);
  const placedRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    tightRef.current = tight;
  }, [tight]);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track || !hasTitles) return;
    const measure = () => {
      const segments = markerRefs.current.slice(0, total);
      let badges = 0;
      for (const [index, segment] of segments.entries()) {
        if (!segment) continue;
        const styles = getComputedStyle(segment);
        const title = titleRefs.current[index];
        const badge = segment.firstElementChild;
        badges += (badge?.getBoundingClientRect().width ?? readNumber(styles, '--stepper-badge-size')) +
          Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
        if (!tightRef.current) {
          labelWidths.current[index] = title && segment.contains(title)
            ? title.scrollWidth + Number.parseFloat(styles.columnGap) : 0;
        }
      }
      const labels = labelWidths.current.slice(0, total).reduce((sum, width) => sum + (width || 0), 0);
      const styles = getComputedStyle(track);
      const room = track.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight) -
        Number.parseFloat(styles.columnGap) * Math.max(0, total - 1);
      setTight(badges + labels > room + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [hasTitles, total]);

  useIsomorphicLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    heightRef.current = viewport.offsetHeight;
    const observer = new ResizeObserver(() => {
      heightRef.current = viewport.offsetHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (view.id === 0) return;
    const viewport = viewportRef.current;
    const pane = paneRef.current;
    const leaving = leavingRef.current;
    const id = view.id;
    const finish = () => setView(state => state.id === id ? { ...state, previous: null } : state);
    if (leaving && pane && leaving.contains(document.activeElement)) pane.focus({ preventScroll: true });
    if (!viewport || typeof viewport.animate !== 'function' || transition === 'none') {
      finish();
      return;
    }
    for (const element of [viewport, pane, leaving]) element?.getAnimations().forEach(animation => animation.cancel());
    const styles = getComputedStyle(viewport);
    const reduced = appReducedMotion();
    const from = heightRef.current;
    const to = viewport.offsetHeight;
    if (Math.abs(from - to) > 0.5) {
      viewport.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: readNumber(styles, reduced ? '--stepper-fade-short' : '--stepper-spring-duration'),
        easing: styles.getPropertyValue(reduced ? '--stepper-settle' : '--stepper-spring').trim(),
      });
    }
    pane?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], {
      duration: readNumber(styles, '--stepper-enter-duration'),
      easing: 'ease-out',
    });
    if (leaving) {
      leaving.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: readNumber(styles, '--stepper-leave-duration'),
        easing: 'cubic-bezier(0.2, 0, 0.4, 1)',
        fill: 'forwards',
      });
      const exit = leaving.animate([{ transform: 'none' }, { transform: 'translateX(0px)' }], {
        duration: readNumber(styles, '--stepper-fade-short'),
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
      });
      exit.onfinish = finish;
    } else finish();
  }, [view.id]);

  useIsomorphicLayoutEffect(() => {
    const track = trackRef.current;
    const glider = gliderRef.current;
    if (!track || !glider) return;
    const place = (animate: boolean) => {
      const segment = markerRefs.current[Math.min(current, total) - 1];
      if (!segment) return;
      glider.toggleAttribute('data-spring', animate);
      glider.toggleAttribute('data-active', current <= total);
      glider.style.setProperty('--stepper-glider-x', `${segment.offsetLeft}px`);
      glider.style.setProperty('--stepper-glider-y', `${segment.offsetTop}px`);
      glider.style.setProperty('--stepper-glider-width', `${segment.offsetWidth}px`);
      glider.style.setProperty('--stepper-glider-height', `${segment.offsetHeight}px`);
    };
    place(placedRef.current && !appReducedMotion());
    placedRef.current = true;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(track);
    return () => observer.disconnect();
  }, [current, total, hasTitles, tight]);

  return <div ref={rootRef} className="stepper stepper--horizontal" data-completed={current > total ? '' : undefined}>
    <div className="stepper__header stepper__header--numbers">
      <div ref={trackRef} className="stepper__track" data-layout="row">
        <span ref={gliderRef} className="stepper__glider" aria-hidden="true" />
        {steps.map((entry, index) => {
          const number = index + 1;
          const status = number < current ? 'complete' : number === current ? 'active' : 'upcoming';
          const title = entry.props.title;
          return <button key={number} ref={element => { markerRefs.current[index] = element; }}
            type="button" className="stepper__segment" data-status={status} disabled
            aria-label={typeof title === 'string' ? `${number}단계 ${title}` : `${number}단계`}
            aria-current={number === current ? 'step' : undefined}>
            <span className="stepper__badge" data-status={status}>{status === 'complete' ? <StepCheck /> : number}</span>
            {title && !tight && <span className="stepper__text">
              <span ref={element => { titleRefs.current[index] = element; }} className="stepper__title" data-status={status}>{title}</span>
            </span>}
          </button>;
        })}
      </div>
    </div>
    <div className="stepper__body">
      <div ref={viewportRef} className="stepper__viewport" aria-live="polite">
        {view.previous !== null && <div key={view.id - 1} ref={leavingRef} className="stepper__pane stepper__pane--leaving" aria-hidden="true">
          {steps[view.previous - 1]}
        </div>}
        <div key={view.id} ref={paneRef} className="stepper__pane" tabIndex={-1}>{steps[view.step - 1]}</div>
      </div>
    </div>
  </div>;
}
