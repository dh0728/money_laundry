import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const dialogInvokers = new WeakMap<HTMLElement, HTMLElement | null>()

export function WorkspaceDialog({ open, onOpenChange, title, description, children, footer, kind = 'dialog', fallbackFocusRef }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string
  description?: string; children: React.ReactNode; footer?: React.ReactNode; kind?: 'dialog' | 'drawer'
  fallbackFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const container = document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.querySelector<HTMLElement>('[data-ui="aml-app"]') ?? undefined
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal container={container}>
    <Dialog.Overlay data-ws="dialog-overlay" />
    <Dialog.Content data-ws="dialog" data-dialog-kind={kind}
      onOpenAutoFocus={event => {
        const active = document.activeElement
        if (event.currentTarget instanceof HTMLElement) {
          dialogInvokers.set(event.currentTarget, active instanceof HTMLElement && active !== document.body ? active : null)
        }
      }}
      onCloseAutoFocus={event => {
        // These controlled dialogs open from ordinary buttons, without Dialog.Trigger.
        event.preventDefault()
        const dialog = event.currentTarget
        if (!(dialog instanceof HTMLElement)) return
        let target = dialogInvokers.get(dialog)
        // A replacement or reopened dialog owns focus and may have saved a new invoker.
        const replacement = dialog.ownerDocument.querySelector<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
        if (replacement) {
          const nextInvoker = dialogInvokers.get(replacement)
          // A transaction's verdict dialog replaces its detail dialog and removes the inner trigger.
          if (replacement !== dialog && dialogInvokers.has(replacement) && target?.isConnected && !nextInvoker?.isConnected) dialogInvokers.set(replacement, target)
          return
        }
        dialogInvokers.delete(dialog)
        if (!target?.isConnected || target.matches(':disabled, [aria-disabled="true"]') || target.closest('[inert]')) target = fallbackFocusRef?.current ?? null
        if (!target?.isConnected || target.matches(':disabled, [aria-disabled="true"]') || target.closest('[inert]')) return
        target.focus({ preventScroll: true })
      }}><header><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="닫기"><X /></Button></Dialog.Close></header>
      <Dialog.Description data-ws={description ? 'muted' : 'sr-only'}>{description ?? '내용을 확인하고 작업을 선택하세요.'}</Dialog.Description>
      {children}{footer && <footer data-ws="dialog-actions">{footer}</footer>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
