import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Laptop, Monitor, X } from 'lucide-react'
import { MOCK_USER, roleInfo } from '@/app/session'
import { PageHeading, SectionTitle } from '@/components/page'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// v24 UtilityPages.tsx의 계정 화면. 세션 목록은 예시 값이다.
export default function AccountPage({ onLogout }: { onLogout: () => void }) {
  const user = MOCK_USER.name
  const role = roleInfo[MOCK_USER.role]
  const [sessions, setSessions] = useState(['current', 'other-1', 'other-2']), [picture, setPicture] = useState('')
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture) }, [picture])
  // 넓은 화면은 프로필·권한·세션 3열, 세로 화면은 자연스럽게 3행이다.
  return (
    <div className="space-y-6">
      <PageHeading title="계정" description="프로필과 권한, 로그인 세션을 관리합니다." />
      <div className="account-grid grid items-stretch gap-8" data-testid="account-grid">
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="프로필" />
        <div className="flex items-center gap-5">
          <Avatar className="size-18"><AvatarImage src={picture} /><AvatarFallback className="text-xl">{user[0]}</AvatarFallback></Avatar>
          <div><p className="font-semibold">{user}</p><Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => file.current?.click()}><Camera className="size-3.5" />이미지 변경</Button><input hidden ref={file} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setPicture(URL.createObjectURL(f)) }} /></div>
        </div>
                <dl className="grid grid-cols-2 gap-6 text-sm">
          {[['소속', MOCK_USER.organization], ['이메일', MOCK_USER.email], ['역할', role.label], ['가입일', MOCK_USER.joinedAt]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground mb-2">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </CardContent></Card>
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="권한" />
        <div className="space-y-5 text-sm">
          <ul className="space-y-3" aria-label="할 수 있는 일">{role.can.map(x => <li key={x} className="flex gap-2"><Check className="size-4 shrink-0 mt-0.5" />{x}</li>)}</ul>
          <ul className="space-y-3 text-muted-foreground" aria-label="할 수 없는 일">{role.cannot.map(x => <li key={x} className="flex gap-2"><X className="size-4 shrink-0 mt-0.5" />{x}</li>)}</ul>
        </div>
      </CardContent></Card>
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="세션 관리" description="현재 계정으로 로그인한 기기" action={<Button variant="outline" size="sm" onClick={() => setSessions(['current'])}>다른 세션 모두 로그아웃</Button>} />
        <div className="divide-y">
          {sessions.map((id, i) => (
            <div key={id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
              <div className="size-10 rounded-md bg-background grid place-items-center">{i === 0 ? <Monitor className="size-4" /> : <Laptop className="size-4" />}</div>
              <div className="flex-1"><div className="flex items-center gap-2"><p className="text-sm">{i === 0 ? 'Chrome · Windows 11' : i === 1 ? 'Edge · Windows 11' : 'Chrome · Windows 10'}</p>{id === 'current' && <Badge variant="secondary">현재</Badge>}</div><p className="text-xs text-muted-foreground mt-1">대한민국 서울 · {i === 0 ? '방금 활동' : '오늘 09:14'}</p></div>
              <Button variant="ghost" size="sm" onClick={() => id === 'current' ? onLogout() : setSessions(p => p.filter(x => x !== id))}>{id === 'current' ? '현재 세션 로그아웃' : '로그아웃'}</Button>
            </div>
          ))}
        </div>
      </CardContent></Card>
      </div>
    </div>
  )
}
