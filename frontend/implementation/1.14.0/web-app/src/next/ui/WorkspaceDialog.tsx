import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function WorkspaceDialog({ open, onOpenChange, title, description, children, footer, kind = 'dialog' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string
  description?: string; children: React.ReactNode; footer?: React.ReactNode; kind?: 'dialog' | 'drawer'
}) {
  const container = document.querySelector<HTMLElement>('[data-ui="aml-app"]') ?? undefined
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal container={container}>
    <Dialog.Overlay data-ws="dialog-overlay" />
    <Dialog.Content data-ws="dialog" data-dialog-kind={kind}><header><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="닫기"><X /></Button></Dialog.Close></header>
      <Dialog.Description data-ws={description ? 'muted' : 'sr-only'}>{description ?? '내용을 확인하고 작업을 선택하세요.'}</Dialog.Description>
      {children}{footer && <footer data-ws="dialog-actions">{footer}</footer>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
