/* eslint-disable react-refresh/only-export-components -- 시안 전용 역할 선택(상태 훅과 컴포넌트를 함께 내보냄) */
// 재설계 시안 전용: 관리자·조사자 화면을 바꿔 보는 선택. 실제 앱에서는 로그인 역할(useCurrentUser().role)을 쓴다.
import type { ComponentProps } from 'react'
import { useMemoryState } from '@/lib/memory'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type MockRole = 'ADMIN' | 'STAFF'

export const useMockRole = () => useMemoryState<MockRole>('redesign:role', 'ADMIN')

export function MockRoleSwitch({ role, onChange }: { role: MockRole; onChange: (role: MockRole) => void }) {
  return <label className="flex items-center gap-2 text-xs text-muted-foreground">시안 보기 권한
    <Select value={role} onValueChange={v => onChange(v as MockRole)}><SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADMIN">관리자</SelectItem><SelectItem value="STAFF">조사자</SelectItem></SelectContent></Select>
  </label>
}

/** 관리자만 할 수 있는 버튼. 조사자에게는 비활성 + 이유(Q11: 같은 화면, 제어만 막힘) */
export function AdminButton({ role, children, ...props }: { role: MockRole } & ComponentProps<typeof Button>) {
  return <span className="inline-flex flex-col items-end gap-1"><Button {...props} disabled={role !== 'ADMIN' || props.disabled}>{children}</Button>{role !== 'ADMIN' && <span className="text-[0.6875rem] text-muted-foreground">관리자만 가능</span>}</span>
}
