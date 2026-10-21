// UI 재설계 S1: 대시보드 요약은 API.md §7의 1초 조회 규칙(박지원 10/8)을 따른다. 카운트다운·수동 갱신 버튼 대신
// "언제 집계된 값인지"(영역별 computedAt)와 연결 상태를 보인다. 실패하면 0으로 바꾸지 않고 마지막 성공값과 다음 재시도를 알린다.
import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'

const hms = (d: Date) => d.toTimeString().slice(0, 8)
const BACKOFF = [2, 4, 8, 16, 30]

export function DashboardFreshness({ businessDate }: { businessDate: string }) {
  const [now, setNow] = useState(() => new Date())
  const [offline, setOffline] = useState(false)
  const [lastOk, setLastOk] = useState(() => new Date())
  const [failCount, setFailCount] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id) }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 1초마다 갱신되는 시각에 맞춰 마지막 성공 시각·실패 횟수를 갱신(시안의 mock 상태)
    if (!offline) { setLastOk(now); setFailCount(0) } else setFailCount(c => c + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])
  // mock: 탐지 집계와 조사 집계는 따로 공개된다(시각이 같다는 보장 없음)
  const pipelineAt = new Date(lastOk.getTime() - 4000), investigationAt = new Date(lastOk.getTime() - 1000)
  const wait = BACKOFF[Math.min(BACKOFF.length - 1, Math.floor(Math.log2(failCount + 1)))]
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
    <span>업무 기준 {businessDate}</span>
    <span className="tabular-nums">탐지 집계 {hms(pipelineAt)}</span>
    <span className="tabular-nums">조사 집계 {hms(investigationAt)}</span>
    {offline
      ? <span role="alert" className="flex items-center gap-1.5 text-destructive"><i className="size-2 rounded-full bg-destructive" aria-hidden />연결 끊김 · 마지막 성공 {hms(lastOk)} 값 표시 중 · {wait}초 뒤 다시 시도</span>
      : <span className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ backgroundColor: 'var(--status-pending)' }} aria-hidden />1초마다 확인</span>}
    <label className="ml-1 flex items-center gap-1.5 rounded border border-dashed px-1.5 py-0.5">시안: 연결 끊김 보기<Switch checked={offline} onCheckedChange={setOffline} /></label>
  </div>
}
