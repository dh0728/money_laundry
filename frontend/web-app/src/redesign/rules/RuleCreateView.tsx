import type { ReactNode } from 'react'
import { Check, ChevronRight, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DataTable, type Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { Tag } from '../components/tags'
import { ConditionTree } from './ConditionTree'
import { applySteps, checkItems, overlapWarning, templates, type RuleTemplate, type WorkLog } from './data'
import { conditionsOf, hasEmptyValue, readAsSentence } from './model'
import type { RuleEditor } from './state'

// Figma "screen/rule-engine/draft-create": 템플릿 고르기 | 조건 블록 | 검토 체크리스트

function TemplateItem({ template, selected, onPick }: { template: RuleTemplate; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" disabled={!template.available} aria-pressed={selected} onClick={onPick}
      className={cn('flex w-full shrink-0 items-center gap-2 rounded-[4px] border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base)',
        selected ? 'border-(--rd-brand-base) bg-(--rd-brand-subtle)' : 'border-(--rd-line)', template.available ? 'cursor-pointer text-(--rd-strong)' : 'cursor-not-allowed text-(--rd-mute)', template.available && !selected && 'hover:bg-(--rd-hover)')}>
      <span className="flex flex-col items-start gap-[2px] text-[14px] leading-[1.4]">
        <span className="font-semibold">{template.name}</span>
        <span>{template.axis}</span>
      </span>
      <span className="h-px min-w-px flex-1" />
      {selected ? <Tag tone="brandBase">선택됨</Tag> : !template.available && <Tag tone="gray">이후 제공</Tag>}
    </button>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-start gap-4">
      <div className="flex w-full items-center gap-2">
        <p className="whitespace-nowrap text-[16px] font-semibold leading-[1.4] text-(--rd-strong)">{title}</p>
        {note && <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{note}</p>}
      </div>
      {children}
    </div>
  )
}

const logColumns: Column<WorkLog>[] = [
  { key: 'at', header: '시각', width: 110, cell: row => row.at },
  { key: 'who', header: '사람', width: 64, cell: row => row.who },
  { key: 'what', header: '한 일', minWidth: 200, cell: row => row.what },
]

function CheckLine({ ok, name, text }: { ok: boolean; name: string; text: string }) {
  return (
    <div className="flex w-full items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-(--rd-strong)">
      {ok ? <Check /> : <CircleAlert />}
      <p className={cn('w-20 shrink-0 text-[14px] font-semibold leading-[1.4]', ok ? 'text-(--rd-positive-text)' : 'text-(--rd-caution-text)')}>{name}</p>
      <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-strong)">{text}</p>
    </div>
  )
}

export function RuleCreateView({ editor }: { editor: RuleEditor }) {
  const template = templates.find(item => item.key === editor.template) ?? templates[0]
  const { draft } = editor
  const warning = overlapWarning[template.key]
  // "조건" 줄만 지금 고친 내용에 따라 바뀐다. 나머지 점검은 서버가 해 줄 자리라 시안 문구 그대로 둔다.
  const valuesProblem = conditionsOf(draft.where).length === 0 ? '조건이 하나도 없습니다.' : hasEmptyValue(draft.where) ? '비어 있는 값이 있습니다.' : null

  return (
    <div className="flex min-h-full w-full items-stretch gap-4 p-3">
      <Panel title="템플릿 고르기" hideClose className="w-[320px] shrink-0">
        {templates.map(item => <TemplateItem key={item.key} template={item} selected={item.key === template.key} onPick={() => editor.chooseTemplate(item.key)} />)}
      </Panel>

      <Panel title="조건 블록" className="min-w-0 flex-1">
        <div className="flex w-full flex-1 flex-col items-start gap-6">
          <div className="flex w-full flex-col items-start gap-4">
            <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{template.name} · {template.draftLabel} · 블록을 끌어 순서를 바꿉니다</p>
            <ConditionTree template={template} draft={draft} onChange={editor.change} />
          </div>
          <Section title="이 룰을 문장으로 읽으면">
            <div className="flex w-full items-start rounded-[4px] bg-(--rd-subtle) p-4">
              <p className="min-w-px flex-1 text-[16px] font-semibold leading-[1.4] text-(--rd-strong)">{readAsSentence(draft)}</p>
            </div>
          </Section>
          <Section title="적용 절차" note="검증과 승인을 거친 뒤 새 버전으로 운영합니다">
            <ol className="flex w-full flex-wrap items-center gap-2">
              {applySteps.map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  {index > 0 && <ChevronRight className="size-3 text-(--rd-strong)" aria-hidden />}
                  <Tag tone={index === 0 ? 'brandBase' : 'gray'}>{index + 1} {step}</Tag>
                </li>
              ))}
            </ol>
            <DataTable label="작업 기록" columns={logColumns} rows={editor.log} rowKey={row => String(editor.log.indexOf(row))} />
          </Section>
        </div>
      </Panel>

      <Panel title="검토 체크리스트" className="w-[400px] shrink-0">
        <div className="flex w-full flex-col items-start gap-2">
          {warning && (
            <div className="flex w-full items-center gap-2 rounded-[8px] bg-(--rd-info-subtle) p-2">
              <CircleAlert className="size-4 shrink-0 text-(--rd-strong)" />
              <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-caution-text)">{warning.map(line => <span key={line} className="block">{line}</span>)}</p>
            </div>
          )}
          {checkItems.map(item => {
            const problem = item.key === 'values' ? valuesProblem : null
            return <CheckLine key={item.key} ok={problem == null} name={item.name} text={problem ?? item.text} />
          })}
        </div>
      </Panel>
    </div>
  )
}
