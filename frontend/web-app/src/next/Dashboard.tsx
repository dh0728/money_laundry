import { CalendarDays, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CaseCard, StatusTag } from './ui/Tags'
import { DailyChart } from './ui/DailyChart'
import { PageHeaderActions } from './ui/PageHeaderActions'
import { number, patternName, percent, riskBand, riskSettings, snapshot, workStates, type DashboardData, type Scope } from './dashboard-data'

export function Dashboard({ data, scope, start, end, query, state, onRetry, onRange, onClear, onClearSearch }: {
  data: DashboardData; scope: Scope; start: string; end: string; query: string
  state: 'ready' | 'loading' | 'empty' | 'error' | 'initial-error'
  onRetry: () => void; onRange: (start: string, end: string) => void; onClear: () => void; onClearSearch: () => void
}) {
  const topPattern = [...data.patterns].sort((a, b) => b.count - a.count)[0]
  const totalAlerts = data.cases.filter(c => c.kind === 'ALERT').length
  return <>
    <h1 data-part="dashboard-a11y-heading">{scope === 'mine' ? '내 담당 업무' : '기관 탐지 현황'}</h1>
    <PageHeaderActions><div data-part="dashboard-period"><PeriodPicker key={`${start}-${end}`} start={start} end={end} onRange={onRange} /></div></PageHeaderActions>
    {query && <div data-part="filters"><Button data-tag="filter" variant="ghost" aria-label={`검색: ${query} 필터 해제`} onClick={onClearSearch}>검색: {query} ×</Button></div>}
    {state === 'error' && <div role="alert" data-part="error-banner"><TriangleAlert />새로 불러오지 못했습니다. 마지막으로 불러온 데이터를 표시합니다.<Button variant="ghost" onClick={onRetry}>다시 시도</Button></div>}
    {state === 'loading' ? <section data-part="state-panel" role="status"><RefreshCw data-part="spinner" /><h2>대시보드를 불러오는 중</h2><p>집계와 담당 업무를 확인하고 있습니다.</p></section> : state === 'initial-error' ? <section data-part="state-panel" role="alert"><TriangleAlert /><h2>데이터를 불러오지 못했습니다</h2><p>연결을 확인한 뒤 다시 시도해 주세요.</p><Button onClick={onRetry}>다시 시도</Button></section> : <>
      <section data-part="summary-band" aria-label="요약 및 주요 지표">
        <article data-part="ai-summary"><h2><Sparkles />AI 요약</h2><strong>{scope === 'mine' ? `조회 기간 내 담당 Alert ${totalAlerts}건` : `조회 기간 의심 거래 ${data.suspicious.length}건`}</strong>
          <p data-part="summary-context">샘플 · {snapshot.date} 18:00 KST{scope === 'mine' ? ` · ${snapshot.userName} 님 담당` : ' · 전체 담당자'}</p>
          <figure data-part="mini-chart"><figcaption>일별 {scope === 'mine' ? '내 담당' : '전체'} Alert 생성</figcaption><div>{data.daily.map(day => <div key={day.date}><meter aria-label={`${day.date} Alert ${day.alerts}건`} min={0} max={Math.max(1, ...data.daily.map(d => d.alerts))} value={day.alerts} /><span>{day.date.slice(5)}</span><strong>{day.alerts}건</strong></div>)}</div></figure>
          <p><TriangleAlert />{data.highRiskAlerts ? `위험 점수가 높은 처리 전 Alert ${data.highRiskAlerts}건을 먼저 확인해 주세요.` : '위험 점수가 높은 미처리 Alert가 없습니다.'}</p>
          <p data-part="muted">{scope === 'all' && topPattern?.count ? `의심 거래 중 ${patternName(topPattern.code)} 추정이 ${topPattern.count}건입니다. 모델 추정은 사람의 판정과 다릅니다.` : '모델 점수와 근거를 함께 확인한 뒤 판정해 주세요.'}</p>
        </article>
        {scope === 'mine' ? <div data-part="mine-kpis"><Kpi label={`위험 점수 ${riskSettings.high.toFixed(2)} 이상`} value={`${data.highRiskAlerts}건`} detail="처리 전 Alert · 열람 전·처리 중 포함" /><Kpi label="3일 이상 경과" value={`${data.overdue}건`} detail="처리 완료를 제외한 Alert · Episode" /></div> : <div data-part="all-kpis">
          <Kpi label="들어온 거래 수" value={`${number(data.transactions.length)}건`} detail="조회 기간 내 수신·분석된 샘플 거래" />
          <Kpi label="의심 거래 / 전체 거래" value={`${data.suspicious.length} / ${data.transactions.length}건`} detail={`의심 비율 ${percent(data.transactions.length ? data.suspicious.length / data.transactions.length : null)}`} />
          <Kpi label="새 계좌 · 새 소유주" value={`${data.newAccounts}개 · ${data.newOwners}명`} detail="샘플 이력에서 조회 기간에 처음 등장" />
          <Kpi label="생성 Alert" value={`${totalAlerts}건`} detail="조회 기간에 생성된 전체 Alert" />
          <Kpi label="업무 처리율" value={percent(data.closureRate)} detail="조회 기간 생성 업무 중 처리 완료 비율" />
          <Kpi label="처리 전 Alert" value={`${data.pendingAlerts}건`} detail="열람 전 · 처리 전 · 처리 중 포함" />
          <Kpi label="의심 거래 중 Alert 편입" value={percent(data.linkedRate)} detail="중복 없는 편입 의심 거래 / 의심 거래" />
          <Kpi label="조사 중 Episode" value={`${data.openEpisodes}건`} detail="조회 기간에 생성된 미종결 Episode" />
        </div>}
      </section>
      {scope === 'all' && data.transactions.length > 0 && <section data-part="analytics" aria-label="기관 탐지 집계">
        <article data-part="chart-panel"><h2>위험 점수 구간별 분포</h2><p data-part="muted">의심 거래 {data.suspicious.length}건 기준 · 룰 설정 임계값</p><div data-part="bar-rows">{(['high', 'medium', 'low'] as const).map((band, i) => { const count = data.suspicious.filter(t => riskBand(t.score) === band).length; return <div key={band} data-band={band}><span>{[`${riskSettings.high.toFixed(2)} 이상 · 위험`, `${riskSettings.medium.toFixed(2)} ~ ${riskSettings.high.toFixed(2)} · 주의`, `${riskSettings.medium.toFixed(2)} 미만 · 낮음`][i]}</span><strong>{count}건</strong><meter min={0} max={Math.max(1, data.suspicious.length)} value={count} aria-label={`${band} ${count}건`} /></div> })}</div></article>
        <article data-part="chart-panel"><h2>기간별 거래량 추이</h2><p data-part="muted">같은 단위 · 건수 · 전체 거래와 의심 거래</p><DailyChart rows={data.daily} /><details><summary>일별 수치</summary><div data-part="daily-table"><table><thead><tr><th>일자</th><th>전체 거래</th><th>의심 거래</th></tr></thead><tbody>{data.daily.map(day => <tr key={day.date}><th>{day.date.slice(5)}</th><td>{day.total}건</td><td>{day.suspicious}건</td></tr>)}</tbody></table></div></details></article>
        <article data-part="chart-panel" data-wide="true"><h2>일별 업무 처리 상태</h2><p data-part="muted">조회 기간에 생성된 Alert · Episode의 현재 상태</p><DailyChart rows={data.daily} workflow /><details><summary>일별 수치</summary><div data-part="daily-table"><table><thead><tr><th>일자</th><th>처리 전</th><th>처리 중</th><th>처리 완료</th></tr></thead><tbody>{data.daily.map(day => <tr key={day.date}><th>{day.date.slice(5)}</th><td>{day.pending}건</td><td>{day.inProgress}건</td><td>{day.done}건</td></tr>)}</tbody></table></div></details></article>
        <article data-part="chart-panel"><h2>전체 거래 구성</h2><div data-part="bar-rows">{[{ label: '모델 의심', count: data.suspicious.length }, { label: '그 외 분석 거래', count: data.transactions.length - data.suspicious.length }].map(row => <div key={row.label}><span>{row.label}</span><strong>{row.count}건</strong><meter min={0} max={data.transactions.length} value={row.count} aria-label={`${row.label} ${row.count}건`} /></div>)}</div><p data-part="muted">모델 분류이며 사람의 정상·이상 판정이 아닙니다.</p></article>
        <article data-part="chart-panel"><h2>의심 거래 유형별 건수</h2><p data-part="muted">패턴이 추정된 의심 거래 · NON_PATTERN 제외</p><div data-part="bar-rows">{data.patterns.map(row => <div key={row.code}><span>{patternName(row.code)}</span><strong>{row.count}건</strong><meter min={0} max={Math.max(1, ...data.patterns.map(p => p.count))} value={row.count} aria-label={`${patternName(row.code)} ${row.count}건`} /></div>)}</div></article>
      </section>}
      {data.cases.length === 0 ? <section data-part="state-panel"><SearchEmpty /><h2>조건에 맞는 업무가 없습니다</h2><p>검색어나 조회 기간을 바꿔 다시 확인해 주세요.</p><Button variant="secondary" onClick={onClear}>조건 초기화</Button></section> : <section aria-label="업무 현황"><h2 data-part="dashboard-a11y-heading">업무 현황 {data.cases.length}건</h2><div data-part="case-board">{workStates.map(({ key, label }) => { const rows = data.cases.filter(c => c.workState === key); return <section key={key} aria-label={`${label} ${rows.length}건`}><h3><StatusTag preset={key}>{label}</StatusTag><span data-part="count">{rows.length}건</span></h3>{rows.slice(0, 25).map(item => <CaseCard key={item.caseId} item={item} />)}{rows.length > 25 && <p data-part="empty-column">상위 25건 표시 · 전체 업무는 Alert·Episode 목록에서 조회하세요.</p>}{!rows.length && <p data-part="empty-column">업무 없음</p>}</section> })}</div></section>}
    </>}
  </>
}
function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article data-part="kpi"><p>{label}</p><strong>{value}</strong><p>{detail}</p></article>
}
function SearchEmpty() { return <CalendarDays aria-hidden="true" /> }

function PeriodPicker({ start, end, onRange }: { start: string; end: string; onRange: (start: string, end: string) => void }) {
  const [draftStart, setStart] = useState(start)
  const [draftEnd, setEnd] = useState(end)
  function preset(days: number) { const date = new Date(`${snapshot.date}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - days + 1); setStart(date.toISOString().slice(0, 10)); setEnd(snapshot.date) }
  function resetDraft() { setStart(start); setEnd(end) }
  return <details data-part="period-popover" onToggle={e => { if (!e.currentTarget.open) resetDraft() }} onKeyDown={e => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.currentTarget.open = false
    resetDraft()
    e.currentTarget.querySelector('summary')?.focus()
  }}><summary><CalendarDays />{start.slice(5)} ~ {end.slice(5)}</summary>
    <form aria-label="조회 기간" onSubmit={e => { e.preventDefault(); if (!e.currentTarget.checkValidity() || !draftStart || !draftEnd || draftStart > draftEnd || draftEnd > snapshot.date) return; onRange(draftStart, draftEnd); e.currentTarget.closest('details')?.removeAttribute('open') }}>
      <strong>조회 기간</strong><p data-part="muted">샘플 이력: 11-09 ~ 11-15</p>
      <div data-part="period-presets">{[{ label: '오늘', days: 1 }, { label: '최근 3일', days: 3 }, { label: '최근 7일', days: 7 }, { label: '최근 30일', days: 30 }].map(p => <Button key={p.days} type="button" variant="ghost" onClick={() => preset(p.days)}>{p.label}</Button>)}<Button type="button" variant="ghost" onClick={() => { setStart('2026-11-01'); setEnd(snapshot.date) }}>이번 달</Button></div>
      <label>시작일<input type="date" name="start" aria-label="시작일" value={draftStart} onChange={e => setStart(e.target.value)} max={draftEnd} required /></label><label>종료일<input type="date" name="end" aria-label="종료일" value={draftEnd} onChange={e => setEnd(e.target.value)} min={draftStart} max={snapshot.date} required /></label><Button type="submit">적용</Button>
    </form>
  </details>
}
