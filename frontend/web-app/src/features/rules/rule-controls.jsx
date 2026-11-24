import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import BranchedMenu from '../../components/react-bits/BranchedMenu';
import { bindTooltip } from '../../components/components';
import { RuleConditionBlocks } from '@/features/rules/RuleConditionBlocks';
import { compileRuleBlocks, RULE_LIMITS, ruleBlocksFor, validateRule } from '@/features/rules/rules-logic';
import { ruleRepository } from './rule-repository';
import { useRules } from './use-rules';
import { RuleConditionFacts, RuleTreeBranches } from './rule-condition-tree';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { Panel } from '../../components/panel';
import { ScreenActions } from '../../components/screen-actions';
import '../../components/form-dropdown.css';
import { Box, Heading, Text } from '@/components/layout-primitives';

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
      <Heading id={title}>위험 구간</Heading>
      <Text className="workflow-rule-note">경계점을 움직여 관심·고위험 구간을 비교합니다.</Text>
    </>}
    <Box className="risk-dial-face" ref={face}>
      <svg aria-hidden="true" viewBox="0 0 200 200">
        {[[0, thresholds[0], 'low'], [thresholds[0], thresholds[1], 'medium'], [thresholds[1], 100, 'high']].map(([a, b, band]) =>
          <path key={band} data-band={band} d={arc(a, b)} fill="none" strokeWidth="9" />)}
      </svg>
      <Box className="risk-dial-readouts" aria-hidden="true">
        {thresholds.map((value, i) => <Text as="span" key={labels[i]} data-risk-tooltip
          data-band={i === 0 ? 'low' : 'high'} aria-label={labels[i]}>{value}</Text>)}
      </Box>
      {thresholds.map((value, i) => {
        const [x, y] = point(value);
        const min = i === 0 ? 1 : thresholds[0] + 1;
        const max = i === 0 ? thresholds[1] - 1 : 99;
        return <Text as="span" key={i} className="risk-dial-thumb" role="slider" tabIndex={0}
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
    </Box>
  </Panel>;
}

export function RuleTemplateMenu() {
  const [selected, setSelected] = useState('');
  return <>
    <BranchedMenu items={rules} color="var(--text)" accentColor="var(--text)" lineColor="var(--muted-text)"
      width={220} className="rule-template-menu" onSelect={(_, item) => setSelected(item.label)} />
    {selected && <Text role="status">선택한 템플릿 · {selected}</Text>}
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

function RuleDraft({ actionsHost, sourceRule, repository = ruleRepository }) {
  const { rules: templates } = useRules(repository);
  const [draft, setDraft] = useState(blankDraft);
  const [blocks, setBlocks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
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

  useEffect(() => {
    if (!sourceRule) return undefined;
    let live = true;
    void repository.duplicateDraft(sourceRule).then(result => {
      if (!live) return;
      if (!result.ok) {
        setFailure(`${sourceRule} 룰을 복제할 수 없습니다. ${result.error}`);
        return;
      }
      setDraft({ ...blankDraft, ...result.value });
      setBlocks(ruleBlocksFor(result.value));
      setCopied(sourceRule);
    });
    return () => { live = false; };
  }, [repository, sourceRule]);

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
    if (busy) return;
    setBusy(true);
    void repository.save({ ...input, name: input.name.trim(), description: input.description.trim() }, saved?.id).then(result => {
      setBusy(false);
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setSaved(result.value);
      setDirty(false);
    }, () => {
      setBusy(false);
      setFailure('초안을 저장하지 못했습니다. 다시 시도해 주세요.');
    });
  }

  return <Box className="screen-row screen-rule-editor">
    <Panel className="rule-draft-reference">
      <Heading>템플릿 고르기</Heading>
      <Text className="workflow-rule-note">템플릿 {templates.length}개에서 이름과 조건을 불러올 수 있습니다.</Text>
      {copied && <Text className="workflow-rule-note" role="status"><Text as="code">{copied}</Text> 조건을 복제했습니다. 저장하면 새 초안이 됩니다.</Text>}
      <RuleSelect label="룰 템플릿" options={templates.map(rule => ({ label: rule.name, value: rule.id }))}
        onChange={value => {
          const template = templates.find(rule => rule.id === value);
          if (!template) return;
          setDraft(template);
          setBlocks(ruleBlocksFor(template));
          setSubmitted(false);
          setSaved(null);
          setFailure('');
        }} />
      <Box as="section" className="rule-draft-preview" aria-label="작성한 조건 미리 보기">
        <Heading>작성한 조건 미리 보기</Heading>
        {input.name.trim() && <Heading level={3}>{input.name.trim()}</Heading>}
        {input.description.trim() && <Text>{input.description.trim()}</Text>}
        {!blocks.length ? <Text>조건 블록을 추가해 주세요.</Text> :
          hasInvalidCondition ? <Text>조건 값을 확인해 주세요.</Text> : <RuleConditionFacts input={input} blocks={blocks} />}
      </Box>
    </Panel>
    <Panel className="rule-draft-editor">
      <Heading>룰 만들기</Heading>
      <Box as="form" ref={form} id={`${errorId}-form`} aria-label="룰 작성" className="rule-draft-form" onSubmit={submit} noValidate>
        <Box as="label">룰 이름
          <Input name="name" aria-label="룰 이름" value={draft.name} maxLength={RULE_LIMITS.name}
            onChange={event => changeDraft({ ...draft, name: event.target.value })}
            aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${errorId}-name` : undefined} />
          {errors.name && <Text as="span" id={`${errorId}-name`} data-rule-block-error>{errors.name}</Text>}
        </Box>
        <Box as="label">목적과 근거
          <Textarea name="description" aria-label="목적과 근거" value={draft.description} maxLength={RULE_LIMITS.description} rows={2}
            onChange={event => changeDraft({ ...draft, description: event.target.value })}
            aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? `${errorId}-description` : undefined} />
          {errors.description && <Text as="span" id={`${errorId}-description`} data-rule-block-error>{errors.description}</Text>}
        </Box>
        <RuleConditionBlocks input={draft} blocks={blocks} errors={errors} scoreAsPoints
          renderBranches={(children, finalSlot) => children.length ? <RuleTreeBranches finalSlot={finalSlot}>{children}</RuleTreeBranches> : finalSlot}
          renderTypePicker={({ onChange, ...picker }) => <RuleSelect {...picker} label="거래 유형" onChange={value => onChange(Number(value))} />}
          onInputChange={changeDraft} onBlocksChange={next => {
            setBlocks(next);
            setDirty(true);
            setFailure('');
          }} />
        {failure && <Text role="alert" data-rule-block-error>{failure}</Text>}
        {saved && !dirty && <Box role="status" className="rule-draft-actions">
          <Text><Text as="code">{saved.id}</Text> 초안이 저장되었습니다.</Text>
          <ActionButton as="a" href={`/rules?rule=${saved.id}`}>저장한 룰 보기</ActionButton>
          <ActionButton as="a" href={`/rules/backtest?rule=${saved.id}`}>백테스트로 열기</ActionButton>
        </Box>}
      </Box>
    </Panel>
    <ScreenActions host={actionsHost} stackOnNarrow>
      <PrimaryButton tone="brand" aria-controls={`${errorId}-form`} disabled={busy} aria-busy={busy || undefined}
        onClick={() => form.current.requestSubmit()}>{busy ? '저장 중…' : '초안 저장'}</PrimaryButton>
    </ScreenActions>
  </Box>;
}

export function mountRuleControls(workspace, actionsHost, { sourceRule } = {}) {
  const targets = [...workspace.querySelectorAll('[data-rule-editor], [data-rule-template], [data-risk-dial]')];
  const roots = targets.map(node => {
    const root = createRoot(node);
    root.render(node.hasAttribute('data-rule-editor') ? <RuleDraft actionsHost={actionsHost} sourceRule={sourceRule} />
      : node.hasAttribute('data-risk-dial') ? <RiskDial /> : <RuleTemplateMenu />);
    return root;
  });
  return () => roots.forEach(root => root.unmount());
}
