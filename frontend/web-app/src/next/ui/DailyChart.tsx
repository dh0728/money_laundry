import type { DashboardData } from '../dashboard-data'

export function DailyChart({ rows, workflow = false }: { rows: DashboardData['daily']; workflow?: boolean }) {
  const max = Math.max(1, ...rows.map(d => workflow ? d.pending + d.inProgress + d.done : d.total))
  const series = workflow ? [{ key: 'pending', label: '처리 전' }, { key: 'inProgress', label: '처리 중' }, { key: 'done', label: '처리 완료' }] as const : [{ key: 'total', label: '전체 거래' }, { key: 'suspicious', label: '의심 거래' }] as const
  return <figure data-part="daily-chart">
    <figcaption>{series.map(s => <span key={s.key} data-series={s.key}>{s.label}</span>)}<span>단위: 건</span></figcaption>
    <svg viewBox="0 0 700 210" role="img" aria-label={workflow ? '일별 업무 처리 상태 막대 차트' : '일별 전체·의심 거래량 막대 차트'}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}><line x1={40} y1={175 - ratio * 150} x2={690} y2={175 - ratio * 150} /><text x={30} y={180 - ratio * 150} textAnchor="end">{Math.round(max * ratio)}</text></g>)}
      {rows.map((day, i) => { const step = 640 / Math.max(1, rows.length); const x = 50 + i * step; return <g key={day.date}><text x={x + step / 2} y={200} textAnchor="middle">{day.date.slice(5)}</text>{series.map((s, j) => {
        const value = day[s.key]; const before = workflow ? series.slice(0, j).reduce((sum, previous) => sum + day[previous.key], 0) : 0
        return <rect key={s.key} data-series={s.key} x={x + (workflow ? step * 0.2 : step * (0.15 + j * 0.35))} y={175 - (value + before) / max * 150} width={step * (workflow ? 0.6 : 0.3)} height={value / max * 150} rx={2}><title>{day.date} {s.label} {value}건</title></rect>
      })}</g> })}
    </svg>
  </figure>
}
