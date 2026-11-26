import type { FilterCondition, FilterItem, RuleCatalog, RuleDefinition, RuleItemSpec, RuleTemplate, SidedText, WhereCondition, WhereGroup, WhereItem } from '@/api/rules'

// 룰 정의(JSON)를 화면에서 고치는 함수. 원본을 바꾸지 않고 새 정의를 돌려준다.
// 정의의 모양과 허용 항목은 서버 카탈로그(GET /rule-templates)가 정한다. 여기서는 모양만 다루고 검증은 서버(validate)가 한다.

/** 조건의 자리. 맨 위 그룹의 i번째면 [i], 그 안 그룹의 j번째면 [i, j]. */
export type ItemPath = readonly number[]

export const cmpSymbol: Record<string, string> = { GTE: '≥', GT: '>', LTE: '≤', LT: '<', EQ: '=', WITHIN: '±' }

export const isGroup = (item: FilterItem | WhereItem): item is WhereGroup => 'op' in item

export const templateOf = (catalog: RuleCatalog, key: string): RuleTemplate | undefined => catalog.templates.find(template => template.key === key)

/** 템플릿을 처음 골랐을 때의 정의 */
export function definitionFromTemplate(template: RuleTemplate): RuleDefinition {
  return { schema: 2, template: template.key, ...structuredClone(template.defaults!) }
}

/** 대상 계좌가 거래의 어느 쪽인가. 방향을 고르는 템플릿은 정의의 direction 을 따른다. */
export function sideOf(template: RuleTemplate, definition: RuleDefinition): 'FROM' | 'TO' {
  if (template.directionSelectable) return definition.direction === 'IN' ? 'TO' : 'FROM'
  return template.side ?? 'FROM'
}

/** 문구가 대상 쪽(FROM/TO)이나 템플릿(CYCLE/RANDOM)에 따라 갈리면 key 에 맞는 것을 고른다. */
export function sidedText(text: SidedText | undefined, key: string): string {
  if (text == null) return ''
  if (typeof text === 'string') return text
  return (text as Record<string, string>)[key] ?? Object.values(text)[0] ?? ''
}

/** 분을 "1시간", "24시간", "3일" 로 읽는다. 서버의 RuleSentence.window 와 같은 규칙이다. */
export function windowLabel(minutes: number): string {
  if (minutes > 1440 && minutes % 1440 === 0) return `${minutes / 1440}일`
  if (minutes % 60 === 0) return `${minutes / 60}시간`
  return `${minutes}분`
}

/** 이 템플릿에서 고를 수 있는 기간. 템플릿 상한을 넘는 기간은 뺀다. */
export function windowOptions(catalog: RuleCatalog, template: RuleTemplate): number[] {
  const max = template.maxWindowMinutes ?? Infinity
  return catalog.windows.filter(minutes => minutes <= max)
}

/** 항목을 처음 넣거나 다른 항목으로 바꿨을 때의 조건. 값은 비워 둔다. */
function blank<K extends 'field' | 'metric'>(kind: K, key: string, spec: RuleItemSpec | undefined, comparators: string[]): Record<K, string> & { cmp?: string } {
  const condition = { [kind]: key } as Record<K, string> & { cmp?: string }
  if (spec?.kind === 'number') condition.cmp = (spec.comparators ?? comparators)[0]
  return condition
}
export const blankFilterCondition = (catalog: RuleCatalog, field: string): FilterCondition => blank('field', field, catalog.filterFields[field], catalog.comparators)
export const blankWhereCondition = (catalog: RuleCatalog, metric: string): WhereCondition => blank('metric', metric, catalog.metrics[metric], catalog.comparators)

// ── 그룹 안의 항목 고치기 ───────────────────────────────────────────────
type Group<T> = { op: string; items: (T | Group<T>)[] }

function editItems<T>(group: Group<T>, path: ItemPath, edit: (items: (T | Group<T>)[], index: number) => (T | Group<T>)[]): Group<T> {
  const [index, ...rest] = path
  if (rest.length === 0) return { ...group, items: edit([...group.items], index) }
  const child = group.items[index]
  if (child == null || !('op' in (child as object))) return group
  return { ...group, items: group.items.map((item, at) => (at === index ? editItems(item as Group<T>, rest, edit) : item)) }
}

function groupAt<T>(group: Group<T>, path: ItemPath): Group<T> | undefined {
  let current: Group<T> | undefined = group
  for (const index of path) {
    const child: T | Group<T> | undefined = current?.items[index]
    current = child != null && 'op' in (child as object) ? (child as Group<T>) : undefined
  }
  return current
}

const replaceAt = <T>(patch: (item: T | Group<T>) => T | Group<T>) => (items: (T | Group<T>)[], index: number) => items.map((item, at) => (at === index ? patch(item) : item))
const removeAt = <T>(items: (T | Group<T>)[], index: number) => items.filter((_, at) => at !== index)
const appendTo = <T>(group: Group<T>, groupPath: ItemPath, item: T | Group<T>): Group<T> =>
  groupPath.length === 0 ? { ...group, items: [...group.items, item] } : editItems(group, groupPath, replaceAt(child => ({ ...(child as Group<T>), items: [...(child as Group<T>).items, item] })))

/** 값을 비우면 value 키를 없앤다(서버가 저장하는 모양과 같다). */
function withValue<T extends { value?: number }>(condition: T, value: number | null): T {
  const next = { ...condition }
  if (value == null) delete next.value
  else next.value = value
  return next
}

// ── 세는 거래 ───────────────────────────────────────────────────────────
type Filter = RuleDefinition['filter']
const withFilter = (definition: RuleDefinition, filter: Group<FilterCondition>): RuleDefinition => ({ ...definition, filter: filter as Filter })
const filterGroup = (definition: RuleDefinition) => definition.filter as Group<FilterCondition>

/** groupPath 가 [] 면 맨 위(AND), [i] 면 그 OR 그룹에 조건을 넣는다. */
export const addFilterCondition = (definition: RuleDefinition, catalog: RuleCatalog, groupPath: ItemPath, field: string) =>
  withFilter(definition, appendTo(filterGroup(definition), groupPath, blankFilterCondition(catalog, field)))
/** 세는 거래에는 OR 그룹을 하나만 둘 수 있다. 이미 있으면 그대로 둔다. */
export const addFilterAnyGroup = (definition: RuleDefinition, catalog: RuleCatalog, field: string) =>
  definition.filter.items.some(isGroup) ? definition
    : withFilter(definition, appendTo(filterGroup(definition), [], { op: 'ANY', items: [blankFilterCondition(catalog, field)] }))
export const removeFilterItem = (definition: RuleDefinition, path: ItemPath) => withFilter(definition, editItems(filterGroup(definition), path, removeAt))
/** 다른 항목으로 바꾸면 비교와 값은 그 항목의 처음 상태로 돌아간다. */
export const changeFilterField = (definition: RuleDefinition, catalog: RuleCatalog, path: ItemPath, field: string) =>
  withFilter(definition, editItems(filterGroup(definition), path, replaceAt(() => blankFilterCondition(catalog, field))))
export const changeFilterCmp = (definition: RuleDefinition, path: ItemPath, cmp: string) =>
  withFilter(definition, editItems(filterGroup(definition), path, replaceAt(item => ({ ...(item as FilterCondition), cmp }))))
export const changeFilterValue = (definition: RuleDefinition, path: ItemPath, value: number | null) =>
  withFilter(definition, editItems(filterGroup(definition), path, replaceAt(item => withValue(item as FilterCondition, value))))

// ── 적중 조건 ───────────────────────────────────────────────────────────
const withWhere = (definition: RuleDefinition, where: Group<WhereCondition>): RuleDefinition => ({ ...definition, where: where as WhereGroup })
const whereGroup = (definition: RuleDefinition) => definition.where as Group<WhereCondition>

export const addWhereCondition = (definition: RuleDefinition, catalog: RuleCatalog, groupPath: ItemPath, metric: string) =>
  withWhere(definition, appendTo(whereGroup(definition), groupPath, blankWhereCondition(catalog, metric)))
/** 맨 위 그룹과 반대인 연결(AND ↔ OR)의 안쪽 그룹을 넣는다. 그룹은 한 단계까지만 둔다. */
export const addWhereGroup = (definition: RuleDefinition, catalog: RuleCatalog, metric: string) =>
  withWhere(definition, appendTo(whereGroup(definition), [], { op: definition.where.op === 'ALL' ? 'ANY' : 'ALL', items: [blankWhereCondition(catalog, metric)] }))
export const removeWhereItem = (definition: RuleDefinition, path: ItemPath) => withWhere(definition, editItems(whereGroup(definition), path, removeAt))
export const changeWhereMetric = (definition: RuleDefinition, catalog: RuleCatalog, path: ItemPath, metric: string) =>
  withWhere(definition, editItems(whereGroup(definition), path, replaceAt(() => blankWhereCondition(catalog, metric))))
export const changeWhereCmp = (definition: RuleDefinition, path: ItemPath, cmp: string) =>
  withWhere(definition, editItems(whereGroup(definition), path, replaceAt(item => ({ ...(item as WhereCondition), cmp }))))
export const changeWhereValue = (definition: RuleDefinition, path: ItemPath, value: number | null) =>
  withWhere(definition, editItems(whereGroup(definition), path, replaceAt(item => withValue(item as WhereCondition, value))))
/** 조건 줄 사이의 AND ↔ OR 를 바꾼다. groupPath 가 [] 면 맨 위 그룹, [i] 면 그 안쪽 그룹이다. */
export function toggleWhereOperator(definition: RuleDefinition, groupPath: ItemPath): RuleDefinition {
  const flip = (op: string) => (op === 'ALL' ? 'ANY' : 'ALL')
  if (groupPath.length === 0) return withWhere(definition, { ...whereGroup(definition), op: flip(definition.where.op) })
  if (!groupAt(whereGroup(definition), groupPath)) return definition
  return withWhere(definition, editItems(whereGroup(definition), groupPath, replaceAt(item => ({ ...(item as Group<WhereCondition>), op: flip((item as Group<WhereCondition>).op) }))))
}

// ── 기간 · 방향 · 경로 값 · THEN ────────────────────────────────────────
export const changeWindow = (definition: RuleDefinition, windowMinutes: number): RuleDefinition => ({ ...definition, windowMinutes })
export const changeDirection = (definition: RuleDefinition, direction: 'IN' | 'OUT'): RuleDefinition => ({ ...definition, direction })
export const changeThen = (definition: RuleDefinition, then: RuleDefinition['then']): RuleDefinition => ({ ...definition, then })
export function changePathValue(definition: RuleDefinition, key: keyof NonNullable<RuleDefinition['path']>, value: number | null): RuleDefinition {
  const path = { ...definition.path }
  if (value == null) delete path[key]
  else path[key] = value
  return { ...definition, path }
}

/** 조건 수(그룹 안 포함). 서버 상한(세는 거래 10, 적중 조건 10)에 닿았는지 볼 때 쓴다. */
export const conditionCount = (group: { items: (FilterItem | WhereItem)[] }): number =>
  group.items.reduce((count, item) => count + (isGroup(item) ? conditionCount(item) : 1), 0)

/** 고친 내용이 있는가. 정의는 키 순서까지 화면이 만든 그대로라 문자열로 비교해도 된다. */
export const sameDefinition = (a: RuleDefinition, b: RuleDefinition) => JSON.stringify(a) === JSON.stringify(b)

/** 입력 칸의 글자를 숫자로. 빈 칸과 숫자가 아닌 글자는 null. 소수는 type 이 decimal 인 항목만 받는다. */
export function parseValue(text: string, type: 'int' | 'decimal' | undefined): number | null {
  const cleaned = text.replace(/,/g, '').trim()
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return type === 'int' ? Math.trunc(value) : value
}

export const formatValue = (value: number | undefined) => (value == null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 8 }))
