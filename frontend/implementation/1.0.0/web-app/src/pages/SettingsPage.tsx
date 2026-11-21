import { LaptopMinimal, Moon, RotateCcw, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '@/app/ThemeProvider'
import { useCurrentUser } from '@/app/session'
import { PageHeading, SectionTitle } from '@/components/page'
import { ProvenanceBadge } from '@/components/Provenance'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMemoryState } from '@/lib/memory'

// v24 UtilityPages.tsx의 설정 화면. 테마 외 값은 아직 다른 화면에 쓰이지 않고, 새로고침하면 초기화된다.
export default function SettingsPage() {
  const currentUser = useCurrentUser()
  const { theme, setTheme } = useTheme()
  const [zone, setZone] = useMemoryState('settings:zone', 'seoul'), [dateFormat, setDateFormat] = useMemoryState('settings:date', 'iso'), [rows, setRows] = useMemoryState('settings:rows', '20'), [sort, setSort] = useMemoryState('settings:sort', 'risk'), [alerts, setAlerts] = useMemoryState('settings:alerts', ['assigned', 'linked', 'comment', 'result'])
  const reset = () => { setZone('seoul'); setDateFormat('iso'); setRows('20'); setSort('risk'); setAlerts(['assigned', 'linked', 'comment', 'result']); setTheme('system'); toast.success('설정을 초기화했습니다.') }
  // 조사자는 Alert 판정과 Episode 생성을 이어서 하고, 관리자는 Episode 검수를 받는다(9/28)
  const choices = currentUser.role === 'STAFF' ? [['assigned', '내 Alert 배정'], ['linked', 'Episode 연결 · 생성'], ['comment', '새 의견'], ['result', 'Episode 검수 결과']] : [['assigned', 'Episode 검수 요청'], ['linked', 'Episode에 Alert 연결'], ['comment', '새 의견'], ['result', 'Batch 결과']]
  // 설정은 선택 즉시 적용. 각 묶음은 같은 Card/SectionTitle 구조를 쓴다.
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeading title="설정" description="테마는 즉시 적용 · 나머지 항목은 시연용이며 다른 화면에 아직 적용되지 않음" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="theme-segment relative grid h-8 grid-cols-3 rounded-full bg-muted p-1" role="radiogroup" aria-label="테마 선택" data-theme={theme}>
            <span className="theme-segment-thumb absolute bottom-1 top-1 rounded-full bg-background shadow-sm ring-1 ring-border/60" aria-hidden="true" />
            {([{ id: 'light', label: '라이트 모드', icon: Sun }, { id: 'system', label: '시스템 설정', icon: LaptopMinimal }, { id: 'dark', label: '다크 모드', icon: Moon }] as const).map(t => (
              <label key={t.id} className="relative z-10 grid size-6 cursor-pointer place-items-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring" title={t.label}>
                <input className="sr-only" type="radio" name="theme" value={t.id} checked={theme === t.id} onChange={() => setTheme(t.id)} aria-label={t.label} />
                <t.icon className={`size-4 ${theme === t.id ? 'text-foreground' : 'text-muted-foreground'}`} aria-hidden="true" />
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" className="rounded-full" onClick={reset}><RotateCcw className="size-3.5" />설정 초기화</Button>
        </div>
      </div>
      <div className="settings-grid grid items-stretch gap-x-10 gap-y-10" data-testid="settings-grid">
        <Card className="h-full shadow-none"><CardContent className="space-y-5"><SectionTitle title="일반" action={<ProvenanceBadge kind="mock" />} />
          <div className="space-y-2"><Label>시간대</Label><Select value={zone} onValueChange={setZone}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="seoul">Asia/Seoul (UTC+9)</SelectItem><SelectItem value="utc">UTC</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>날짜 형식</Label><Select value={dateFormat} onValueChange={setDateFormat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="iso">YYYY-MM-DD</SelectItem><SelectItem value="dot">YYYY. MM. DD</SelectItem></SelectContent></Select></div>
        </CardContent></Card>
        <Card className="h-full shadow-none"><CardContent className="space-y-5"><SectionTitle title="목록" action={<ProvenanceBadge kind="mock" />} />
          <div className="space-y-2"><Label>페이지당 행</Label><Select value={rows} onValueChange={setRows}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['20', '50', '100'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>기본 정렬</Label><Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="risk">위험도 높은 순</SelectItem><SelectItem value="recent">최근 탐지 순</SelectItem></SelectContent></Select></div>
        </CardContent></Card>
        <Card className="h-full shadow-none"><CardContent className="space-y-5"><SectionTitle title="알림" description="인앱 수신 항목" action={<ProvenanceBadge kind="mock" />} />
          <div className="space-y-4">{choices.map(([id, label]) => <Label key={id} className="flex items-center gap-3 font-normal"><Checkbox checked={alerts.includes(id)} onCheckedChange={v => setAlerts(p => v ? [...new Set([...p, id])] : p.filter(x => x !== id))} />{label}</Label>)}</div>
        </CardContent></Card>
      </div>
    </div>
  )
}
