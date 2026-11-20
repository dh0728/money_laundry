import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, BellOff } from 'lucide-react';
import BellToggle from './react-bits/BellToggle';

const preferenceKey = 'aml-live-layout-inbox-sample-notices';
let deliveryEnabled = true;
try {
  deliveryEnabled = localStorage.getItem(preferenceKey) !== 'off';
} catch {
  // Storage may be blocked. Keep the preference for the current page.
}

export function receivesSampleNotifications() {
  return deliveryEnabled;
}

export function NotificationPreference({ demo = false }) {
  const [enabled, setEnabled] = useState(demo || deliveryEnabled);
  const [reduced, setReduced] = useState(() => document.documentElement.dataset.reducedMotion === 'true');

  useEffect(() => {
    const syncAppearance = () => setReduced(document.documentElement.dataset.reducedMotion === 'true');
    document.addEventListener('aml:appearance', syncAppearance);
    return () => document.removeEventListener('aml:appearance', syncAppearance);
  }, []);

  function toggle(next) {
    setEnabled(next);
    if (demo) return;
    deliveryEnabled = next;
    try {
      localStorage.setItem(preferenceKey, next ? 'on' : 'off');
    } catch {
      // The in-memory preference still controls the current page.
    }
  }

  const Icon = enabled ? Bell : BellOff;
  return <BellToggle offLabel="꺼짐" onLabel="켜짐" label="보관함 알림"
    pressed={enabled} onChange={toggle} icon={<Icon className="icon" aria-hidden="true" />}
    size="sm" radius={16} background="var(--switch-off-track)" color="var(--text)"
    onBackground="var(--switch-on-track)" onColor="var(--selection-ink)"
    reducedMotion={reduced} ringOnKeyboard crossfadeMs={reduced ? 0 : 200}
    ringAmplitude={22} ringDuration={700} badge={false} />;
}

export function mountNotificationPreference(host) {
  createRoot(host).render(<NotificationPreference />);
}
