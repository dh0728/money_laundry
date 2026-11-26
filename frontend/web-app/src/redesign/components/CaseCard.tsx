import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CaseCardData } from '../data'
import { caseHref } from '../route'
import { useWorkspace } from '../workspace'
import { Checkbox } from './primitives'
import { AssigneeTag, DateTag, PatternTag, ScoreTag, StatusTag, Tag, VerdictTag } from './tags'

// Figma Card (Alert·Episode 공용). header(id + addTab) · body(meta 줄) · footer(점수 | 담당·경과·상태)
// 색은 상태를 따른다: caution = 판정 전, danger = 사람 판정 이상, neutral = 사람 판정 정상.
const toneClass = {
  caution: { card: 'border-(--rd-caution-line) bg-(--rd-caution-subtle)', line: 'border-(--rd-caution-line)', text: 'text-(--rd-caution-ink)', label: 'text-(--rd-caution-ink)' },
  danger: { card: 'border-(--rd-danger-line) bg-(--rd-danger-subtle)', line: 'border-(--rd-danger-line)', text: 'text-(--rd-danger-ink)', label: 'text-(--rd-danger-ink)' },
  neutral: { card: 'border-(--rd-line) bg-(--rd-subtle)', line: 'border-(--rd-line)', text: 'text-(--rd-sub)', label: 'text-(--rd-mute)' },
} as const

function MetaRow({ label, labelClass, children }: { label: string; labelClass: string; children: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-2 overflow-clip text-[12px] leading-[18px]">
      <p className={cn('w-16 shrink-0 font-normal', labelClass)}>{label}</p>
      {children}
    </div>
  )
}

type CaseCardProps = {
  card: CaseCardData
  /** 목록에서 여러 건을 고를 때만 체크박스를 보인다 */
  selected?: boolean
  onSelect?: (next: boolean) => void
  className?: string
}

export function CaseCard({ card, selected, onSelect, className }: CaseCardProps) {
  const { addTab } = useWorkspace()
  const tone = toneClass[card.tone]
  return (
    <article className={cn('relative flex w-full flex-col items-start overflow-clip rounded-[8px] border', tone.card, className)}>
      {/* 카드 어디를 눌러도 상세로 간다. 안쪽 버튼(체크박스·탭 추가)은 이 링크 위에 놓인다. */}
      <a href={caseHref(card.id)} aria-label={`${card.id} 상세 열기`} className="absolute inset-0 z-0 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--rd-brand-base)" />
      <header className={cn('flex w-full shrink-0 items-center justify-between overflow-clip border-b p-2', tone.line)}>
        <div className="flex items-center gap-4">
          {onSelect && <Checkbox checked={Boolean(selected)} onChange={onSelect} label={`${card.id} 선택`} className={cn('relative z-10', !selected && tone.line)} />}
          <p className={cn('whitespace-nowrap text-[16px] font-semibold leading-[1.4]', tone.text)}>{card.id}</p>
        </div>
        <button type="button" aria-label={`${card.id} 탭으로 추가`} onClick={() => addTab(card.id)} className="relative z-10 flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-(--rd-brand) p-1 text-(--rd-inv) hover:brightness-95">
          <Plus className="size-3" />
        </button>
      </header>
      <div className={cn('flex w-full shrink-0 flex-col gap-2 px-4 py-2', card.bodyTint && 'bg-(--rd-info-subtle)')}>
        <div className="flex w-full flex-col gap-1 overflow-clip">
          <MetaRow label="패턴" labelClass={tone.label}>
            <div className="flex min-w-0 flex-1 items-start gap-1 overflow-clip">
              {card.patterns.map(pattern => <PatternTag key={pattern} code={pattern} />)}
              {card.morePatterns ? <Tag tone="black">+{card.morePatterns}</Tag> : null}
            </div>
          </MetaRow>
          {card.rows.map(row => (
            <MetaRow key={row.label} label={row.label} labelClass={tone.label}>
              <p className={cn('min-w-0 truncate font-medium', tone.text)}>{row.value}</p>
            </MetaRow>
          ))}
        </div>
      </div>
      <footer className={cn('flex min-h-10 w-full shrink-0 items-center justify-between overflow-clip border-t px-2 py-1', tone.line)}>
        <div className="flex items-center gap-1 overflow-clip">
          <ScoreTag level={card.score} />
          {card.verdict && <VerdictTag verdict={card.verdict} />}
          {card.reviewer && <AssigneeTag name={card.reviewer} reviewer />}
          {card.judgedAt && <DateTag date={card.judgedAt} />}
          {card.verdict && <StatusTag status="done" />}
        </div>
        {!card.verdict && (
          <div className="flex items-center gap-1 overflow-clip">
            {card.assignee && <AssigneeTag name={card.assignee} />}
            <Tag tone="danger">경과일</Tag>
            <Tag tone="info">처리 상태</Tag>
          </div>
        )}
      </footer>
    </article>
  )
}
