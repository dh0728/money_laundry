import { useState, type DragEvent, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../components/primitives'
import { Tag } from '../components/tags'
import type { RuleTemplate } from './data'
import { Dropdown } from './Dropdown'
import { addChild, cmpOptions, metrics, moveBefore, newCondition, newGroup, removeNode, thenOptions, updateNode, windowOptions, type Condition, type Group, type RuleDraft, type RuleNode } from './model'

// Figma "조건 블록" 의 ruleTree: WHEN → (ALL/ANY 그룹 안의 조건들) → THEN.
// 블록 왼쪽의 회색 네모(시안의 branch)를 끌어 다른 블록 위에 놓으면 그 앞으로 옮겨진다.

type TreeProps = { template: RuleTemplate; draft: RuleDraft; onChange: (update: (draft: RuleDraft) => RuleDraft) => void }
type Tools = {
  template: RuleTemplate
  rootId: string
  edit: (update: (where: Group) => Group) => void
  dragId: string | null
  overId: string | null
  setDragId: (id: string | null) => void
  setOverId: (id: string | null) => void
}

const blockBox = 'rounded-[4px] border border-(--rd-line) bg-(--rd-subtle) p-2'
const plainText = 'whitespace-nowrap text-[14px] leading-[1.4] text-(--rd-strong)'

/** 줄 하나: 왼쪽 손잡이 + 블록. node 가 있으면 끌어 옮길 수 있고 놓을 자리도 된다. */
function BranchRow({ node, tools, children }: { node?: RuleNode; tools: Tools; children: ReactNode }) {
  const { dragId, overId, setDragId, setOverId, edit } = tools
  const droppable = node != null && dragId != null && dragId !== node.id
  const onDragOver = (event: DragEvent) => { if (!droppable) return; event.preventDefault(); event.stopPropagation(); if (overId !== node.id) setOverId(node.id) }
  const onDrop = (event: DragEvent) => {
    if (!droppable) return
    event.preventDefault(); event.stopPropagation()
    edit(where => moveBefore(where, dragId, node.id))
    setDragId(null); setOverId(null)
  }
  return (
    <div onDragOver={onDragOver} onDrop={onDrop} className={cn('flex w-full items-start', node && overId === node.id && 'shadow-[0_-2px_0_0_var(--rd-brand-base)]', node && dragId === node.id && 'opacity-50')}>
      <div
        draggable={node != null}
        title={node ? '끌어서 순서 바꾸기' : undefined}
        onDragStart={node && (event => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', node.id)
          const row = event.currentTarget.parentElement
          if (row) event.dataTransfer.setDragImage(row, 8, 8)
          setDragId(node.id)
        })}
        onDragEnd={() => { setDragId(null); setOverId(null) }}
        className={cn('size-4 shrink-0 bg-(--rd-line)', node && 'cursor-grab active:cursor-grabbing')}
      />
      {children}
    </div>
  )
}

function ValueInput({ value, onChange, label }: { value: number | null; onChange: (next: number | null) => void; label: string }) {
  const text = value == null ? '' : value.toLocaleString('en-US')
  return (
    <input
      inputMode="numeric" aria-label={label} value={text} placeholder="값"
      onChange={event => { const digits = event.target.value.replace(/\D/g, '').slice(0, 12); onChange(digits === '' ? null : Number(digits)) }}
      style={{ width: `calc(${Math.max(text.length, 2)}ch + 18px)` }}
      className={cn('h-5 shrink-0 rounded-[4px] border bg-(--rd-subtle) px-2 text-[14px] leading-none text-(--rd-strong) outline-none placeholder:text-(--rd-mute) focus-visible:border-(--rd-brand-base)', value == null ? 'border-(--rd-caution)' : 'border-(--rd-line)')}
    />
  )
}

function ConditionBlock({ condition, tools }: { condition: Condition; tools: Tools }) {
  const metric = metrics[condition.metric]
  const patch = (change: Partial<Condition>) => tools.edit(where => updateNode(where, condition.id, node => ({ ...node, ...change }) as Condition))
  const metricOptions = tools.template.metrics.map(key => ({ key, label: metrics[key].label }))
  return (
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-2', blockBox)}>
      {/* 항목을 바꾸면 비교 · 값 · 기간은 그 항목의 기본값으로 돌아간다 */}
      <Dropdown label="항목" value={condition.metric} options={metricOptions} onChange={key => patch({ metric: key, ...metrics[key].initial })} />
      {metric.kind === 'number' ? (
        <>
          <Dropdown label="비교" value={condition.cmp} options={cmpOptions} onChange={cmp => patch({ cmp })} />
          <ValueInput label={`${metric.label} 값`} value={condition.value} onChange={value => patch({ value })} />
          <p className={plainText}>{metric.unit}</p>
          {metric.windowed && <Dropdown label="기간" value={condition.windowMinutes} options={windowOptions} display={option => `${option.label} 안에`} onChange={windowMinutes => patch({ windowMinutes })} />}
        </>
      ) : (
        <p className={plainText}>이면</p>
      )}
      <div className="h-px min-w-px flex-1" />
      <Button size="sm" aria-label="조건 지우기" onClick={() => tools.edit(where => removeNode(where, condition.id))} iconStart={<X />} />
    </div>
  )
}

function GroupBlock({ group, tools }: { group: Group; tools: Tools }) {
  const { edit, template } = tools
  const all = group.op === 'ALL'
  const root = group.id === tools.rootId
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col items-start', blockBox)}>
      <div className="flex w-full items-center gap-2">
        <button type="button" title="눌러서 ALL ↔ ANY 바꾸기" aria-label={`${group.op} 그룹. 누르면 ${all ? 'ANY' : 'ALL'} 로 바꿉니다`} className="cursor-pointer rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base)"
          onClick={() => edit(where => updateNode(where, group.id, node => ({ ...node, op: all ? 'ANY' : 'ALL' }) as Group))}>
          <Tag tone={all ? 'infoSubtle' : 'pendingSubtle'}>{group.op}</Tag>
        </button>
        <p className="whitespace-nowrap text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{all ? '다음 조건을 모두 만족' : '다음 중 하나 이상'}</p>
        <div className="h-px min-w-px flex-1" />
        <Button size="sm" aria-label={root ? '조건 모두 지우기' : '그룹 지우기'} onClick={() => edit(where => removeNode(where, group.id))} iconStart={<X />} />
      </div>
      <div className="flex w-full items-stretch pl-4">
        <div className="w-px shrink-0 bg-(--rd-line)" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2 py-2">
          {group.children.map(child => (
            <BranchRow key={child.id} node={child} tools={tools}>
              {child.kind === 'group' ? <GroupBlock group={child} tools={tools} /> : <ConditionBlock condition={child} tools={tools} />}
            </BranchRow>
          ))}
          <BranchRow tools={tools}>
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Button size="sm" className="text-(--rd-strong)" iconStart={<Plus />} onClick={() => edit(where => addChild(where, group.id, newCondition(template.metrics[0])))}>조건 추가</Button>
              <Button size="sm" className="text-(--rd-strong)" iconStart={<Plus />} onClick={() => edit(where => addChild(where, group.id, newGroup(all ? 'ANY' : 'ALL')))}>그룹 추가</Button>
            </div>
          </BranchRow>
        </div>
      </div>
    </div>
  )
}

export function ConditionTree({ template, draft, onChange }: TreeProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const tools: Tools = {
    template, rootId: draft.where.id, dragId, overId, setDragId, setOverId,
    edit: update => onChange(current => ({ ...current, where: update(current.where) })),
  }
  const then = thenOptions.find(option => option.key === draft.then) ?? thenOptions[0]

  return (
    <div className="flex w-full flex-col items-start">
      <div className="flex w-full items-center gap-2 rounded-[4px] border border-(--rd-brand-base) bg-(--rd-brand-subtle) p-2">
        <Tag tone="brandBase">WHEN</Tag>
        <p className="whitespace-nowrap text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">거래 발생</p>
        <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-strong)">{template.whenNote}</p>
      </div>
      <div className="flex w-full items-stretch pl-4">
        <div className="w-px shrink-0 bg-(--rd-line)" />
        <div className="flex min-w-0 flex-1 items-start py-2">
          <BranchRow tools={tools}><GroupBlock group={draft.where} tools={tools} /></BranchRow>
        </div>
      </div>
      <div className={cn('flex w-full items-center gap-2', blockBox)}>
        <Tag tone="positiveSolid">THEN</Tag>
        <Dropdown label="적중했을 때" value={draft.then} options={thenOptions} onChange={key => onChange(current => ({ ...current, then: key }))} />
        <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-strong)">{then.note}</p>
      </div>
    </div>
  )
}
