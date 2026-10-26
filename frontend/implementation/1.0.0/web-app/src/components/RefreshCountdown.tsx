import { useEffect, useState } from 'react'

export function RefreshCountdown({ nextRefreshAt, refreshing }: { nextRefreshAt?: number; refreshing: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])
  const seconds = Math.max(0, Math.ceil(((nextRefreshAt ?? now) - now) / 1000))
  return <span className="tabular-nums">{refreshing ? '갱신 중…' : nextRefreshAt
    ? `자동 갱신까지 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : '자동 갱신 대기'}</span>
}
