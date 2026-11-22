import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import BranchedMenu from '../../components/react-bits/BranchedMenu';
import { bindTooltip } from '../../components/components';
import { RuleConditionBlocks } from '@/next/features/RuleConditionBlocks';
import { compileRuleBlocks, ruleBlocksFor, validateRule } from '@/next/features/rules-logic';
import { previewRuleTemplates, savePreviewRule } from './preview-rule-workspace';
import { RuleConditionFacts, RuleTreeBranches } from './rule-condition-tree';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { Panel } from '../../components/panel';
import { ScreenActions } from '../../components/screen-actions';
import '../../components/form-dropdown.css';

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

const blankDraft = { name: '', description: '', typeCode: null, scoreMin: .7, minTransactions: 2, windowHours: 24 };

function RuleSelect({ label, value, onChange, options }) {
  return <Select value={value == null ? '' : String(value)} onValueChange={onChange}>
    <SelectTrigger size="sm" className="form-dropdown-trigger" aria-label={label}>
      <SelectValue placeholder={`${label} 선택`} />
    </SelectTrigger>
    <SelectContent position="popper" align="start" className="form-dropdown-options">
      {options.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

function RuleDraft({ actionsHost }) {
  const [draft, setDraft] = useState(blankDraft);
  const [blocks, setBlocks] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState('');
  const errorId = useId();
  const form = useRef(null);
  const input = compileRuleBlocks(draft, blocks);
  const problems = validateRule(input);
  const errors = submitted ? problems : {};
  const hasInvalidCondition = problems.scoreMin || problems.minTransactions || problems.windowHours;

  function changeDraft(next) {
    setDraft(next);
    setDirty(true);
    setFailure('');
  }

  function submit(event) {
    event.preventDefault();
    setSubmitted(true);
    setFailure('');
    if (Object.keys(problems).length) {
      const fields = [...event.currentTarget.querySelectorAll('[name]')];
      fields.find(field => Object.hasOwn(problems, field.name))?.focus();
      return;
    }
    if (!blocks.length) {
      setFailure('조건 블록을 하나 이상 추가해 주세요.');
      return;
    }
    const applied = result => {
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setSaved(result.value);
      setDirty(false);
    };
    // 서비스 모드는 서버 응답을 기다린다.
    const result = savePreviewRule({ ...input, name: input.name.trim(), description: input.description.trim() }, saved?.id);
    if (result instanceof Promise) void result.then(applied);
    else applied(result);
  }

  return <div className="screen-row screen-rule-editor">
    <Panel className="rule-draft-reference">
      <h2>템플릿 고르기</h2>
      <p className="workflow-rule-note">템플릿 {previewRuleTemplates.length}개에서 이름과 조건을 불러올 수 있습니다.</p>
      <RuleSelect label="룰 템플릿" options={previewRuleTemplates.map(rule => ({ label: rule.name, value: rule.id }))}
        onChange={value => {
          const template = previewRuleTemplates.find(rule => rule.id === value);
          if (!template) return;
          setDraft(template);
          setBlocks(ruleBlocksFor(template));
          setSubmitted(false);
          setSaved(null);
          setFailure('');
        }} />
      <section className="rule-draft-preview" aria-label="작성한 조건 미리 보기">
        <h2>작성한 조건 미리 보기</h2>
        {input.name.trim() && <h3>{input.name.trim()}</h3>}
        {input.description.trim() && <p>{input.description.trim()}</p>}
        {!blocks.length ? <p>조건 블록을 추가해 주세요.</p> :
          hasInvalidCondition ? <p>조건 값을 확인해 주세요.</p> : <RuleConditionFacts input={input} blocks={blocks} />}
      </section>
    </Panel>
    <Panel className="rule-draft-editor">
      <h2>룰 만들기</h2>
      <form ref={form} id={`${errorId}-form`} aria-label="룰 작성" className="rule-draft-form" onSubmit={submit} noValidate>
        <label>룰 이름
          <Input name="name" aria-label="룰 이름" value={draft.name} maxLength={80}
            onChange={event => changeDraft({ ...draft, name: event.target.value })}
            aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${errorId}-name` : undefined} />
          {errors.name && <span id={`${errorId}-name`} data-rule-block-error>{errors.name}</span>}
        </label>
        <label>목적과 근거
          <Textarea name="description" aria-label="목적과 근거" value={draft.description} maxLength={1000} rows={2}
            onChange={event => changeDraft({ ...draft, description: event.target.value })}
            aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? `${errorId}-description` : undefined} />
          {errors.description && <span id={`${errorId}-description`} data-rule-block-error>{errors.description}</span>}
        </label>
        <RuleConditionBlocks input={draft} blocks={blocks} errors={errors} scoreAsPoints button={ActionButton}
          renderBranches={(children, finalSlot) => children.length ? <RuleTreeBranches finalSlot={finalSlot}>{children}</RuleTreeBranches> : finalSlot}
          renderTypePicker={({ onChange, ...picker }) => <RuleSelect {...picker} label="거래 유형" onChange={value => onChange(Number(value))} />}
          onInputChange={changeDraft} onBlocksChange={next => {
            setBlocks(next);
            setDirty(true);
            setFailure('');
          }} />
        {failure && <p role="alert" data-rule-block-error>{failure}</p>}
        {saved && !dirty && <div role="status" className="rule-draft-actions">
          <p><strong>{saved.id}</strong> 초안이 저장되었습니다.</p>
          <ActionButton as="a" href={`/rules?rule=${saved.id}`}>저장한 룰 보기</ActionButton>
          <ActionButton as="a" href={`/rules/backtest?rule=${saved.id}`}>백테스트로 열기</ActionButton>
        </div>}
      </form>
    </Panel>
    <ScreenActions host={actionsHost} stackOnNarrow>
      <PrimaryButton tone="brand" aria-controls={`${errorId}-form`} onHold={() => form.current.requestSubmit()}>초안 저장</PrimaryButton>
    </ScreenActions>
  </div>;
}

export function mountRuleControls(workspace, actionsHost) {
  const targets = [...workspace.querySelectorAll('[data-rule-editor], [data-rule-template], [data-risk-dial]')];
  const roots = targets.map(node => {
    const root = createRoot(node);
    root.render(node.hasAttribute('data-rule-editor') ? <RuleDraft actionsHost={actionsHost} />
      : node.hasAttribute('data-risk-dial') ? <RiskDial /> : <RuleTemplateMenu />);
    return root;
  });
  return () => roots.forEach(root => root.unmount());
}
