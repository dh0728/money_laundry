import type { FilterCondition, RuleCatalog, RuleCheck, RuleCheckItem, RuleDefinition, RuleItemSpec, RulePathSpec, SidedText, WhereCondition, WhereGroup } from '@/api/rules'
import { formatValue, sideOf, sidedText, templateOf, windowLabel } from '@/features/rules/rule-definition'

const comparisons: Readonly<Record<string, string>> = { GTE: ' 이상', GT: ' 초과', LTE: ' 이하', LT: ' 미만' }
const actions = { ATTACH_EVIDENCE: 'Alert에 근거로 표시합니다', CREATE_ALERT: 'Alert를 생성합니다' }
const labels = { FORMAT: '형식', CONDITIONS: '조건', DATA: '데이터', COST: '실행 비용' }
const blocked = '형식을 먼저 맞춰야 확인할 수 있습니다.'
const number = (value: number | undefined) => value == null ? '?' : formatValue(value)
const validOperator = (op: string) => op === 'ALL' || op === 'ANY'

function checkItem(key: RuleCheckItem['key'], message: string, errors: string[] = []): RuleCheckItem {
  return { key, label: labels[key], ok: errors.length === 0, message: errors[0] ?? message, errors }
}

function invalidFormat(errors: string[]): RuleCheck {
  return {
    items: [checkItem('FORMAT', '', errors), ...(['CONDITIONS', 'DATA', 'COST'] as const).map(key => ({ ...checkItem(key, blocked), ok: false }))],
    warnings: [], canSave: false, canRun: false, sentence: null, summary: null,
  }
}

/** 이름 뒤에 붙는 이/가는 마지막 한글 글자의 받침으로 고른다. */
function subject(name: string) {
  const letter = name.match(/[가-힣](?=[^가-힣]*$)/)?.[0]
  return name + (letter && (letter.charCodeAt(0) - '가'.charCodeAt(0)) % 28 !== 0 ? '이' : '가')
}

function emptyAmountRange(filters: FilterCondition[]) {
  const bounds = filters.filter(item => item.field === 'TX_USD' && item.value != null)
  const lower = Math.max(-Infinity, ...bounds.filter(item => item.cmp === 'GTE' || item.cmp === 'GT').map(item => item.value!))
  const upper = Math.min(Infinity, ...bounds.filter(item => item.cmp === 'LTE' || item.cmp === 'LT').map(item => item.value!))
  return lower > upper || (lower === upper && bounds.some(item => item.value === lower && (item.cmp === 'GT' || item.cmp === 'LT')))
}

/** 편집기 입력만 점검한다. 샘플 원장에 조건을 실행하거나 운영 전이를 계산하지 않는다. */
export function previewRuleCheck(catalog: RuleCatalog, templateKey: string, definition: RuleDefinition, dataMessage: string): RuleCheck {
  const template = templateOf(catalog, templateKey)
  if (!template?.available) return invalidFormat(['쓸 수 없는 템플릿입니다.'])
  if (definition.schema !== catalog.schema || definition.template !== templateKey) return invalidFormat(['룰 정의와 템플릿이 맞지 않습니다.'])
  if (definition.filter?.op !== 'ALL' || !Array.isArray(definition.filter.items)) return invalidFormat(['세는 거래의 구조가 맞지 않습니다.'])
  if (!validOperator(definition.where?.op) || !Array.isArray(definition.where.items)) return invalidFormat(['적중 조건의 구조가 맞지 않습니다.'])

  const format: string[] = [], conditions: string[] = [], cost: string[] = []
  const side = sideOf(template, definition)
  const direction = catalog.directions.find(option => option.key === definition.direction)?.label
  if (template.directionSelectable ? !direction : definition.direction != null) format.push('템플릿의 거래 방향이 맞지 않습니다.')
  if (!catalog.then.find(action => action.key === definition.then)?.enabled || (definition.then === 'CREATE_ALERT' && !template.alert?.allowed)) {
    format.push('이 템플릿에서 고를 수 없는 동작입니다.')
  }

  function checkValue(value: number | undefined, label: string, spec: RuleItemSpec | RulePathSpec, max = spec.max) {
    if (value == null) conditions.push(`‘${label}’ 값이 비어 있습니다.`)
    else if (!Number.isFinite(value)) format.push(`‘${label}’ 값이 숫자가 아닙니다.`)
    else if (spec.type === 'int' && !Number.isInteger(value)) conditions.push(`‘${label}’ 값은 정수여야 합니다.`)
    else if ((spec.min != null && value < spec.min) || (max != null && value > max)) {
      const bounds = [spec.min == null ? '' : `${number(spec.min)} 이상`, max == null ? '' : `${number(max)} 이하`].filter(Boolean).join(' · ')
      conditions.push(`‘${label}’ 값은 허용 범위(${bounds})에 있어야 합니다.`)
    }
  }

  function renderCondition(item: FilterCondition | WhereCondition, inGroup = false) {
    const filter = 'field' in item
    const key = filter ? item.field : item.metric
    const spec = (filter ? catalog.filterFields : catalog.metrics)[key] as (RuleItemSpec & { phrase?: SidedText }) | undefined
    if (!spec || !(filter ? template?.filterFields : template?.metrics)?.includes(key)) {
      format.push(`이 템플릿에 쓸 수 없는 항목입니다: ${key}`)
      return ''
    }
    const label = sidedText(spec.label, side)
    if (filter && inGroup && spec.anyGroup === false) format.push(`‘${label}’ 조건은 하나만 맞는 묶음에 넣을 수 없습니다.`)
    if (spec.kind === 'flag') {
      if (item.cmp != null || item.value != null) format.push(`‘${label}’ 조건은 비교와 값을 갖지 않습니다.`)
      return sidedText(spec.phrase ?? spec.label, side)
    }
    if (!(spec.comparators ?? catalog.comparators).includes(item.cmp ?? '')) format.push(`‘${label}’ 조건의 비교가 허용 목록에 없습니다.`)
    checkValue(item.value, label, spec)
    const value = number(item.value) + (spec.unit === 'USD' ? ' USD' : spec.unit ?? '')
    return item.cmp === 'WITHIN' ? `금액이 검사 거래 금액의 ±${value} 안` : `${subject(label)} ${value}${comparisons[item.cmp ?? ''] ?? ''}`
  }

  const countedFields: FilterCondition[] = [], allFields: FilterCondition[] = []
  let filterGroups = 0
  const filterText = definition.filter.items.map(item => {
    if ('field' in item) {
      countedFields.push(item)
      allFields.push(item)
      return renderCondition(item)
    }
    filterGroups++
    if (item.op !== 'ANY' || !Array.isArray(item.items)) { format.push('세는 거래의 묶음 구조가 맞지 않습니다.'); return '' }
    if (!item.items.length) conditions.push('세는 거래에 빈 묶음이 있습니다.')
    allFields.push(...item.items)
    const text = item.items.map(condition => renderCondition(condition, true)).filter(Boolean).join(' 또는 ')
    return text ? `(${text})` : ''
  }).filter(Boolean).join('이고 ')
  if (filterGroups > 1) format.push('세는 거래에는 묶음을 하나만 둘 수 있습니다.')
  if (allFields.length > catalog.limits.filterConditions) format.push(`세는 거래는 조건 ${catalog.limits.filterConditions}개까지 둘 수 있습니다.`)
  for (const key of template.requiredFilterFields ?? []) {
    if (!countedFields.some(item => item.field === key)) conditions.push(`세는 거래에 ‘${sidedText(catalog.filterFields[key].label, side)}’ 조건이 필요합니다.`)
  }
  const seenFields = new Set<string>()
  for (const { field } of allFields) {
    const spec = catalog.filterFields[field]
    if (seenFields.has(field) && (spec?.kind === 'flag' || spec?.comparators?.length === 1)) {
      conditions.push(`‘${sidedText(spec.label, side)}’ 조건이 두 번 들어 있습니다.`)
    }
    seenFields.add(field)
  }
  if (emptyAmountRange(countedFields)) conditions.push('건당 금액의 하한이 상한보다 작아야 합니다.')

  let metrics = 0
  function renderMetrics(group: WhereGroup, depth = 1): string {
    if (!validOperator(group.op) || !Array.isArray(group.items) || depth > catalog.limits.whereDepth) {
      format.push('적중 조건의 묶음 구조가 맞지 않습니다.')
      return ''
    }
    if (depth > 1 && !group.items.length) conditions.push('적중 조건에 빈 묶음이 있습니다.')
    const parts = group.items.map(item => {
      if ('op' in item) return renderMetrics(item, depth + 1)
      metrics++
      return renderCondition(item)
    }).filter(Boolean)
    const text = parts.join(group.op === 'ANY' ? '이거나 ' : '이고 ')
    return depth > 1 && parts.length > 1 ? `(${text})` : text
  }
  const metricText = renderMetrics(definition.where)
  if (metrics > catalog.limits.whereConditions) format.push(`적중 조건은 ${catalog.limits.whereConditions}개까지 둘 수 있습니다.`)
  if (metrics < (template.whereMin ?? 0)) conditions.push(`적중 조건이 ${template.whereMin}개 이상 필요합니다.`)

  const window = definition.windowMinutes
  const period = window == null ? '' : windowLabel(window)
  const cap = template.maxWindowMinutes
  const costNotes = [period ? `기간 ${period}${cap == null ? '' : ` · 상한 ${windowLabel(cap)}`}` : '기간 없이 거래 1건씩 봅니다.']
  if (template.windowRequired ? window == null || !catalog.windows.includes(window) : window != null) format.push('템플릿에서 고를 수 없는 기간입니다.')
  if (cap != null && window != null && window > cap) cost.push(`이 템플릿의 기간은 ${windowLabel(cap)}까지입니다.`)

  let pathText = ''
  if (template.evaluator === 'PATH') {
    const path = definition.path
    if (path?.stepRatioMin == null || path.stepRatioMax == null) format.push('이어지는 두 거래의 금액 비 범위를 채워야 합니다.')
    for (const key of Object.keys(catalog.path) as (keyof typeof catalog.path)[]) {
      const spec = catalog.path[key]
      checkValue(path?.[key], sidedText(spec.label, template.key), spec, key === 'maxHops' ? Infinity : spec.max)
    }
    const { minHops, maxHops, stepRatioMin, stepRatioMax } = path ?? {}
    if (stepRatioMin != null && stepRatioMax != null && stepRatioMin >= stepRatioMax) conditions.push('금액 비의 하한이 상한보다 작아야 합니다.')
    if (minHops != null && maxHops != null && minHops > maxHops) conditions.push('최소 거래 수는 최대 거래 수 이하여야 합니다.')
    if (maxHops != null) {
      const max = catalog.path.maxHops.max
      if (max != null && maxHops > max) cost.push(`따라가는 최대 거래 수는 ${max}건까지입니다.`)
      costNotes.push(`경로 최대 ${number(maxHops)}건`)
    }
    const chain = `금액 비 ${number(stepRatioMin)} ~ ${number(stepRatioMax)}로 이어진 거래`
    const hops = `${number(minHops)}건 이상(${number(maxHops)}건까지 따라감)`
    pathText = template.key === 'CYCLE' ? `${chain} ${hops}이 출발 계좌로 돌아오면` : `${chain}가 ${hops}이면`
  } else if (definition.path != null) format.push('이 템플릿은 경로 값을 쓰지 않습니다.')

  if (format.length) return invalidFormat(format)
  const action = actions[definition.then]
  const counted = filterText ? `${direction ? `${direction} 가운데 ` : ''}${filterText}인 거래만` : direction ? `${direction}을 모두` : '모든 거래를'
  const match = pathText ? `${period} 안에 ${pathText}` : `한 ${template.subjectLabel}에서 ${period} 안에 ${metricText || '(적중 조건 없음)'}이면`
  const sentence = template.subject === 'TX' ? `${filterText ? `${filterText}인 ` : ''}거래가 들어오면 ${action}.` : `${counted} 세어, ${match} ${action}.`
  const items = [checkItem('FORMAT', '템플릿 · 항목 · 구조가 맞습니다.'),
    checkItem('CONDITIONS', '값이 모두 채워졌고 범위 안입니다.', conditions),
    checkItem('DATA', dataMessage), checkItem('COST', costNotes.join(' · '), cost)]
  return { items, warnings: [], canSave: true, canRun: items.every(item => item.ok), sentence,
    summary: [direction, filterText, metricText || pathText, period].filter(Boolean).join(' · ') }
}
