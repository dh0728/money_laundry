import type { ReactNode } from 'react'

export function PageHeading({ title, description, badge }: { title: string; description: string; badge?: ReactNode }) {
  return (
    <header data-testid="page-heading" className="page-heading min-h-[58px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="type-title font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      <p className="mt-1.5 type-caption text-muted-foreground">{description}</p>
    </header>
  )
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
