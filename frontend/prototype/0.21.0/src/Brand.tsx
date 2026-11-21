import { Radar } from 'lucide-react'

// Library geometry stays crisp at the lockup's actual 20px size in either theme.
export function RadarMark({ className = 'size-5' }: { className?: string }) {
  return <Radar className={className} strokeWidth={1.8} aria-hidden="true" />
}

export function BrandWordmark({ className = '' }: { className?: string }) {
  return <span className={`brand-wordmark ${className}`}>AML RADAR</span>
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 shrink-0 text-sm whitespace-nowrap ${className}`}>
      {/* 헤더 폭이 좁아지면(<1100px) 글자를 숨기고 마크만 남긴다 */}
      <RadarMark className="size-5 shrink-0" /><BrandWordmark className="max-[1100px]:hidden" />
    </div>
  )
}
