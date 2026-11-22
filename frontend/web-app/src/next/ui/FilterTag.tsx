import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <Button variant="ghost" data-tag="filter" aria-label={`${label} 필터 해제`} onClick={onRemove}>{label}<X aria-hidden="true" /></Button>
}
