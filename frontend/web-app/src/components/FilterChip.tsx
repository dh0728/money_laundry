import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// v24 shared.tsx
export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="h-7 gap-1 rounded-full pl-3 pr-1 font-normal">
      {children}
      <Button variant="ghost" size="icon" className="size-5 rounded-full" aria-label={`${children} 조건 제거`} onClick={onRemove}><X className="size-3" /></Button>
    </Badge>
  )
}
