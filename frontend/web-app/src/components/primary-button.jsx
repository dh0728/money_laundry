import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus } from 'lucide-react';
import { bindTooltip, buttonPresentation } from './components.js';
import HoldButton from './react-bits/HoldButton';
import StarBorder from './react-bits/StarBorder';
import { hasWorkTab, subscribeToWorkTabs } from '../app/work-tab-state';
import './primary-button.css';
import './work-tab-add-button.css';

export function ActionButton({ as: Tag = 'button', className = '', shape, surface = 'ghost', type = 'button', ...buttonProps }) {
  return <Tag {...buttonPresentation({ className, shape, surface, type })}
    type={Tag === 'button' ? type : undefined} {...buttonProps} />;
}

export function WorkTabAddButton({ code, className = '', disabled, inline = false, ...buttonProps }) {
  const button = useRef(null);
  const added = useSyncExternalStore(subscribeToWorkTabs, () => hasWorkTab(code));
  useEffect(() => {
    if (added || disabled) return;
    return bindTooltip(button.current, document.getElementById('tooltip'), { instantOnHover: true });
  }, [added, disabled]);
  if (added) return null;
  return <ActionButton ref={button}
    className={`icon-button work-tab-add ${inline ? 'work-tab-add--inline' : ''} ${className}`.trim()}
    data-add-work-tab="" surface={inline ? 'ghost' : 'floating'} shape={inline ? 'corner' : 'circle'}
    disabled={disabled} data-work-code={code} aria-label="사이드바 탭으로 추가"
    aria-description={code} {...buttonProps}>
    <Plus className="icon" aria-hidden="true" />
  </ActionButton>;
}

export function PrimaryButton({ children, className = '', disabled, radius, style, tone, onClick, onHold, ...buttonProps }) {
  const buttonStyle = {
    borderRadius: radius == null ? undefined : Math.max(0, radius),
    ...style,
  };
  if (tone === 'brand' || tone === 'positive' || tone === 'negative') {
    return <AccentButton tone={tone} className={className} disabled={disabled} radius={radius} style={style}
      activation={onHold ? 'hold' : 'press'} onHold={onHold} onClick={onClick} {...buttonProps}>{children}</AccentButton>;
  }
  return <ActionButton className={`screen-primary glass ${className}`} shape="pill" surface="floating"
    disabled={disabled} style={buttonStyle} onClick={onClick} {...buttonProps}>{children}</ActionButton>;
}

function AccentButton({ tone = 'brand', activation = 'hold', radius = 'var(--aml-radius-full)',
  className = '', children, doneLabel = children, disabled = false, onClick, onHold, ...props }) {
  const needsHold = activation === 'hold' && tone !== 'brand';
  const ink = `var(--action-${tone}-ink)`;
  return <StarBorder as="span" className="accent-action" aria-disabled={disabled || undefined}
    color="var(--aml-white-100)" trailLength={0.26} thickness={1.5} glow={0.38}
    backgroundColor="transparent" borderColor="transparent" radius={typeof radius === 'number' ? radius : 999}>
    <HoldButton className={`screen-primary screen-primary--${tone} ${className}`.trim()}
      size="sm" radius={radius} activation={needsHold ? 'hold' : 'press'} disabled={disabled}
      onHold={needsHold ? onHold : undefined} onClick={needsHold ? undefined : onClick ?? onHold}
      backgroundColor={`var(--action-${tone}-face)`} textColor={ink}
      fillColor={`var(--action-${tone}-edge)`} fillTextColor={ink}
      holdTime={2000} resetAfter={250} pressScale={1} glow={false} doneLabel={doneLabel}
      title={!disabled && needsHold ? '2초 동안 길게 누르기' : undefined} {...props}>{children}</HoldButton>
  </StarBorder>;
}

export function ConfirmHoldButton(props) {
  return <AccentButton {...props} />;
}

export function mountLoginPrimary(host) {
  createRoot(host).render(
    <PrimaryButton id="preview-sign-in" className="login-action" tone="brand" type="submit">로그인</PrimaryButton>
  );
}
