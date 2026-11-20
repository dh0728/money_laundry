import { useContext } from 'react'
import { createPortal } from 'react-dom'
import { PageHeaderContext } from '../page-header-context'

/** Feature controls render in the shared PageHeader, never as another page header. */
export function PageHeaderActions({ children }: { children: React.ReactNode }) {
  const target = useContext(PageHeaderContext)
  return target ? createPortal(children, target) : null
}
