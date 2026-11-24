import React, { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { bindTooltip } from '../components/components.js';
import { previewUrl } from './preview-route.js';
import RubberSegment from '../components/react-bits/RubberSegment';
import './screen-navigation.css';
import { Box, Text } from '../components/layout-primitives';

let root;
let currentNavigation;

function NavigationSegments({ label, items, active, onSelect, reduced, linkTo }) {
  return <RubberSegment
    key={reduced} aria-label={label} size="sm" radius={24} inset={0} equalSlots={false} draggable={false}
    tabThroughInactiveItems
    items={items} value={active} onChange={onSelect} reducedMotion={reduced} linkTo={linkTo}
    trackColor="transparent" thumbColor="var(--selection-surface)"
    textColor="var(--text)" activeTextColor="var(--selection-ink)"
    stretch={30} squash={1} speed={1.2}
  />;
}

function NavGroup({ id, items, label, onRoute, reduced }) {
  function select(value) {
    const host = document.getElementById(id);
    const restoreFocus = host.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const item = items.find(item => item.value === value);
    onRoute(item.destination);
    if (!restoreFocus) return;

    const radios = [...(document.getElementById(id)?.querySelectorAll('[role="radio"]') ?? [])];
    const active = radios.findIndex(radio => radio.getAttribute('aria-checked') === 'true');
    const next = radios[active + 1] ?? radios[active - 1];
    if (next) next.focus();
    else document.getElementById('screen-navigation')?.querySelector('a[aria-current]')?.focus({ preventScroll: true });
  }

  const active = items.find(item => item.active)?.value ?? items[0].value;
  return <Box as="nav" id={id} className="screen-nav-pill segmented-navigation glass" aria-label={label}>
    <NavigationSegments label={label} items={items} active={active} onSelect={select} reduced={reduced} />
  </Box>;
}

function WorkspaceIcons({ items, onRoute, reduced }) {
  const ref = useRef(null);
  useEffect(() => {
    const tooltip = document.getElementById('tooltip');
    const dispose = [...ref.current.querySelectorAll('a')].map(link => bindTooltip(link, tooltip));
    return () => dispose.forEach(unbind => unbind());
  }, [reduced]);
  const active = items.find(item => item.current)?.value ?? '';
  const links = items.map(({ icon: NavIcon, label, value, current }) => ({
    value, current, accessibleLabel: label,
    label: <Text as="span" aria-hidden="true" className="workspace-nav-icon">
      <NavIcon className="icon" aria-hidden="true" />
      <Text as="span" className="workspace-nav-label">{label}</Text>
    </Text>,
  }));
  return <Box as="nav" ref={ref} className="screen-nav-pill segmented-navigation workspace-icon-nav glass" aria-label="주 메뉴">
    <NavigationSegments label="주 메뉴" items={links} active={active} onSelect={onRoute}
      reduced={reduced} linkTo={value => previewUrl({ screen: value })} />
  </Box>;
}

export function WorkspaceNavigation({ global = [], location, primary, secondary = [], onRoute, reduced }) {
  const showLocation = location?.text && (location.record || !global.some(item => item.current));
  return <>
    {global.length > 0 && <WorkspaceIcons items={global} onRoute={onRoute} reduced={reduced} />}
    {showLocation && <Text as="span" className="screen-location" data-record={location.record || undefined}>
      <Text as="span" className="screen-title-accessible">현재 위치 </Text>
      {location.record ? <Text as="code">{location.text}</Text> : location.text}
    </Text>}
    {primary.length > 0 && <NavGroup id="screen-sections" label="세부 화면" items={primary} onRoute={onRoute} reduced={reduced} />}
    {secondary.length > 0 && <NavGroup id="screen-views" label="보기 방식" items={secondary} onRoute={onRoute} reduced={reduced} />}
  </>;
}

export function refreshScreenNav() {
  if (!currentNavigation) return;
  const host = document.getElementById('screen-navigation');
  root ??= createRoot(host);
  const [groups, onRoute] = currentNavigation;
  host.hidden = !(groups.global?.length || groups.location?.text || groups.primary.length || groups.secondary?.length);
  flushSync(() => root.render(<WorkspaceNavigation {...groups} onRoute={onRoute}
    reduced={document.documentElement.dataset.reducedMotion === 'true'} />));
}

export function renderScreenNav(groups, onRoute) {
  currentNavigation = [groups, onRoute];
  refreshScreenNav();
}
