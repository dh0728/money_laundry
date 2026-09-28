import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// v24 shared.tsx: 아이콘만 있는 버튼 + 이름 툴팁
export function IconButton({ label, children, onClick, disabled, className }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* disabled button은 pointer 이벤트가 없어 tooltip이 뜨지 않으므로 span으로 감싼다 */}
        <span className="inline-flex">
          <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className={className}>{children}</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
