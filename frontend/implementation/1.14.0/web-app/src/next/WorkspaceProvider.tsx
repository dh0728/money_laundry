import { useRef, useState } from 'react'
import { WorkspaceContext, type ActionResult, type WorkspaceState, type WorkspaceValue } from './workspace-store'
import { appendCaseComment, applyCaseVerdict, bundleCaseAlerts, createWorkspaceState, saveWorkspaceRule, transitionWorkspaceRule, updateTransactionVerdict } from './workspace-data'
import { snapshot } from './dashboard-data'

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(createWorkspaceState)
  const current = useRef(state)
  function commit<T>(operation: (state: WorkspaceState) => ActionResult<{ state: WorkspaceState; value: T }>): ActionResult<T> {
    const result = operation(current.current)
    if (!result.ok) return result
    current.current = result.value.state
    setState(result.value.state)
    return { ok: true, value: result.value.value }
  }
  const value: WorkspaceValue = { ...state, viewerId: snapshot.userId,
    judgeCases: (ids, verdict, reason, options) => commit(s => applyCaseVerdict(s, ids, verdict, reason, options)),
    bundleAlerts: (ids, reason) => commit(s => bundleCaseAlerts(s, ids, reason)),
    addComment: (id, text) => commit(s => appendCaseComment(s, id, text)),
    judgeTransaction: (id, verdict, reason) => commit(s => updateTransactionVerdict(s, id, verdict, reason)),
    saveRule: (input, id) => commit(s => saveWorkspaceRule(s, input, id)),
    transitionRule: (id, status, reason) => commit(s => transitionWorkspaceRule(s, id, status, reason)),
    openCase: id => { commit(s => { const record = s.records.find(c => c.caseId === id); if (!record) return { ok: true, value: { state: s, value: undefined } }; const opened = s.openedCaseIds ?? []; const needsOpen = record.assigneeId === snapshot.userId && record.workState === 'unread'; if (opened.includes(id) && !needsOpen) return { ok: true, value: { state: s, value: undefined } }; return { ok: true, value: { value: undefined, state: { ...s, openedCaseIds: opened.includes(id) ? opened : [...opened, id], records: needsOpen ? s.records.map(c => c.caseId === id ? { ...c, workState: 'pending', revision: c.revision + 1 } : c) : s.records } } } }) },
    markNotificationRead: id => { commit(s => ({ ok: true, value: { value: undefined, state: { ...s, notifications: s.notifications.map(n => id === undefined || id === n.id ? { ...n, read: true } : n) } } })) },
    closeCase: id => { commit(s => ({ ok: true, value: { value: undefined, state: { ...s, openedCaseIds: (s.openedCaseIds ?? []).filter(opened => opened !== id) } } })) },
    resetWorkspace: () => { const next = createWorkspaceState(); current.current = next; setState(next) },
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
