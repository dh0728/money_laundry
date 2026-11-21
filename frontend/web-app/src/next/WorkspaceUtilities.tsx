import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Appearance, type Accent, type Theme } from './ui/AppShell'
import { WorkspaceDialog } from './ui/WorkspaceDialog'
import { snapshot } from './dashboard-data'
import { useWorkspace } from './workspace-store'

export type Preferences = { theme: Theme; accent: Accent; fontSize: 'small' | 'default' | 'large' }
export function WorkspaceUtilities({ active, onClose, preferences, onPreferences }: {
  active: 'notifications' | 'settings' | null; onClose: () => void
  preferences: Preferences; onPreferences: (value: Preferences) => void
}) {
  const workspace = useWorkspace()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const notifications = workspace.notifications.filter(n => !unreadOnly || !n.read).slice(0, 100)
  return <>
    <WorkspaceDialog open={active === 'notifications'} onOpenChange={open => { if (!open) onClose() }} title="알림" kind="drawer" description="공유 샘플 작업 공간의 최근 알림입니다.">
      <div data-ws="toolbar"><label data-ws="actions"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />안 읽은 알림만</label><Button variant="secondary" disabled={!workspace.notifications.some(n => !n.read)} onClick={() => workspace.markNotificationRead()}>모두 읽음</Button></div>
      <p data-ws="muted">{notifications.length}건 표시</p>
      {notifications.map(n => <article key={n.id} data-part="notification-row" data-unread={!n.read}><a href={n.href} onClick={() => { workspace.markNotificationRead(n.id); onClose() }}><strong>{n.title}</strong></a><p>{n.body}</p><small>{new Date(n.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST · {n.read ? '읽음' : '안 읽음'}</small>{!n.read && <Button variant="ghost" onClick={() => workspace.markNotificationRead(n.id)}>읽음 표시</Button>}</article>)}
      {!notifications.length && <p data-ws="empty">표시할 알림이 없습니다.</p>}
    </WorkspaceDialog>
    {active === 'settings' && <SettingsDialog key={`${preferences.theme}-${preferences.accent}-${preferences.fontSize}`} preferences={preferences} onClose={onClose} onApply={onPreferences} />}
  </>
}
export function AccountDetails({ onLogout }: { onLogout: () => void }) {
  return <>
    <dl><div><dt>이름</dt><dd>{snapshot.userName} 님</dd></div><div><dt>직원 ID</dt><dd>{snapshot.userId}</dd></div><div><dt>역할</dt><dd>조사 담당자 · STAFF</dd></div><div><dt>접속 환경</dt><dd>샘플 작업 공간</dd></div></dl>
    <p data-ws="muted">실제 인증 서버에 연결되지 않은 샘플 계정입니다. 판정·룰 변경은 현재 작업 공간에서만 공유되며, 로그아웃하거나 새로고침하면 초기 샘플로 돌아갑니다.</p>
    <Button variant="secondary" onClick={onLogout}>로그아웃</Button>
  </>
}
function SettingsDialog({ preferences, onClose, onApply }: { preferences: Preferences; onClose: () => void; onApply: (value: Preferences) => void }) {
  const [draft, setDraft] = useState(preferences)
  return <WorkspaceDialog open onOpenChange={open => { if (!open) onClose() }} title="설정" description="화면 표시 설정은 이 브라우저에 저장됩니다." footer={<><Button variant="ghost" onClick={() => setDraft({ theme: 'light', accent: 'sky', fontSize: 'default' })}>기본값으로</Button><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={() => onApply(draft)}>설정 적용</Button></>}>
    <section data-ws="panel"><h3>화면 표시</h3><Appearance theme={draft.theme} accent={draft.accent} onTheme={theme => setDraft({ ...draft, theme })} onAccent={accent => setDraft({ ...draft, accent })} /><label>글자 크기<select aria-label="글자 크기" value={draft.fontSize} onChange={e => setDraft({ ...draft, fontSize: e.target.value as Preferences['fontSize'] })}><option value="small">작게</option><option value="default">기본</option><option value="large">크게</option></select></label></section>
    <p data-ws="muted">브라우저 확대·축소도 그대로 사용할 수 있습니다.</p>
  </WorkspaceDialog>
}
