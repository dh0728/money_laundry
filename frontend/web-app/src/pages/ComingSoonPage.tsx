import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/app/ThemeProvider'
import { PageHeading } from '@/components/page'
import { Button } from '@/components/ui/button'

const themeOptions = [
  { value: 'light', label: '라이트', icon: Sun },
  { value: 'dark', label: '다크', icon: Moon },
  { value: 'system', label: '시스템', icon: Monitor },
] as const

// v24 설정 화면을 옮기기 전까지 테마 선택만 둔다
function ThemePicker() {
  const { theme, setTheme } = useTheme()
  return (
    <section aria-labelledby="theme-title" className="rounded-xl border p-5">
      <h2 id="theme-title" className="text-base font-semibold tracking-tight">화면 테마</h2>
      <div className="mt-4 flex gap-2">
        {themeOptions.map(option => (
          <Button key={option.value} variant={theme === option.value ? 'default' : 'outline'} size="sm" aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}>
            <option.icon />
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  )
}

export default function ComingSoonPage({ title, withThemePicker = false }: { title: string; withThemePicker?: boolean }) {
  return (
    <div className="space-y-6">
      <PageHeading title={title} description="v24 시안을 웹앱으로 옮기는 중입니다." />
      {withThemePicker && <ThemePicker />}
      <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">준비 중인 화면입니다.</p>
    </div>
  )
}
