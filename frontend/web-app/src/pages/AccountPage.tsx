import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Monitor, X } from 'lucide-react'
import { roleInfo, useCurrentUser } from '@/app/session'
import { live } from '@/lib/apiMode'
import { PageHeading, SectionTitle } from '@/components/page'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Box, Text } from '@/components/layout-primitives'

const browserName = () => {
  const agent = navigator.userAgent
  if (agent.includes('Edg/')) return 'Microsoft Edge'
  if (agent.includes('OPR/')) return 'Opera'
  if (agent.includes('Whale/')) return 'Whale'
  if (agent.includes('Firefox/') || agent.includes('FxiOS/')) return 'Firefox'
  if (agent.includes('Chrome/') || agent.includes('CriOS/')) return 'Chrome'
  if (agent.includes('Safari/')) return 'Safari'
  return '브라우저'
}

// v24 UtilityPages.tsx의 계정 화면. 서버는 현재 세션만 제공한다.
export default function AccountPage({ onLogout }: { onLogout: () => void }) {
  const currentUser = useCurrentUser()
  const user = currentUser.name
  const role = roleInfo[currentUser.role]
  const [picture, setPicture] = useState('')
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture) }, [picture])
  // 넓은 화면은 프로필·권한·세션 3열, 세로 화면은 자연스럽게 3행이다.
  return (
    <Box className="space-y-6">
      <PageHeading title="계정" description="프로필과 권한, 현재 로그인 상태를 확인합니다." />
      <Box className="account-grid grid items-stretch gap-8" data-testid="account-grid">
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="프로필" />
        <Box className="flex items-center gap-5">
          <Avatar className="size-18"><AvatarImage src={picture} /><AvatarFallback className="text-xl">{user[0]}</AvatarFallback></Avatar>
          <Box><Text className="font-semibold">{user}</Text>{!live && <><Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => file.current?.click()}><Camera className="size-3.5" />이미지 변경</Button><input hidden ref={file} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setPicture(URL.createObjectURL(f)) }} /></>}</Box>
        </Box>
                <Box as="dl" className="grid grid-cols-2 gap-6 text-sm">
          {(live ? [['아이디', currentUser.username ?? '—'], ['이름', currentUser.name], ['역할', role.label]] : [['소속', currentUser.organization], ['이메일', currentUser.email], ['역할', role.label], ['가입일', currentUser.joinedAt]]).map(([k, v]) => <Box key={k}><Box as="dt" className="text-xs text-muted-foreground mb-2">{k}</Box><Box as="dd">{v}</Box></Box>)}
        </Box>
      </CardContent></Card>
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="권한" />
        <Box className="space-y-5 text-sm">
          <Box as="ul" className="space-y-3" aria-label="할 수 있는 일">{role.can.map(x => <Box as="li" key={x} className="flex gap-2"><Check className="size-4 shrink-0 mt-0.5" />{x}</Box>)}</Box>
          <Box as="ul" className="space-y-3 text-muted-foreground" aria-label="할 수 없는 일">{role.cannot.map(x => <Box as="li" key={x} className="flex gap-2"><X className="size-4 shrink-0 mt-0.5" />{x}</Box>)}</Box>
        </Box>
      </CardContent></Card>
      <Card className="h-full shadow-none"><CardContent className="space-y-6">
        <SectionTitle title="세션 관리" description="현재 로그인만 종료할 수 있습니다." />
        <Box className="divide-y">
          <Box className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0">
            <Box className="size-10 rounded-md bg-background grid place-items-center"><Monitor className="size-4" /></Box>
            <Box className="min-w-0 flex-1"><Box className="flex items-center gap-2"><Text className="text-sm">{browserName()}</Text><Badge variant="secondary">현재</Badge></Box><Text className="text-xs text-muted-foreground mt-1">이 기기의 로그인 세션</Text></Box>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onLogout}>현재 세션 로그아웃</Button>
          </Box>
        </Box>
      </CardContent></Card>
      </Box>
    </Box>
  )
}
