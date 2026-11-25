import { expect, it } from 'vitest'
import type { RuleDefinition } from '@/api/rules'
import {
  addFilterAnyGroup, addFilterCondition, addWhereCondition, addWhereGroup, changeDirection, changeFilterField, changeFilterValue, changePathValue,
  changeWhereCmp, changeWhereMetric, changeWhereValue, changeWindow, conditionCount, definitionFromTemplate, formatValue, parseValue,
  removeFilterItem, removeWhereItem, sameDefinition, sideOf, sidedText, templateOf, toggleWhereOperator, windowLabel, windowOptions,
} from './rule-definition'
import { catalogFixture as catalog } from './rule-test-fixtures'

const template = (key: string) => templateOf(catalog, key)!
const fanOut = () => definitionFromTemplate(template('FAN_OUT'))
const random = () => definitionFromTemplate(template('RANDOM'))

it('템플릿을 고르면 서버 기본값으로 정의를 만들고 카탈로그는 건드리지 않는다', () => {
  const definition = fanOut()
  expect(definition).toEqual({
    schema: 2, template: 'FAN_OUT', windowMinutes: 10080,
    filter: { op: 'ALL', items: [{ field: 'FIRST_PAIR' }, { field: 'TX_USD', cmp: 'GTE', value: 1000 }] },
    where: { op: 'ALL', items: [{ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE', value: 6 }] },
    then: 'ATTACH_EVIDENCE',
  })
  const edited = changeFilterValue(definition, [1], 5000)
  expect(template('FAN_OUT').defaults!.filter.items[1]).toEqual({ field: 'TX_USD', cmp: 'GTE', value: 1000 })
  expect(definition.filter.items[1]).toEqual({ field: 'TX_USD', cmp: 'GTE', value: 1000 })
  expect(edited.filter.items[1]).toEqual({ field: 'TX_USD', cmp: 'GTE', value: 5000 })
})

it('값을 비우면 value 키를 없애고, 항목을 바꾸면 비교와 값을 그 항목의 처음 상태로 돌린다', () => {
  const emptied = changeWhereValue(fanOut(), [0], null)
  expect(emptied.where.items[0]).toEqual({ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE' })
  expect('value' in emptied.where.items[0]).toBe(false)

  const flag = changeWhereMetric(fanOut(), catalog, [0], 'NO_REPEAT')
  expect(flag.where.items[0]).toEqual({ metric: 'NO_REPEAT' })
  const number = changeFilterField(fanOut(), catalog, [0], 'TX_USD')
  expect(number.filter.items[0]).toEqual({ field: 'TX_USD', cmp: 'GTE' })
  expect(changeWhereCmp(fanOut(), [0], 'GT').where.items[0]).toEqual({ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GT', value: 6 })
})

it('세는 거래에는 OR 그룹을 하나만 두고, 그룹 안팎에 조건을 넣고 뺀다', () => {
  const grouped = addFilterAnyGroup(fanOut(), catalog, 'FX_FOLLOW')
  expect(grouped.filter.items[2]).toEqual({ op: 'ANY', items: [{ field: 'FX_FOLLOW' }] })
  expect(addFilterAnyGroup(grouped, catalog, 'FIRST_PAIR')).toBe(grouped)

  const inner = addFilterCondition(grouped, catalog, [2], 'FIRST_PAIR')
  expect(inner.filter.items[2]).toEqual({ op: 'ANY', items: [{ field: 'FX_FOLLOW' }, { field: 'FIRST_PAIR' }] })
  expect(conditionCount(inner.filter)).toBe(4)
  expect(removeFilterItem(inner, [2, 0]).filter.items[2]).toEqual({ op: 'ANY', items: [{ field: 'FIRST_PAIR' }] })
  expect(removeFilterItem(inner, [2]).filter.items).toHaveLength(2)
  expect(addFilterCondition(fanOut(), catalog, [], 'TX_USD').filter.items.at(-1)).toEqual({ field: 'TX_USD', cmp: 'GTE' })
})

it('적중 조건의 AND ↔ OR 를 맨 위와 안쪽 그룹에서 따로 바꾼다', () => {
  const grouped = addWhereGroup(addWhereCondition(fanOut(), catalog, [], 'TX_COUNT'), catalog, 'SUM_USD')
  expect(grouped.where.items[2]).toEqual({ op: 'ANY', items: [{ metric: 'SUM_USD', cmp: 'GTE' }] })

  const top = toggleWhereOperator(grouped, [])
  expect(top.where.op).toBe('ANY')
  expect(top.where.items[2]).toMatchObject({ op: 'ANY' })
  const inner = toggleWhereOperator(grouped, [2])
  expect(inner.where.op).toBe('ALL')
  expect(inner.where.items[2]).toMatchObject({ op: 'ALL' })
  // 조건 줄은 그룹이 아니라 바꿀 것이 없다
  expect(toggleWhereOperator(grouped, [0])).toBe(grouped)
  // 맨 위가 OR 이면 새 안쪽 그룹은 AND 다
  expect(addWhereGroup(top, catalog, 'TX_COUNT').where.items[3]).toMatchObject({ op: 'ALL' })
  expect(removeWhereItem(grouped, [2]).where.items).toHaveLength(2)
  expect(conditionCount(grouped.where)).toBe(3)
})

it('기간 · 방향 · 경로 값을 바꾸고, 경로 값을 비우면 그 키를 없앤다', () => {
  expect(changeWindow(fanOut(), 1440).windowMinutes).toBe(1440)
  expect(changeDirection(definitionFromTemplate(template('STRUCTURING')), 'IN').direction).toBe('IN')
  expect(changePathValue(random(), 'minHops', 4).path).toEqual({ minHops: 4, maxHops: 12, stepRatioMin: 0.8, stepRatioMax: 1.25 })
  expect(changePathValue(random(), 'maxHops', null).path).toEqual({ minHops: 3, stepRatioMin: 0.8, stepRatioMax: 1.25 })
})

it('고친 내용이 있는지는 정의 전체로 본다', () => {
  expect(sameDefinition(fanOut(), fanOut())).toBe(true)
  expect(sameDefinition(fanOut(), changeWindow(fanOut(), 1440))).toBe(false)
  expect(sameDefinition(fanOut(), changeWhereValue(changeWhereValue(fanOut(), [0], null), [0], 6))).toBe(true)
})

it('대상 계좌의 쪽에 맞는 문구를 고른다', () => {
  const structuring = template('STRUCTURING')
  const out = definitionFromTemplate(structuring)
  expect(sideOf(template('FAN_OUT'), fanOut())).toBe('FROM')
  expect(sideOf(template('RANDOM'), random())).toBe('TO')
  expect(sideOf(structuring, { ...out, direction: 'OUT' } as RuleDefinition)).toBe('FROM')
  expect(sideOf(structuring, { ...out, direction: 'IN' } as RuleDefinition)).toBe('TO')

  const label = catalog.metrics.DISTINCT_COUNTERPARTIES.label
  expect(sidedText(label, 'FROM')).toBe('서로 다른 수취 계좌 수')
  expect(sidedText(label, 'TO')).toBe('서로 다른 송금 계좌 수')
  expect(sidedText(catalog.path.minHops.label, 'RANDOM')).toBe('경로 거래 수')
  expect(sidedText('건당 금액', 'TO')).toBe('건당 금액')
  expect(sidedText(undefined, 'TO')).toBe('')
})

it('기간을 서버 문장과 같은 규칙으로 읽고, 템플릿 상한을 넘는 기간은 고르지 못하게 한다', () => {
  expect([60, 360, 1440, 4320, 10080, 90].map(windowLabel)).toEqual(['1시간', '6시간', '24시간', '3일', '7일', '90분'])
  expect(windowOptions(catalog, template('FAN_OUT'))).toEqual([60, 360, 1440, 4320, 10080, 20160, 43200])
  expect(windowOptions(catalog, template('RANDOM'))).toEqual([60, 360, 1440, 4320, 10080, 20160])
})

it('입력 칸의 글자를 숫자로 바꾼다', () => {
  expect(parseValue('1,000', 'decimal')).toBe(1000)
  expect(parseValue('0.8', 'decimal')).toBe(0.8)
  expect(parseValue('0.', 'decimal')).toBe(0)
  expect(parseValue('3.7', 'int')).toBe(3)
  expect(parseValue('', 'int')).toBeNull()
  expect(parseValue('.', 'decimal')).toBeNull()
  expect(parseValue('1e3', 'decimal')).toBeNull()
  expect(parseValue('-5', 'int')).toBeNull()
  expect(formatValue(1000000)).toBe('1,000,000')
  expect(formatValue(1.25)).toBe('1.25')
  expect(formatValue(undefined)).toBe('')
})
