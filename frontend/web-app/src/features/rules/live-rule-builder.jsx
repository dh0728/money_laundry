import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleAlert, Plus, X } from 'lucide-react';
import { createRule, fetchRule, saveRuleDraft, validateRule } from '@/api/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { Panel } from '../../components/panel';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import {
  addFilterAnyGroup, addFilterCondition, addWhereCondition, addWhereGroup, changeDirection, changeFilterCmp, changeFilterField,
  changeFilterValue, changePathValue, changeThen, changeWhereCmp, changeWhereMetric, changeWhereValue, changeWindow, cmpSymbol,
  conditionCount, definitionFromTemplate, formatValue, isGroup, parseValue, removeFilterItem, removeWhereItem, sameDefinition, sideOf,
  sidedText, templateOf, toggleWhereOperator, windowLabel, windowOptions,
} from './rule-definition';
import { codeToRuleId, loadRuleCatalog, problemText, refreshLiveRules } from './live-rule-store';
import { Box, Heading, Text } from '@/components/layout-primitives';
import '../../components/form-dropdown.css';
import './live-rule-engine.css';

// 룰 만들기. 템플릿을 고르면 기본값이 채워지고, IF(세는 거래 · 기간 · 적중 조건) → THEN 을 고쳐 초안으로 저장한다.
// 쓸 수 있는 항목 · 범위 · 기본값은 서버 카탈로그가, 문장과 검토 체크리스트는 서버 검증(validate)이 정한다.

const groupTitles = { PATTERN: '패턴 템플릿', GENERAL: '일반 템플릿' };

function RuleSelect({ label, value, options, onChange }) {
  return <Select value={String(value ?? '')} onValueChange={onChange}>
    <SelectTrigger className="form-dropdown-trigger" aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent className="form-dropdown-options" position="popper" align="start">
      {options.map(option => <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>
        {option.label}
      </SelectItem>)}
    </SelectContent>
  </Select>;
}

/** 숫자 칸. 입력하는 동안에는 적은 글자를 그대로 두고("0." 처럼 쓰다 만 값), 벗어나면 천 단위 쉼표로 보여 준다. */
function ValueField({ label, value, type, onChange }) {
  const [text, setText] = useState(null);
  const shown = text ?? formatValue(value);
  return <Input className="rule-value" inputMode={type === 'int' ? 'numeric' : 'decimal'} aria-label={label} placeholder="값"
    value={shown} aria-invalid={value == null || undefined} size={Math.max(shown.length, 3)}
    onFocus={() => setText(formatValue(value))} onBlur={() => setText(null)}
    onChange={event => {
      const next = event.target.value.replace(type === 'int' ? /[^\d,]/g : /[^\d.,]/g, '').slice(0, 16);
      setText(next);
      onChange(parseValue(next, type));
    }} />;
}

function RemoveButton({ label, onClick }) {
  return <ActionButton className="icon-button rule-row-remove" shape="circle" aria-label={label} title={label} onClick={onClick}>
    <X className="icon" aria-hidden="true" />
  </ActionButton>;
}

/** 조건 줄 사이의 AND / OR. onToggle 이 있으면 눌러서 바꿀 수 있다. */
function Connector({ op, onToggle }) {
  const word = op === 'ANY' ? 'OR' : 'AND';
  return onToggle
    ? <Button type="button" layout="text" className="rule-connector" data-op={word} title="눌러서 AND ↔ OR 바꾸기"
      aria-label={`${word}. 누르면 ${word === 'AND' ? 'OR' : 'AND'} 로 바꿉니다`} onClick={onToggle}>{word}</Button>
    : <Text as="span" className="rule-connector" data-op={word}>{word}</Text>;
}

/** 조건 한 줄: 항목 · 비교 · 값 · 단위. "이면" 꼴 항목은 항목만 고른다. */
function ConditionRow({ kind, condition, specs, comparators, options, side, onItem, onCmp, onValue, onRemove }) {
  const key = condition[kind];
  const spec = specs[key];
  const label = sidedText(spec?.label, side) || key;
  return <Box className="rule-condition" data-rule-condition={key}>
    <RuleSelect label="항목" value={key} options={options} onChange={onItem} />
    {spec?.kind === 'number' ? <>
      {(spec.comparators ?? comparators).length === 1
        ? <Text as="span" className="rule-fixed">{cmpSymbol[condition.cmp] ?? condition.cmp}</Text>
        : <RuleSelect label={`${label} 비교`} value={condition.cmp} onChange={onCmp}
          options={(spec.comparators ?? comparators).map(cmp => ({ value: cmp, label: cmpSymbol[cmp] ?? cmp }))} />}
      <ValueField label={`${label} 값`} value={condition.value} type={spec.type} onChange={onValue} />
      {spec.unit && <Text as="span" className="rule-unit">{spec.unit}</Text>}
    </> : <Text as="span" className="rule-unit">이면</Text>}
    <RemoveButton label={`${label} 조건 지우기`} onClick={onRemove} />
  </Box>;
}

function AddButton({ children, onClick, disabled }) {
  return <ActionButton className="rule-add" shape="pill" disabled={disabled} onClick={onClick}>
    <Plus className="icon" aria-hidden="true" />{children}
  </ActionButton>;
}

/** 그룹 하나의 줄들. 줄 사이에 AND / OR 를 놓는다. */
function ConditionLines({ group, onToggle, render }) {
  return <Box as="ol" className="rule-lines">
    {group.items.map((item, index) => <Box as="li" key={index}>
      {index > 0 && <Connector op={group.op} onToggle={onToggle} />}
      {render(item, index)}
    </Box>)}
  </Box>;
}

function Part({ title, note, children }) {
  return <Box as="section" className="rule-part" aria-label={title}>
    <Box as="header"><Heading level={3}>{title}</Heading>{note && <Text className="workflow-rule-note">{note}</Text>}</Box>
    {children}
  </Box>;
}

function FilterPart({ catalog, template, definition, side, change }) {
  const fields = template.filterFields ?? [];
  const full = conditionCount(definition.filter) >= catalog.limits.filterConditions;
  const options = inAny => fields.filter(field => !inAny || catalog.filterFields[field]?.anyGroup !== false)
    .map(field => ({ value: field, label: sidedText(catalog.filterFields[field]?.label, side) }));
  const row = (condition, path, inAny) => <ConditionRow kind="field" condition={condition} specs={catalog.filterFields} comparators={catalog.comparators} side={side}
    options={options(inAny)}
    onItem={field => change(current => changeFilterField(current, catalog, path, field))}
    onCmp={cmp => change(current => changeFilterCmp(current, path, cmp))}
    onValue={value => change(current => changeFilterValue(current, path, value))}
    onRemove={() => change(current => removeFilterItem(current, path))} />;
  const hasAny = definition.filter.items.some(isGroup);
  return <Part title="세는 거래" note="어떤 거래를 셀지 정합니다. 여기서 걸러진 거래는 세지 않고 근거 거래에도 넣지 않습니다.">
    {template.directionSelectable && <Box className="rule-condition">
      <Text as="span" className="rule-unit">방향</Text>
      <RuleSelect label="거래 방향" value={definition.direction} onChange={direction => change(current => changeDirection(current, direction))}
        options={catalog.directions.map(direction => ({ value: direction.key, label: direction.label }))} />
    </Box>}
    {definition.filter.items.length === 0 && <Text className="rule-empty">조건이 없으면 모든 거래를 셉니다.</Text>}
    <ConditionLines group={definition.filter} render={(item, index) => isGroup(item)
      ? <Box className="rule-group" role="group" aria-label="OR 그룹">
        <ConditionLines group={item} render={(inner, at) => row(inner, [index, at], true)} />
        <Box className="rule-add-row">
          <AddButton disabled={full} onClick={() => change(current => addFilterCondition(current, catalog, [index], options(true)[0].value))}>조건 추가</AddButton>
          <RemoveButton label="OR 그룹 지우기" onClick={() => change(current => removeFilterItem(current, [index]))} />
        </Box>
      </Box>
      : row(item, [index], false)} />
    <Box className="rule-add-row">
      <AddButton disabled={full || !fields.length} onClick={() => change(current => addFilterCondition(current, catalog, [], fields[0]))}>조건 추가</AddButton>
      <AddButton disabled={full || hasAny || !options(true).length}
        onClick={() => change(current => addFilterAnyGroup(current, catalog, options(true)[0].value))}>OR 그룹 추가</AddButton>
    </Box>
  </Part>;
}

function WindowPart({ catalog, template, definition, change }) {
  if (!template.windowRequired) return <Part title="기간"><Text className="rule-empty">기간 없이 거래 1건씩 봅니다.</Text></Part>;
  return <Part title="기간" note="검사하는 거래 시각에서 돌아보는 길이입니다. 룰에 하나만 둡니다.">
    <Box className="rule-condition">
      <RuleSelect label="기간" value={definition.windowMinutes} onChange={minutes => change(current => changeWindow(current, Number(minutes)))}
        options={windowOptions(catalog, template).map(minutes => ({ value: minutes, label: windowLabel(minutes) }))} />
      <Text as="span" className="rule-unit">안에</Text>
    </Box>
  </Part>;
}

/** 경로형(CYCLE · RANDOM)의 길 찾는 값. 지울 수 없는 줄이다. */
function PathLines({ catalog, template, definition, change }) {
  const path = definition.path ?? {};
  const field = key => <ValueField label={sidedText(catalog.path[key].label, template.key)} value={path[key]} type={catalog.path[key].type}
    onChange={value => change(current => changePathValue(current, key, value))} />;
  return <Box as="ol" className="rule-lines" aria-label="경로 조건">
    <Box as="li"><Box className="rule-condition" data-locked>
      <Text as="span" className="rule-fixed-item">{sidedText(catalog.path.minHops.label, template.key)}</Text>
      <Text as="span" className="rule-fixed">≥</Text>{field('minHops')}<Text as="span" className="rule-unit">건</Text>
    </Box></Box>
    <Box as="li"><Connector op="ALL" /><Box className="rule-condition" data-locked>
      <Text as="span" className="rule-fixed-item">이어지는 두 거래의 금액 비</Text>
      {field('stepRatioMin')}<Text as="span" className="rule-unit">~</Text>{field('stepRatioMax')}
    </Box></Box>
    <Box as="li"><Connector op="ALL" /><Box className="rule-condition" data-locked>
      <Text as="span" className="rule-fixed-item">{sidedText(catalog.path.maxHops.label, template.key)}</Text>
      {field('maxHops')}<Text as="span" className="rule-unit">건까지</Text>
    </Box></Box>
  </Box>;
}

function WherePart({ catalog, template, definition, side, change }) {
  const metrics = template.metrics ?? [];
  const pathType = template.evaluator === 'PATH';
  const full = conditionCount(definition.where) >= catalog.limits.whereConditions;
  const options = metrics.map(metric => ({ value: metric, label: sidedText(catalog.metrics[metric]?.label, side) }));
  const row = (condition, path) => <ConditionRow kind="metric" condition={condition} specs={catalog.metrics} comparators={catalog.comparators} side={side} options={options}
    onItem={metric => change(current => changeWhereMetric(current, catalog, path, metric))}
    onCmp={cmp => change(current => changeWhereCmp(current, path, cmp))}
    onValue={value => change(current => changeWhereValue(current, path, value))}
    onRemove={() => change(current => removeWhereItem(current, path))} />;
  return <Part title="적중 조건" note="센 결과가 얼마면 적중인지 정합니다.">
    {pathType && <PathLines catalog={catalog} template={template} definition={definition} change={change} />}
    {!pathType && !metrics.length && <Text className="rule-empty">세는 거래를 통과한 거래가 곧 적중입니다.</Text>}
    {metrics.length > 0 && <>
      <ConditionLines group={definition.where} onToggle={() => change(current => toggleWhereOperator(current, []))}
        render={(item, index) => isGroup(item)
          ? <Box className="rule-group" role="group" aria-label="안쪽 그룹">
            <ConditionLines group={item} onToggle={() => change(current => toggleWhereOperator(current, [index]))}
              render={(inner, at) => row(inner, [index, at])} />
            <Box className="rule-add-row">
              <AddButton disabled={full} onClick={() => change(current => addWhereCondition(current, catalog, [index], metrics[0]))}>조건 추가</AddButton>
              <RemoveButton label="안쪽 그룹 지우기" onClick={() => change(current => removeWhereItem(current, [index]))} />
            </Box>
          </Box>
          : row(item, [index])} />
      <Box className="rule-add-row">
        <AddButton disabled={full} onClick={() => change(current => addWhereCondition(current, catalog, [], metrics[0]))}>조건 추가</AddButton>
        <AddButton disabled={full} onClick={() => change(current => addWhereGroup(current, catalog, metrics[0]))}>그룹 추가</AddButton>
      </Box>
    </>}
  </Part>;
}

function IfThenBlock({ catalog, template, definition, change }) {
  const side = sideOf(template, definition);
  const then = catalog.then.find(option => option.key === definition.then);
  return <Box className="rule-if-then" role="group" aria-label="조건 블록">
    <Box className="rule-clause" data-clause="if">
      <Text as="span" className="rule-keyword">IF</Text>
      <Box className="rule-clause-body">
        <FilterPart catalog={catalog} template={template} definition={definition} side={side} change={change} />
        <WindowPart catalog={catalog} template={template} definition={definition} change={change} />
        <WherePart catalog={catalog} template={template} definition={definition} side={side} change={change} />
      </Box>
    </Box>
    <Box className="rule-clause" data-clause="then">
      <Text as="span" className="rule-keyword">THEN</Text>
      <Box className="rule-clause-body">
        <Box className="rule-condition">
          <RuleSelect label="적중했을 때" value={definition.then} onChange={key => change(current => changeThen(current, key))}
            options={catalog.then.map(option => ({ value: option.key, label: option.enabled ? option.label : `${option.label} (준비 중)`, disabled: !option.enabled }))} />
          <Text as="span" className="rule-unit">{then?.key === 'ATTACH_EVIDENCE' ? '룰은 Alert를 만들지 않고, Alert의 거래와 겹치면 근거로 붙습니다.' : then?.note}</Text>
        </Box>
      </Box>
    </Box>
  </Box>;
}

function TemplateLibrary({ catalog, selected, locked, onPick }) {
  const available = catalog.templates.filter(template => template.available);
  const later = catalog.templates.filter(template => !template.available);
  const card = template => <Box as="li" key={template.key}>
    <Button type="button" layout="choice" className="rule-template-card" aria-pressed={template.key === selected}
      disabled={!template.available || (locked && template.key !== selected)} onClick={() => onPick(template.key)}>
      <Text as="strong">{template.name}</Text>
      <Text as="span">{template.available ? template.shape : template.note}</Text>
    </Button>
  </Box>;
  return <Panel className="rule-template-library" aria-label="템플릿 고르기">
    <Heading>템플릿 고르기</Heading>
    <Text className="workflow-rule-note">{locked ? '저장한 룰의 템플릿은 바꿀 수 없습니다.' : `템플릿 ${available.length}개에서 고르면 기본값이 채워집니다.`}</Text>
    {Object.entries(groupTitles).map(([group, title]) => <Box as="section" key={group} aria-label={title}>
      <Heading level={3}>{title}</Heading>
      <Box as="ul">{available.filter(template => template.group === group).map(card)}</Box>
    </Box>)}
    {later.length > 0 && <Box as="section" aria-label="이후 제공">
      <Heading level={3}>이후 제공</Heading>
      <Box as="ul">{later.map(card)}</Box>
    </Box>}
  </Panel>;
}

// 템플릿이 정해 둔 것만 보여 준다: 대상, 검사 시점, 세는 방식. 값이나 조건을 바꿔도 달라지지 않는 내용이다.
// 카탈로그에는 기본값을 고른 실험의 성능(performance)과 대응하는 업계 시나리오 이름(oracle)도 있지만 화면에는 쓰지 않는다.
// 실제 원장에서는 정답이 없어 잴 수 없는 숫자이고, 값을 고치면 맞지 않는다. 고친 조건의 결과는 백테스트가 보여 준다.
function TemplateFacts({ template }) {
  return <Box as="dl" className="rule-condition-facts rule-template-facts">
    <Box><Box as="dt">대상</Box><Box as="dd">{template.subjectLabel}</Box></Box>
    <Box><Box as="dt">검사 시점</Box><Box as="dd">{template.trigger}</Box></Box>
    {template.note && <Box className="rule-template-wide"><Box as="dt">세는 방식</Box><Box as="dd">{template.note}</Box></Box>}
  </Box>;
}

function Checklist({ check, checking, failure }) {
  return <Panel className="rule-checklist" aria-label="검토 체크리스트">
    <Heading>검토 체크리스트</Heading>
    {failure && <Text role="alert" data-rule-block-error>{failure}</Text>}
    {!check && !failure && <Text className="workflow-rule-note">조건을 확인하는 중입니다.</Text>}
    {check && <>
      <Box as="ul" className="rule-check-items" aria-busy={checking || undefined}>
        {check.items.map(item => <Box as="li" key={item.key} data-ok={item.ok}>
          {item.ok ? <Check className="icon" aria-hidden="true" /> : <CircleAlert className="icon" aria-hidden="true" />}
          <Text as="strong">{item.label}</Text>
          <Text as="span">{item.ok ? item.message : item.errors.length ? item.errors.join(' ') : item.message}</Text>
        </Box>)}
      </Box>
      {check.warnings.length > 0 && <Box as="ul" className="rule-check-warnings" aria-label="경고">
        {check.warnings.map(warning => <Box as="li" key={warning}>{warning}</Box>)}
      </Box>}
      <Text className="workflow-rule-note">{check.canRun ? '네 항목을 모두 통과했습니다.'
        : check.canSave ? '초안으로 저장할 수 있습니다. 백테스트 · 시험 운영 · 승인 요청은 네 항목을 모두 통과해야 합니다.'
          : '형식이 맞지 않아 저장할 수 없습니다.'}</Text>
    </>}
  </Panel>;
}

/** 주소의 ?rule=RULE-003 에서 이어서 작성할 룰 번호를 읽는다. */
const ruleFromAddress = () => codeToRuleId(new URLSearchParams(window.location.search).get('rule'));

export function LiveRuleBuilder({ actionsHost, initialRuleId = ruleFromAddress() }) {
  const [catalog, setCatalog] = useState(null);
  const [loadFailure, setLoadFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [templateKey, setTemplateKey] = useState(null);
  // 템플릿마다 고치던 정의를 따로 들고 있어, 다른 템플릿을 눌렀다 돌아와도 남는다
  const [drafts, setDrafts] = useState({});
  const [name, setName] = useState('');
  // 서버에 저장된 초안. 없으면 아직 만들지 않은 새 룰이다.
  const [saved, setSaved] = useState(null);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkFailure, setCheckFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const formId = useId();
  const sequence = useRef(0);

  useEffect(() => {
    let current = true;
    Promise.all([loadRuleCatalog(), initialRuleId ? fetchRule(initialRuleId) : null]).then(([loaded, rule]) => {
      if (!current) return;
      setCatalog(loaded);
      setLoadFailure('');
      const draft = rule?.working?.editable ? rule.working : null;
      if (rule && !draft) setNotice(`${rule.code} 에는 내가 고칠 수 있는 작성 중 버전이 없습니다. 새 룰을 만듭니다.`);
      if (draft) {
        setTemplateKey(rule.template);
        setDrafts({ [rule.template]: draft.definition });
        setName(rule.name);
        setSaved({ ruleId: rule.ruleId, code: rule.code, versionId: draft.versionId, versionNo: draft.versionNo, revision: draft.revision,
          name: rule.name, definition: draft.definition });
        return;
      }
      const first = loaded.templates.find(template => template.available);
      setTemplateKey(first.key);
      setDrafts({ [first.key]: definitionFromTemplate(first) });
    }, error => {
      if (current) setLoadFailure(problemText(error, '룰 템플릿을 불러오지 못했습니다.'));
    });
    return () => { current = false; };
  }, [initialRuleId, attempt]);

  const template = catalog && templateKey ? templateOf(catalog, templateKey) : null;
  const definition = templateKey ? drafts[templateKey] : null;

  // 조건을 고칠 때마다 0.3초 모아서 검증한다. 늦게 온 응답은 버린다.
  useEffect(() => {
    if (!definition || !templateKey) return undefined;
    const turn = ++sequence.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      validateRule({ template: templateKey, definition, ...(saved && { ruleId: saved.ruleId }) }).then(result => {
        if (turn !== sequence.current) return;
        setCheck(result);
        setCheckFailure('');
        setChecking(false);
      }, error => {
        if (turn !== sequence.current) return;
        // 앞서 받은 결과는 고치기 전 조건의 것이라 지운다. 남겨 두면 다른 조건의 문장과 체크리스트가 지금 것처럼 보인다.
        setCheck(null);
        setCheckFailure(problemText(error, '조건을 확인하지 못했습니다.'));
        setChecking(false);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [definition, templateKey, saved?.ruleId]);

  if (loadFailure) return <Panel className="rule-load-failure">
    <Heading>룰 만들기를 열 수 없습니다.</Heading>
    <Text role="alert">{loadFailure}</Text>
    <ActionButton shape="pill" surface="floating" onClick={() => setAttempt(count => count + 1)}>다시 시도</ActionButton>
  </Panel>;
  if (!catalog || !template || !definition) return <Panel aria-busy="true"><Heading>룰 템플릿을 불러오는 중입니다.</Heading></Panel>;

  const trimmed = name.trim();
  const dirty = !saved || saved.name !== trimmed || !sameDefinition(saved.definition, definition);
  const nameProblem = !trimmed ? '룰 이름을 입력해 주세요.' : trimmed.length > catalog.limits.nameLength ? `룰 이름은 ${catalog.limits.nameLength}자까지입니다.` : '';
  const canSave = dirty && !saving && !nameProblem && check?.canSave === true && !checking;

  const change = update => {
    setDrafts(current => ({ ...current, [templateKey]: update(current[templateKey]) }));
    setFailure('');
  };
  const pick = key => {
    if (saved || key === templateKey) return;
    setDrafts(current => (current[key] ? current : { ...current, [key]: definitionFromTemplate(templateOf(catalog, key)) }));
    setTemplateKey(key);
    setCheck(null);
    setFailure('');
  };

  async function save(event) {
    event?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setFailure('');
    try {
      if (saved) {
        const result = await saveRuleDraft(saved.ruleId, saved.versionId, { name: trimmed, definition, revision: saved.revision });
        setSaved({ ...saved, revision: result.revision, name: result.name, definition });
      } else {
        const result = await createRule({ name: trimmed, template: templateKey, definition });
        setSaved({ ...result, versionNo: 1, name: trimmed, definition });
        // 새로 고쳐도 같은 초안을 이어서 쓰도록 주소에 룰 번호를 남긴다
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?rule=${result.code}`);
      }
      setNotice('');
      void refreshLiveRules();
    } catch (error) {
      setFailure(problemText(error, '룰을 저장하지 못했습니다.'));
    } finally {
      setSaving(false);
    }
  }

  return <Box className="screen-row screen-rule-editor rule-builder">
    <TemplateLibrary catalog={catalog} selected={templateKey} locked={Boolean(saved)} onPick={pick} />
    <Panel className="rule-draft-editor" aria-label="룰 만들기">
      <Box as="header" className="rule-builder-heading">
        <Heading>{saved ? `${saved.code} · v${saved.versionNo} 작성 중` : '새 룰'}</Heading>
        <StatusTag preset="neutral">{template.name}</StatusTag>
      </Box>
      {notice && <Text role="status" className="workflow-rule-note">{notice}</Text>}
      <Box as="form" id={formId} aria-label="룰 작성" className="rule-draft-form" onSubmit={save} noValidate>
        <Box as="label">룰 이름
          <Input name="name" aria-label="룰 이름" value={name} maxLength={catalog.limits.nameLength} placeholder="예: 분산 송금 감시"
            onChange={event => { setName(event.target.value); setFailure(''); }} />
        </Box>
        <TemplateFacts template={template} />
        <IfThenBlock catalog={catalog} template={template} definition={definition} change={change} />
        <Box as="section" className="rule-draft-preview" aria-label="이 룰을 문장으로 읽으면">
          <Heading>이 룰을 문장으로 읽으면</Heading>
          <Text aria-busy={checking || undefined}>{check?.sentence ?? (checkFailure || (check ? '형식이 맞지 않아 문장으로 읽을 수 없습니다.' : '조건을 확인하는 중입니다.'))}</Text>
        </Box>
        {failure && <Text role="alert" data-rule-block-error>{failure}</Text>}
        {saved && !dirty && <Box role="status" className="rule-draft-actions">
          <Text><Text as="strong">{saved.code}</Text> 초안이 저장되었습니다.</Text>
          <ActionButton as="a" href={`/rules?rule=${saved.code}`}>저장한 룰 보기</ActionButton>
          {(catalog.backtestTemplates ?? []).includes(templateKey) && check?.canRun
            && <ActionButton as="a" href={`/rules/backtest?rule=${saved.code}`}>백테스트로 열기</ActionButton>}
        </Box>}
      </Box>
    </Panel>
    <Checklist check={check} checking={checking} failure={checkFailure} />
    <ScreenActions host={actionsHost} stackOnNarrow>
      <PrimaryButton tone="brand" aria-controls={formId} disabled={!canSave} title={nameProblem || undefined}
        onHold={() => void save()}>초안 저장</PrimaryButton>
    </ScreenActions>
  </Box>;
}
