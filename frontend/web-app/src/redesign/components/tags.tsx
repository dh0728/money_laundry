import type { ReactNode } from 'react'
import { Check, CircleDashed, Clock, EyeClosed, Hourglass, Loader, TriangleAlert, User, UserCheck, UserRoundCheck, UserRoundX, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Figma Tag (tag/md: Inter Medium 12 / 16). 높이 20, padding 6·2, radius 4, 아이콘 12.
export type TagTone =
  | 'black' | 'neutral' | 'count' | 'brandSubtle' | 'brand' | 'danger' | 'negative' | 'caution' | 'cautionSubtle'
  | 'unread' | 'info' | 'pending' | 'positive' | 'muted'
  | 'inverse' | 'gray' | 'brandBase' | 'positiveSolid' | 'infoSubtle' | 'selected' | 'positiveSubtle' | 'dangerSubtle' | 'pendingSubtle'

const tones: Record<TagTone, string> = {
  black: 'bg-(--rd-accent) text-(--rd-inv)',
  neutral: 'bg-(--rd-subtle) text-(--rd-strong)',
  // Figma count 태그 글자색은 contents/absolute/theme(#fff)라 밝은 배경에서는 거의 보이지 않는다. 디자인 값 그대로 둔다.
  count: 'bg-(--rd-subtle) text-(--rd-theme)',
  brandSubtle: 'bg-(--rd-brand-subtle) text-(--rd-brand)',
  brand: 'bg-(--rd-brand) text-(--rd-inv)',
  danger: 'bg-(--rd-danger) text-(--rd-inv)',
  negative: 'bg-(--rd-negative-solid) text-(--rd-inv)',
  caution: 'bg-(--rd-caution) text-(--rd-inv)',
  cautionSubtle: 'bg-(--rd-caution-subtle) text-(--rd-caution-text)',
  unread: 'bg-(--rd-unread) text-(--rd-inv)',
  info: 'bg-(--rd-info) text-(--rd-inv)',
  pending: 'bg-(--rd-pending) text-(--rd-inv)',
  positive: 'bg-(--rd-positive) text-(--rd-inv)',
  muted: 'bg-(--rd-line) text-(--rd-strong)',
  // 룰 엔진 화면에서 쓰는 색 (Figma status/*-surface · *-text · *-solid)
  inverse: 'bg-(--rd-inverse) text-(--rd-inv)',
  gray: 'bg-(--rd-muted) text-(--rd-strong)',
  brandBase: 'bg-(--rd-brand-base) text-(--rd-inv)',
  positiveSolid: 'bg-(--rd-positive-solid) text-(--rd-inv)',
  infoSubtle: 'bg-(--rd-brand-subtle) text-(--rd-brand-text)',
  selected: 'bg-(--rd-brand-line) text-(--rd-brand-text)',
  positiveSubtle: 'bg-(--rd-positive-subtle) text-(--rd-positive-text)',
  dangerSubtle: 'bg-(--rd-danger-subtle) text-(--rd-danger-text)',
  pendingSubtle: 'bg-(--rd-pending-subtle) text-(--rd-pending-text)',
}

export function Tag({ tone = 'black', icon, children, className, title }: { tone?: TagTone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-[6px] py-[2px] text-[12px] font-medium leading-4 [&_svg]:size-3 [&_svg]:shrink-0', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

/** PatternTag. "FAN-OUT 82%" 처럼 유형 코드와 확률을 띄워 적는다. */
export function PatternTag({ code, detail, tone = 'black' }: { code: string; detail?: string; tone?: TagTone }) {
  return (
    <Tag tone={tone}>
      <span>{code}</span>
      {detail && <span>{detail}</span>}
    </Tag>
  )
}

// StatusTag 프리셋 (Figma 설명: unread 열람 전 · pending 처리 전 · inProgress 처리 중 · done 처리 완료)
export type WorkStatus = 'unread' | 'pending' | 'inProgress' | 'done'
const statusPreset: Record<WorkStatus, { label: string; tone: TagTone; icon: ReactNode }> = {
  unread: { label: '열람 전', tone: 'unread', icon: <EyeClosed /> },
  pending: { label: '처리 전', tone: 'pending', icon: <CircleDashed /> },
  inProgress: { label: '처리 중', tone: 'info', icon: <Loader /> },
  done: { label: '처리 완료', tone: 'positive', icon: <Check /> },
}
export function StatusTag({ status, tone }: { status: WorkStatus; tone?: TagTone }) {
  const preset = statusPreset[status]
  return <Tag tone={tone ?? preset.tone} icon={preset.icon} className="px-1 py-1">{preset.label}</Tag>
}

/** 모델 점수 태그. riskHigh 빨강 · riskMedium 주황 · riskLow 초록 */
export function ScoreTag({ level = 'high', value = '1234', solid = false }: { level?: 'high' | 'medium' | 'low'; value?: string; solid?: boolean }) {
  const tone: TagTone = level === 'high' ? (solid ? 'negative' : 'danger') : level === 'medium' ? 'caution' : 'positive'
  return <Tag tone={tone} icon={<TriangleAlert />}><span>이상</span><span>{value}</span></Tag>
}

/** 경과일 태그. 3일 이하 주황(Cautionary), 7일 초과 빨강(Negative) */
export function ElapsedTag({ days, level }: { days: string; level: 'low' | 'mid' | 'high' }) {
  const tone: TagTone = level === 'high' ? 'negative' : level === 'mid' ? 'unread' : 'caution'
  return <Tag tone={tone} icon={<Hourglass />} className="px-1 py-1"><span>{days}</span><span>경과</span></Tag>
}

/** 사람 판정 태그 (이상 / 정상) */
export function VerdictTag({ verdict }: { verdict: 'abnormal' | 'normal' }) {
  return verdict === 'abnormal'
    ? <Tag tone="danger" icon={<UserRoundX />}>이상</Tag>
    : <Tag tone="positive" icon={<UserRoundCheck />}>정상</Tag>
}

export function AssigneeTag({ name, reviewer = false }: { name: string; reviewer?: boolean }) {
  return <Tag tone="black" icon={reviewer ? <UserCheck /> : <User />}>{name}</Tag>
}

export function DateTag({ date }: { date: string }) {
  return <Tag tone="black" icon={<Clock />}>{date}</Tag>
}

/** FilterTag. 적용된 필터 값. 태그 전체를 누르면 해제된다. */
export function FilterTag({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button type="button" aria-label={`${label} 필터 해제`} onClick={onDismiss} className="inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[4px] bg-(--rd-brand-subtle) px-[6px] py-[2px] text-[12px] font-medium leading-4 text-(--rd-brand)">
      {label}
      <X className="size-3" />
    </button>
  )
}
