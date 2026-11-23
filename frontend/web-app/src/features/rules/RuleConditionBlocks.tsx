import { useEffect, useId, useRef, useState, type ComponentProps, type DragEvent, type ElementType, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { Input } from '@/components/ui/input'
import type { RuleInput } from '@/lib/workspace-store'
import type { RuleBlockKind, validateRule } from './rules-logic'
import './rule-condition-blocks.css'

const palette: { kind: RuleBlockKind; label: string }[] = [
  { kind: 'accountWindow', label: '같은 계좌의 반복 거래' },
  { kind: 'typeCode', label: '거래 유형' },
  { kind: 'scoreMin', label: '최소 점수' },
]
const typeCodes: TypeCode[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const typeOptions = typeCodes.map(value => ({ value, label: typeDisplay(value).label }))
const dragType = 'application/x-aml-rule-condition'

interface Props {
  input: RuleInput
  blocks: RuleBlockKind[]
  onInputChange: (input: RuleInput) => void
  onBlocksChange: (blocks: RuleBlockKind[]) => void
  errors: ReturnType<typeof validateRule>
  scoreAsPoints?: boolean
  button?: ElementType<ComponentProps<'button'>>
  renderBranches?: (branches: ReactNode[], finalSlot: ReactNode) => ReactNode
  renderTypePicker?: (props: {
    value: RuleInput['typeCode']
    onChange: (value: TypeCode) => void
    options: typeof typeOptions
  }) => ReactNode
}

function renderFlatBranches(branches: ReactNode[], finalSlot: ReactNode) {
  return <>{branches}{finalSlot}<p>백테스트에서 검토 대상으로 표시</p></>
}

export function RuleConditionBlocks({
  input, blocks, onInputChange, onBlocksChange, errors, scoreAsPoints = false, button: Button = 'button',
  renderTypePicker, renderBranches = renderFlatBranches,
}: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const nextFocus = useRef<string | null>(null)
  const [dragging, setDragging] = useState<RuleBlockKind | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (nextFocus.current) root.current?.querySelector<HTMLElement>(nextFocus.current)?.focus()
    nextFocus.current = null
  }, [blocks])

  function place(kind: RuleBlockKind, insertion: number) {
    const previous = blocks.indexOf(kind)
    if (previous === -1 && kind === 'typeCode' && input.typeCode === null) {
      onInputChange({ ...input, typeCode: 1 })
    }
    if (previous === -1) nextFocus.current = `fieldset[data-rule-kind="${kind}"]`
    const next = blocks.filter(block => block !== kind)
    next.splice(insertion - Number(previous !== -1 && previous < insertion), 0, kind)
    onBlocksChange(next)
  }

  function beginDrag(event: DragEvent, kind: RuleBlockKind) {
    event.dataTransfer.setData(dragType, kind)
    const block = event.currentTarget.closest('fieldset')
    event.dataTransfer.effectAllowed = block ? 'move' : 'copy'
    if (block) event.dataTransfer.setDragImage?.(block, 16, 16)
    setDragging(kind)
  }

  function endDrag() {
    setDragging(null)
    setDropSlot(null)
  }

  function allowDrop(event: DragEvent, insertion: number) {
    if (!event.dataTransfer.types.includes(dragType)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
    setDropSlot(insertion)
  }

  function drop(event: DragEvent, insertion: number) {
    const kind = palette.find(block => block.kind === event.dataTransfer.getData(dragType))?.kind
    if (!kind) return
    event.preventDefault()
    event.stopPropagation()
    place(kind, insertion)
    endDrag()
  }

  function move(kind: RuleBlockKind, label: string, index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= blocks.length) return
    nextFocus.current = `button[data-rule-drag-handle="${kind}"]`
    place(kind, delta < 0 ? target : target + 1)
    setAnnouncement(`${label}, ${target + 1}번째 조건`)
  }

  function blockSlot(event: DragEvent, index: number) {
    const { top, height } = event.currentTarget.getBoundingClientRect()
    return event.clientY < top + height / 2 ? index : index + 1
  }

  function slot(index: number) {
    return <div data-rule-drop-slot data-active={dropSlot === index || undefined} aria-hidden="true"
      onDragOver={event => allowDrop(event, index)} onDrop={event => drop(event, index)} />
  }

  function numberField(key: 'scoreMin' | 'minTransactions' | 'windowHours', label: string, min: number, max: number | undefined, step: number, unit?: string, scale = 1) {
    const value = Number((input[key] * scale).toFixed(8))
    const error = scale === 100 && errors.scoreMin ? '모델 점수를 0~100점 사이로 입력해 주세요.' : errors[key]
    return <label>
      {label}
      <span data-rule-block-input>
        <Input name={key} aria-label={label} type="number" min={min} max={max} step={step} value={Number.isNaN(value) ? '' : value}
          onChange={event => onInputChange({ ...input, [key]: event.target.valueAsNumber / scale })}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-${key}` : undefined} />
        {unit && <span>{unit}</span>}
      </span>
      {error && <span id={`${id}-${key}`} data-rule-block-error>{error}</span>}
    </label>
  }

  const changeType = (typeCode: TypeCode) => onInputChange({ ...input, typeCode })
  return <div data-rule-builder ref={root} onDragEnd={endDrag}>
    <div data-rule-palette aria-label="추가할 수 있는 조건">
      <strong>조건 블록</strong>
      <p>블록을 아래로 끌어 놓거나 눌러 추가하세요.</p>
      <div>{palette.map(({ kind, label }) => <Button key={kind} type="button" data-rule-kind={kind} data-button-shape="pill"
        aria-label={`${label} 추가`} disabled={blocks.includes(kind)} draggable={!blocks.includes(kind)}
        onDragStart={event => beginDrag(event, kind)} onClick={() => place(kind, blocks.length)}>
        <Plus aria-hidden="true" />{label}
      </Button>)}</div>
    </div>
    <section aria-label="조건 블록 작업대" data-rule-workbench data-empty={!blocks.length || undefined}
      onDragOver={event => allowDrop(event, blocks.length)} onDrop={event => drop(event, blocks.length)}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropSlot(null)
      }}>
      <strong>거래가 다음 조건을 모두 만족하면</strong>
      {!blocks.length && <p>여기에 조건 블록을 놓으세요.</p>}
      {renderBranches(blocks.map((kind, index) => {
        const label = palette.find(block => block.kind === kind)!.label
        return <div key={kind}>
          {slot(index)}
          <fieldset data-rule-kind={kind} data-dragging={dragging === kind || undefined} tabIndex={-1}
            onDragOver={event => allowDrop(event, blockSlot(event, index))}
            onDrop={event => drop(event, blockSlot(event, index))}>
            <legend data-rule-sr-only>{label}</legend>
            <div data-rule-block-header>
              <Button type="button" data-rule-drag-handle={kind} data-button-shape="circle" draggable onDragStart={event => beginDrag(event, kind)}
                aria-label={`${label} 순서 이동`} aria-keyshortcuts="ArrowUp ArrowDown"
                title="끌어서 이동 · 방향키로 순서 변경" onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  move(kind, label, index, event.key === 'ArrowUp' ? -1 : 1)
                }}>
                <GripVertical aria-hidden="true" />
              </Button>
              <strong aria-hidden="true">{label}</strong>
              <div data-rule-block-actions>
                <Button type="button" data-button-shape="circle" aria-label={`${label} 위로 이동`} title="위로 이동" aria-disabled={index === 0}
                  onClick={() => move(kind, label, index, -1)}><ArrowUp aria-hidden="true" /></Button>
                <Button type="button" data-button-shape="circle" aria-label={`${label} 아래로 이동`} title="아래로 이동" aria-disabled={index === blocks.length - 1}
                  onClick={() => move(kind, label, index, 1)}><ArrowDown aria-hidden="true" /></Button>
                <Button type="button" data-button-shape="circle" aria-label={`${label} 제거`} title="제거" onClick={() => {
                  nextFocus.current = `button[data-rule-kind="${kind}"]`
                  onBlocksChange(blocks.filter(block => block !== kind))
                }}><X aria-hidden="true" /></Button>
              </div>
            </div>
            <div data-rule-block-body>
              <div data-rule-block-fields>
                {kind === 'typeCode' && <label>거래 유형
                  {renderTypePicker ? renderTypePicker({ value: input.typeCode, onChange: changeType, options: typeOptions }) :
                    <select aria-label="거래 유형" value={input.typeCode ?? ''} onChange={event => changeType(Number(event.target.value) as TypeCode)}>
                      {typeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>}
                </label>}
                {kind === 'scoreMin' && numberField('scoreMin', '최소 모델 점수', 0, scoreAsPoints ? 100 : 1, 0.01, scoreAsPoints ? '점 이상' : undefined, scoreAsPoints ? 100 : 1)}
                {kind === 'accountWindow' && <>
                  {numberField('minTransactions', '최소 거래 건수', 1, undefined, 1, '건 이상')}
                  {numberField('windowHours', '시간 창', 1, 720, 1, '시간 이내')}
                </>}
              </div>
            </div>
          </fieldset>
        </div>
      }), slot(blocks.length))}
    </section>
    <span data-rule-sr-only aria-live="polite" aria-atomic="true">{announcement}</span>
  </div>
}
