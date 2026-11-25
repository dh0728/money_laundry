import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BranchedMenu from '../../components/react-bits/BranchedMenu';
import { bindTooltip } from '../../components/components';
import { LiveRuleBuilder } from './live-rule-builder';
import { Panel } from '../../components/panel';

const rules = [
  { label: '거래 패턴', children: [
    { label: '분할 송금', value: 'split' }, { label: '단기 반복 송금', value: 'repeat' },
  ] },
  { label: '계좌 관계', children: [
    { label: '다수 계좌 유입', value: 'fan-in' }, { label: '다수 계좌 유출', value: 'fan-out' },
  ] },
];

// Adapted from the React Bits CometDial arc geometry for two ordered thresholds.
const start = 150;
const sweep = 240;
function point(value) {
  const radians = (start + value / 100 * sweep) * Math.PI / 180;
  return [100 + Math.cos(radians) * 78, 100 + Math.sin(radians) * 78];
}
function arc(low, high) {
  const [x, y] = point(low);
  const [endX, endY] = point(high);
  return `M ${x} ${y} A 78 78 0 ${(high - low) * sweep > 18000 ? 1 : 0} 1 ${endX} ${endY}`;
}

export function RiskDial({ embedded = false } = {}) {
  const [thresholds, setThresholds] = useState([40, 75]);
  const title = useId();
  const face = useRef(null);
  useEffect(() => {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip) return undefined;
    const unbind = [...face.current.querySelectorAll('[data-risk-tooltip]')].map(trigger => bindTooltip(trigger, tooltip));
    return () => unbind.forEach(remove => remove());
  }, []);
  function update(which, value) {
    setThresholds(([amber, red]) => which === 0
      ? [Math.max(1, Math.min(red - 1, value)), red]
      : [amber, Math.max(amber + 1, Math.min(99, value))]);
  }
  function move(event, which) {
    const bounds = event.currentTarget.parentElement.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const relative = (Math.atan2(y, x) * 180 / Math.PI - start + 720) % 360;
    const percent = relative > (sweep + 360) / 2 ? 0 : Math.round(relative / sweep * 100);
    update(which, percent);
  }
  const labels = ['관심 시작 점수', '고위험 시작 점수'];
  return <Panel embedded={embedded} className="risk-dial"
    aria-label={embedded ? '모델 위험도 기준' : undefined} aria-labelledby={embedded ? undefined : title}>
    {!embedded && <>
      <h2 id={title}>위험 구간</h2>
      <p className="workflow-rule-note">경계점을 움직여 관심·고위험 구간을 비교합니다.</p>
    </>}
    <div className="risk-dial-face" ref={face}>
      <svg aria-hidden="true" viewBox="0 0 200 200">
        {[[0, thresholds[0], 'low'], [thresholds[0], thresholds[1], 'medium'], [thresholds[1], 100, 'high']].map(([a, b, band]) =>
          <path key={band} data-band={band} d={arc(a, b)} fill="none" strokeWidth="9" />)}
      </svg>
      <div className="risk-dial-readouts" aria-hidden="true">
        {thresholds.map((value, i) => <span key={labels[i]} data-risk-tooltip
          data-band={i === 0 ? 'low' : 'high'} aria-label={labels[i]}>{value}</span>)}
      </div>
      {thresholds.map((value, i) => {
        const [x, y] = point(value);
        const min = i === 0 ? 1 : thresholds[0] + 1;
        const max = i === 0 ? thresholds[1] - 1 : 99;
        return <span key={i} className="risk-dial-thumb" role="slider" tabIndex={0}
          data-risk-tooltip
          aria-label={labels[i]} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}점`}
          style={{ left: `${x / 2}%`, top: `${y / 2}%` }}
          onKeyDown={event => {
            const next = {
              ArrowLeft: value - 1, ArrowDown: value - 1, ArrowRight: value + 1, ArrowUp: value + 1,
              Home: min, End: max,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            update(i, next);
          }}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event, i); }} />;
      })}
    </div>
  </Panel>;
}

export function RuleTemplateMenu() {
  const [selected, setSelected] = useState('');
  return <>
    <BranchedMenu items={rules} color="var(--text)" accentColor="var(--text)" lineColor="var(--muted-text)"
      width={220} className="rule-template-menu" onSelect={(_, item) => setSelected(item.label)} />
    {selected && <p role="status">선택한 템플릿 · {selected}</p>}
  </>;
}

export function mountRuleControls(workspace, actionsHost) {
  const targets = [...workspace.querySelectorAll('[data-rule-editor], [data-rule-template], [data-risk-dial]')];
  const roots = targets.map(node => {
    const root = createRoot(node);
    // 룰 만들기는 서버에 붙였든 아니든 같은 화면이다. 서버가 없으면 @/api/rules 가 샘플 카탈로그를 준다.
    root.render(node.hasAttribute('data-rule-editor') ? <LiveRuleBuilder actionsHost={actionsHost} />
      : node.hasAttribute('data-risk-dial') ? <RiskDial /> : <RuleTemplateMenu />);
    return root;
  });
  return () => roots.forEach(root => root.unmount());
}
