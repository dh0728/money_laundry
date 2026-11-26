import { useState } from 'react'
import { ApiError } from '@/api/common'
import { Eye, EyeOff } from 'lucide-react'
import { BrandWordmark, RadarMark } from '@/components/Brand'
import LoginNetwork from '@/components/LoginNetwork'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Box, Heading, LineBreak, Text } from '@/components/layout-primitives'

// v24 App.tsx의 로그인 화면.
export default function LoginPage({ onLogin, message }: { onLogin: (username: string, password: string) => Promise<void>; message?: string }) {
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onLogin(username, password) }
    catch (cause) { setError(cause instanceof ApiError && cause.problem.status === 401 ? '아이디 또는 비밀번호를 확인해 주세요.' : '로그인 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  return (
    <Box className="login-screen relative min-h-screen overflow-hidden text-login-foreground">
      {/* 화면 전체를 노드 그래프 애니메이션으로 채우고, 오른쪽 절반 전체를 유리 패널로 나눈다 */}
      <Box className="absolute inset-0 z-0"><LoginNetwork /></Box>
      {/* 왼쪽만 살짝 어둡게 — 오른쪽 유리 영역은 덮지 않음(네트워크가 비쳐야 함) */}
      <Box className="absolute inset-y-0 left-0 pointer-events-none login-shade" aria-hidden />
      <Box className="relative z-10 min-h-screen grid login-layout">
        <Box className="flex flex-col justify-between p-12 pointer-events-none">
          <Box className="flex items-center gap-2.5"><RadarMark className="size-5" /><BrandWordmark /></Box>
          <Box className="max-w-md">
            <Badge variant="outline" className="font-normal mb-7 border-login-foreground/25 text-login-foreground bg-login-badge-background">자금세탁 의심 거래 조사</Badge>
            <Heading level={1} className="login-title text-4xl tracking-tight font-semibold">탐지 신호에서<LineBreak />판단의 근거까지.</Heading>
            <Text className="mt-6 type-body text-login-foreground/65 leading-7">Alert를 검토하고, 연결된 거래를 추적하고,<LineBreak />Episode 단위로 조사를 이어갑니다.</Text>
          </Box>
          <Text className="text-2xs text-login-foreground/45">AML RADAR</Text>
        </Box>
        {/* 오른쪽 절반 = css.glass식 글래스모피즘(반투명+blur). 인풋만 불투명. 제목/화살표 없음 */}
        <Box className="login-glass-panel relative flex items-center justify-center p-8 pointer-events-auto backdrop-blur-2xl">
          <Box as="form" className="login-form w-full space-y-5" onSubmit={submit}>
            <Box className="space-y-2"><Label htmlFor="username" className="text-login-foreground/80">아이디</Label><Input id="username" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" className="h-10 login-input-opaque border-login-foreground/15 text-login-foreground" /></Box>
            <Box className="space-y-2">
              <Label htmlFor="password" className="text-login-foreground/80">비밀번호</Label>
              <Box className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" className="h-10 pr-10 login-input-opaque border-login-foreground/15 text-login-foreground" />
                <Button layout="text" type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-login-foreground/55 hover:text-login-foreground" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </Box>
            </Box>
            {(error || message) && <Text role="alert" className="text-sm text-login-foreground">{error || message}</Text>}
            <Button type="submit" disabled={busy} className="w-full h-11 bg-login-action-background text-login-action-foreground hover:bg-login-action-background/90">{busy ? '로그인 중…' : '로그인'}</Button>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
