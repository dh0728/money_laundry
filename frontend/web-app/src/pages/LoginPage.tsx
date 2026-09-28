import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { BrandWordmark, RadarMark } from '@/components/Brand'
import LoginNetwork from '@/components/LoginNetwork'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// v24 App.tsx의 로그인 화면. 인증 방식(API.md §5)이 정해지기 전이라 제출하면 가짜 사용자로 들어간다.
export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <div className="login-screen relative min-h-screen overflow-hidden bg-[var(--radar-disc)] text-login-foreground">
      {/* 화면 전체를 노드 그래프 애니메이션으로 채우고, 오른쪽 절반 전체를 유리 패널로 나눈다 */}
      <div className="absolute inset-0 z-0"><LoginNetwork /></div>
      {/* 왼쪽만 살짝 어둡게 — 오른쪽 유리 영역은 덮지 않음(네트워크가 비쳐야 함) */}
      <div className="absolute inset-y-0 left-0 z-[1] w-[58%] pointer-events-none login-shade" aria-hidden />
      <div className="relative z-10 min-h-screen grid grid-cols-[1fr_minmax(380px,1fr)] login-layout">
        <div className="flex flex-col justify-between p-12 pointer-events-none">
          <div className="flex items-center gap-2.5"><RadarMark className="size-5" /><BrandWordmark /></div>
          <div className="max-w-md">
            <Badge variant="outline" className="font-normal mb-7 border-login-foreground/25 text-login-foreground bg-login-badge-background">자금세탁 의심 거래 조사</Badge>
            <h1 className="text-4xl leading-[1.4] tracking-tight font-semibold">탐지 신호에서<br />판단의 근거까지.</h1>
            <p className="mt-6 type-body text-login-foreground/65 leading-7">Alert를 검토하고, 연결된 거래를 추적하고,<br />Episode 단위로 조사를 이어갑니다.</p>
          </div>
          <p className="text-[11px] text-login-foreground/45">AML RADAR</p>
        </div>
        {/* 오른쪽 절반 = css.glass식 글래스모피즘(반투명+blur). 인풋만 불투명. 제목/화살표 없음 */}
        <div className="login-glass-panel relative flex items-center justify-center p-8 pointer-events-auto backdrop-blur-2xl">
          <form className="w-full max-w-[360px] space-y-5" onSubmit={e => { e.preventDefault(); onLogin() }}>
            <div className="space-y-2"><Label htmlFor="email" className="text-login-foreground/80">이메일</Label><Input id="email" type="email" defaultValue="reviewer@fss.or.kr" autoComplete="username" className="h-10 login-input-opaque border-login-foreground/15 text-login-foreground" /></div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-login-foreground/80">비밀번호</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} defaultValue="amlradar" autoComplete="current-password" className="h-10 pr-10 login-input-opaque border-login-foreground/15 text-login-foreground" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-login-foreground/55 hover:text-login-foreground" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full h-11 bg-login-action-background text-login-action-foreground hover:bg-login-action-background/90">로그인</Button>
            <div className="text-center"><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs font-normal text-login-foreground/55 hover:text-login-foreground">비밀번호를 잊으셨나요?</Button></div>
          </form>
        </div>
      </div>
    </div>
  )
}
