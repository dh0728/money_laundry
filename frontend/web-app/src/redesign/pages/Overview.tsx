import { useState, type ReactNode } from 'react'
import { ArrowRight, Hourglass } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '../components/Panel'
import { Checkbox } from '../components/primitives'
import { AiSummary, KpiCard, type AiSummaryData, type Kpi } from '../components/summary'
import { PatternTag, ScoreTag, StatusTag, Tag } from '../components/tags'
import type { CaseKind } from '../route'
import { overviewTitles } from './overviewTitles'

// 개요 탭. Alert 와 Episode 가 같은 틀(태그 줄 · AI 요약 · KPI · 패널들)을 쓰고 패널 내용만 다르다.
const t12 = 'text-[12px] leading-[1.4] text-(--rd-strong)'
const t14 = 'text-[14px] leading-[1.4] text-(--rd-strong)'

function Bar({ width }: { width: string }) {
  return <div className="flex h-5 min-w-0 flex-1 items-center"><i style={{ width }} className="h-[6px] rounded-full bg-(--rd-brand)" /></div>
}

function FlowBox({ label, value, detail, core = false, compact = false }: { label: string; value: string; detail?: string; core?: boolean; compact?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) p-3', compact ? 'shrink-0' : 'flex-1')}>
      <p className={cn('whitespace-nowrap', core ? 'text-[12px] font-medium text-(--rd-brand)' : 'text-[14px] text-(--rd-strong)')}>{label}</p>
      <p className="whitespace-nowrap text-[16px] font-semibold leading-[1.4] text-(--rd-strong)">{value}</p>
      {detail && <p className={cn(t14, 'whitespace-nowrap')}>{detail}</p>}
    </div>
  )
}
const FlowArrow = () => <ArrowRight className="size-4 shrink-0 self-center text-(--rd-strong)" />

function CheckRow({ label, children }: { label: string; children: ReactNode }) {
  const [checked, setChecked] = useState(false)
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-(--rd-bg)"><Checkbox checked={checked} onChange={setChecked} label={`${label} 선택`} /></span>
      {children}
    </div>
  )
}

function Composition({ rows, note, selectable = false }: { rows: [string, string, string][]; note: string; selectable?: boolean }) {
  return (
    <div className="flex w-full flex-col gap-1">
      {rows.map(([label, count, width]) => {
        const line = (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className={cn(t14, 'w-[120px] shrink-0')}>{label}</p>
            <Tag tone="muted">{count}</Tag>
            <Bar width={width} />
          </div>
        )
        return selectable ? <CheckRow key={label} label={label}>{line}</CheckRow> : <div key={label} className="flex">{line}</div>
      })}
      <p className={cn(t14, 'p-2')}>{note}</p>
    </div>
  )
}

function RuleHits({ lead, hits, columns }: { lead: string; hits: [string, string, string][]; columns: boolean }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-start gap-2"><Tag tone="muted">룰</Tag><p className={t14}>{lead}</p></div>
      <div className={cn('flex w-full', columns ? 'flex-row' : 'flex-col')}>
        {hits.map(([title, time, detail]) => (
          <div key={title} className="flex min-w-0 flex-1 flex-col gap-1 p-3">
            <p className="text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{title}</p>
            <p className={t14}>{time}</p>
            <p className={t14}>{detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceTags() {
  return <div className="flex items-center gap-2"><Tag tone="muted">모델</Tag><Tag tone="muted">관측</Tag><Tag tone="muted">룰</Tag></div>
}

// ── Alert ────────────────────────────────────────────────────────────────
const alertSummary: AiSummaryData = {
  headline: '여러 계좌에서 모은 돈이 하루 안에 대부분 외부로 빠져나감',
  chartLabel: '4시간 단위 유입 금액', chartValue: '최대 15.0k USD', bars: [10, 14, 9, 12, 16, 22, 32], axis: ['탐지 28시간 전', '탐지 시점'],
  points: [{ icon: 'alert', text: 'RULE-003 적중, 씨앗 거래 3건이 근거' }, { icon: 'up', text: '유입 뒤 평균 3시간 안에 유출 시작' }, { icon: 'down', text: '받은 돈 대부분이 타행 계좌에서 들어옴' }],
  patterns: ['FAN-IN Fan-in 61%', 'FAN-OUT Gather-scatter 22%', 'CYCLE Stack 9%'],
}
const alertKpis: Kpi[] = [
  { label: '모델 점수', value: '0.998', caption: '임계값 0.70 · 위험 구간(0.90 이상)' },
  { label: '외부 유출', value: '54,500 USD', caption: '2건' },
  { label: '계좌 · 소유주', value: '14개 · 13명', caption: '은행 6곳 · 타행 13건' },
  { label: '기간', value: '28시간', caption: '09-02 22:10 ~ 09-04 02:10' },
  { label: '외부 유입', value: '65,700', unit: 'USD', caption: '7건 · 송금 계좌 5개' },
  { label: '순유입', value: '11,200', unit: 'USD', caption: '외부 유입 – 외부 유출' },
  { label: '경유 비율', value: '83.0%', caption: '유출 54,500 ÷ 유입 65,700' },
]
const seeds = [
  ['T-230903-04183902', '0.998', '2023-09-02', '22:10', '18,400.00', 'USD', '3cc15149 →', 'c41f3f2a'],
  ['T-230903-04184155', '0.97', '2023-09-03', '19:55', '9,500.00', 'EUR', '7a2e90b4 →', 'c41f3f2a'],
  ['T-230903-04184733', '0.93', '2023-09-03', '21:40', '2,640,000', 'JPY', 'c41f3f2a →', '51d0c8e7'],
] as const
const dailyAmount = [['09-02', 16, 5, 0], ['09-03', 62, 14, 24], ['09-04', 38, 0, 9]] as const

function SeedTable() {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string, next: boolean) => setPicked(current => { const copy = new Set(current); if (next) copy.add(id); else copy.delete(id); return copy })
  const grid = 'grid grid-cols-[28px_132px_44px_1fr_1fr_0.6fr_1.2fr_0.6fr] items-center gap-x-3'
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-2">
      <p className={t12}>출발 거래 3건 · 기간 안 · 점수 높은 순 · ID·점수 포함</p>
      <div className={cn(grid, 'text-[14px] font-semibold text-(--rd-strong)')}>
        <Checkbox checked={picked.size === seeds.length} onChange={next => setPicked(next ? new Set(seeds.map(seed => seed[0])) : new Set())} label="씨앗 거래 전체 선택" />
        <p className="text-[12px]">거래 ID</p><p className="text-[12px]">점수</p><p>시각</p><p>금액</p><p>통화</p><p>송금 → 수취</p><p>역할</p>
      </div>
      {seeds.map(([id, score, date, time, amount, currency, from, to]) => (
        <div key={id} className={cn(grid, 'rd-mono py-1 text-[14px] leading-[1.2] text-(--rd-strong)')}>
          <Checkbox checked={picked.has(id)} onChange={next => toggle(id, next)} label={`${id} 선택`} />
          <p className="whitespace-nowrap text-[12px]">{id}</p><p className="text-[12px]">{score}</p>
          <p>{date}<br />{time}</p><p>{amount}</p><p>{currency}</p><p>{from}<br />{to}</p>
          <p><Tag tone="muted" className="font-sans">SEED</Tag></p>
        </div>
      ))}
    </div>
  )
}

function alertPanels(): Record<(typeof overviewTitles.alert)[number], ReactNode> {
  return {
    '판단 요약': (
      <div className="flex w-full flex-col gap-[6px] pt-[26px]">
        <p className={t12}>c41f3f2a에 송금 5개가 28시간 7건·65,700 USD 모음<br />유출 2건·54,500 USD · 경유 83.0%<br />씨앗 3·Fan-in 61%·RULE-003 적중</p>
        <p className="text-[11px] leading-[1.4] text-(--rd-strong)">다음 · 분석 탭 c41f3f2a</p>
      </div>
    ),
    '핵심 계좌': (
      <div className="flex w-full flex-col gap-3 px-3 pt-8">
        <div className="flex items-center gap-2"><p className="text-[16px] font-medium text-(--rd-strong)">c41f3f2a</p><Tag tone="muted">중심</Tag></div>
        <i className="h-[6px] w-full rounded-full bg-(--rd-brand)" />
        <div className="flex items-center gap-2"><p className={t14}>타 Alert 연결</p><Tag tone="muted">Episode 미편입</Tag></div>
        <p className={t12}>14개 중 상위 · 유입 65,700 USD</p>
      </div>
    ),
    '과거 판단': (
      <p className={cn(t12, 'flex flex-wrap gap-x-3')}><span>A-230814-000987 · 2023-08-14 종결</span><span>정상</span><span>공유 계좌 c41f3f2a</span></p>
    ),
    '처리 이력': (
      <div className="flex w-full flex-col gap-[6px]">
        <div className="flex items-center gap-2"><StatusTag status="inProgress" tone="brand" /><Tag tone="black">담당 분석가-A</Tag></div>
        {['09-05 09:12 · 시스템 · 탐지', '09-05 09:40 · 배정 · 담당 분석가-A', '09-05 10:05 · 검토 시작 · 경과 3일', '보고 기한 · 의심 판정 뒤에만'].map(line => <p key={line} className={t12}>{line}</p>)}
      </div>
    ),
    '탐지 근거': (
      <div className="flex w-full flex-col gap-2 px-3 pt-3">
        <div className="flex items-center justify-between"><p className={t14}>왜 Alert가 됐나</p><SourceTags /></div>
        <p className={t14}>씨앗 3건 · 0.998 / 0.97 / 0.93 · Fan-in 61% / Gather-scatter 27% / 기타 12%</p>
        <div className="flex items-center gap-2 p-2"><Tag tone="muted">모델</Tag><p className={t14}>모델 기여 요인 · 준비 중</p></div>
        <p className={t14}>거래별 패턴 후보</p>
        {([['Fan-in 61%', '100%'], ['Gather-scatter 27%', '62%'], ['Other 12%', '28%']] as const).map(([detail, width]) => (
          <div key={detail} className="flex items-center gap-2"><PatternTag code="FAN-OUT" detail={detail} /><Bar width={width} /></div>
        ))}
      </div>
    ),
    '씨앗 거래': <SeedTable />,
    '돈의 흐름': (
      <div className="flex w-full flex-col gap-4 pt-7">
        <div className="flex w-full items-stretch gap-4">
          <FlowBox label="외부 유입" value="65,700 USD" detail="7건 · 첫 입금 09-02 22:10" /><FlowArrow />
          <FlowBox core label="핵심 계좌" value="c41f3f2a" detail="+11,200 USD · 경유 7건" /><FlowArrow />
          <FlowBox label="외부 유출" value="54,500 USD" detail="2건 · 마지막 출금 09-04 01:15" />
        </div>
        <div className="flex w-full flex-col gap-2">
          <p className="text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">시간 흐름 · 09-02 22:10 → 09-04 02:10 (약 28시간)</p>
          <div className="flex h-[6px] w-1/2 gap-1" aria-hidden><i className="w-[9%] rounded-full bg-(--rd-positive)" /><i className="flex-1 rounded-full bg-(--rd-caution)" /><i className="w-[9%] rounded-full bg-(--rd-negative-solid)" /></div>
          <div className={cn(t14, 'grid grid-cols-3')}><p>유입 · 09-02~09-03</p><p className="text-center">경유 · 3시간 25분</p><p className="text-right">유출 · 09-03~09-04</p></div>
        </div>
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">일별 거래 금액 · 통화별 누적 (USD 환산)</p>
            <div className={cn(t14, 'flex items-center gap-3')}>{([['USD', 'bg-(--rd-brand)'], ['EUR', 'bg-(--rd-pending)'], ['JPY', 'bg-(--rd-caution)']] as const).map(([name, color]) => <span key={name} className="flex items-center gap-1"><i className={cn('size-3 rounded-[4px]', color)} />{name}</span>)}</div>
          </div>
          <div className="flex h-[150px] w-full gap-2">
            <div className="rd-mono flex w-12 flex-col justify-between pb-5 text-right text-[12px] text-(--rd-strong)"><span>60,000</span><span>45,000</span><span>30,000</span><span>15,000</span><span>0</span></div>
            <div className="flex min-w-0 flex-1 items-end justify-around border-b border-(--rd-line)" aria-hidden>
              {dailyAmount.map(([day, usd, eur, jpy]) => (
                <div key={day} className="flex w-12 flex-col-reverse items-stretch">
                  <span className="rd-mono absolute translate-y-5 text-[12px] text-(--rd-strong)">{day}</span>
                  <i style={{ height: usd }} className="bg-(--rd-brand)" /><i style={{ height: eur }} className="bg-(--rd-pending)" /><i style={{ height: jpy }} className="rounded-t-[2px] bg-(--rd-caution)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    '룰 적중': (
      <RuleHits columns lead="룰 적중 · 운영 중인 룰이 이 Alert의 거래에 걸린 내역. 모델 점수와는 별개의 근거" hits={[
        ['RULE-001 v2 단건 고액거래 T-4183902', '09-03 21:40', '금액 31,000 USD (조건 30,000 USD 이상)'],
        ['RULE-001 v2 단건 고액거래 T-4184733', '09-04 00:30', '금액 30,400 USD (조건 30,000 USD 이상)'],
        ['RULE-003 v1 FAN-IN (집중 수취) c41f3f2a', '09-03 18:40 ~ 09-03 21:15', '송금 계좌 5개 (조건 3개 이상) · 거래 7건 · 받은 총액 65,700 USD'],
      ]} />
    ),
    '구성 · 거래 16건이 포함된 이유': (
      <Composition rows={[['씨앗', '3건', '18%'], ['직접 경로 · 상류', '7건', '42%'], ['직접 경로 · 하류', '4건', '24%'], ['주변 맥락', '2건', '12%']]}
        note="씨앗 계좌를 기준으로 전후 2일·2단계까지 상류·하류를 추적합니다. 같은 상대와의 거래는 주변 맥락으로만 넣습니다." />
    ),
    '데이터 범위·한계': (
      <div className="flex w-full flex-col gap-[6px] pt-[26px]">
        <p className={t12}>이진·유형 모델 v미제공 · 임계값 0.70 · publishedVersion 미제공 · 자료 기준 시각 미제공 · 은행 수신 6/6 · FIFO_ESTIMATE · Top-K 미제공</p>
        <p className={t12}>없는 값은 미제공</p>
      </div>
    ),
  }
}

// ── Episode ──────────────────────────────────────────────────────────────
const episodeSummary: AiSummaryData = {
  headline: 'Alert 3건이 계좌 2개를 공유하며 분산 → 집중 → 순환으로 이어짐',
  chartLabel: '15시간 단위 거래 건수', chartValue: '최대 6건', bars: [10, 14, 9, 12, 16, 22, 32], axis: ['1일차', '5일차'],
  points: [{ icon: 'up', text: 'A-261111-000003 분산 송금이 흐름의 시작' }, { icon: 'down', text: 'A-261111-000001에서 c41f3f2a로 돈이 모임' }, { icon: 'alert', text: 'A-261111-000007 순환 복귀로 같은 계좌에 되돌아옴' }],
  patterns: ['FAN-IN Fan-out 47%', 'FAN-OUT Fan-in 38%', 'CYCLE Cycle 12%'],
}
const episodeKpis: Kpi[] = [
  { label: '최고 점수', value: '0.998', caption: 'A-261111-000001 · 3건 평균 0.946' },
  { label: '거래', value: '29건', caption: 'Alert 합 32건 · 중복 3건 제외' },
  { label: '계좌 · 은행', value: '23개 · 8곳', caption: '소유주 19명 · 타행 거래 21건' },
  { label: '기간', value: '4일 6시간', caption: '09-01 08:40 ~ 09-05 14:20 (합집합)' },
  { label: '외부 유입', value: '112,400', unit: 'USD', caption: '외부 유출 90,450 USD' },
  { label: '순유입', value: '21,950', unit: 'USD', caption: '조사 중심 계좌 2개 합' },
  { label: '경유 비율', value: '80.5%', caption: '외부 유출 ÷ 외부 유입' },
]
const members = [
  ['A-261111-000001', 'Fan-in 61%', '분석가-A', '거래 16건 · 유입 68,000 USD · 기여 55%', '61%'],
  ['A-261111-000003', 'Fan-out 87%', '분석가-B', '거래 9건 · 유입 29,600 USD · 기여 31% · 편입 알림 보냄', '87%'],
  ['A-261111-000007', 'Cycle 72%', '분석가-C', '거래 7건 · 유입 14,800 USD · 기여 14% · 편입 알림 보냄', '72%'],
] as const

function episodePanels(): Record<(typeof overviewTitles.episode)[number], ReactNode> {
  return {
    '판단 요약': (
      <div className="flex w-full flex-col gap-2 pt-8">
        <p className={t14}>포함 Alert 3건(A-261111-000001·A-261111-000003·A-261111-000007)이 계좌 c41f3f2a·7e2b91d0을 공유합니다. 분산 송금(A-261111-000003) → 집중 수취(A-261111-000001) → 순환 복귀(A-261111-000007)가 4일 안에 이어집니다.</p>
        <p className={t14}>관측 · 모델 계산값을 Alert별로 합침 · 거래 ID 중복 제거</p>
      </div>
    ),
    '돈의 흐름': (
      <div className="flex w-full flex-wrap items-stretch gap-3 px-3">
        <FlowBox compact label="외부 유입" value="112,400 USD" /><FlowArrow />
        <FlowBox compact core label="조사 중심 계좌" value="c41f3f2a 외 1 · 순유입 21,950" /><FlowArrow />
        <FlowBox compact label="외부 유출" value="90,450 USD" />
      </div>
    ),
    '진행 · 최근 처리': (
      <div className="flex w-full flex-col gap-2">
        <p className="text-[16px] font-medium leading-[1.4] text-(--rd-strong)">진행 · 묶음 이력</p>
        <div className="flex items-center gap-2"><StatusTag status="inProgress" tone="brand" /><Tag tone="black">담당 분석가-A</Tag></div>
        <p className={t14}>A-261111-000001 탐지 → 분석가-A가 E-261111-000001 생성 → A-261111-000003(분석가-B)·A-261111-000007(분석가-C) 편입. 승인 없이 묶고 원 담당자에게 알림 발송 → 조사 중(3일 경과)</p>
      </div>
    ),
    '핵심 계좌': (
      <div className="flex w-full flex-col gap-2 px-3 pt-4">
        <p className="text-[16px] font-medium leading-[1.4] text-(--rd-strong)">포함 Alert · 3건</p>
        {members.map(([id, pattern, analyst, line]) => (
          <div key={id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2"><p className="text-[16px] font-medium text-(--rd-strong)">{id}</p><ScoreTag solid /><PatternTag code="FAN-OUT" detail={pattern} /><Tag tone="black">{analyst}</Tag></div>
            <p className={t14}>{line}</p>
          </div>
        ))}
      </div>
    ),
    '탐지 근거': (
      <div className="flex w-full flex-col gap-2 px-3 pt-3">
        <div className="flex items-center justify-between"><p className={t14}>왜 Episode로 묶였나</p><SourceTags /></div>
        <p className={t14}>씨앗 합계 7건(Alert 3건) · 두 모델 합의 STRONG 2건(A-261111-000001, A-261111-000003) · 유형 후보는 Alert별 합집합</p>
        <CheckRow label="모델 기여 요인"><Tag tone="muted">모델</Tag><p className={t14}>모델 기여 요인: 실모델 연결 후 “모델이 주목한 이웃 거래 Top-k”가 들어올 자리</p></CheckRow>
        <p className={t14}>거래별 패턴 후보</p>
        {members.map(([id, pattern, , , width]) => (
          <div key={id} className="flex items-center gap-2"><p className={cn(t14, 'shrink-0')}>{id}</p><PatternTag code="FAN-OUT" detail={pattern} /><div className="flex min-w-0 flex-1 items-center"><i style={{ width }} className="h-[6px] rounded-full bg-(--rd-brand)" /></div></div>
        ))}
      </div>
    ),
    '룰 적중': (
      <RuleHits columns={false} lead="룰 적중 · 운영 중인 룰이 포함 Alert들의 거래에 걸린 내역(Alert별). 모델 점수와는 별개의 근거" hits={[
        ['A-261111-000001 · RULE-003 v1 FAN-IN (집중 수취) c41f3f2a', '09-03 18:40 ~ 09-03 21:15', '송금 계좌 5개 (조건 3개 이상) · 거래 7건 · 받은 총액 65,700 USD'],
        ['A-261111-000003 · RULE-002 v2 FAN-OUT (분산 송금) 7e2b91d0', '09-01 08:40 ~ 09-01 13:10', '보낸 계좌 6개 (조건 5개 이상) · 24시간 · 보낸 총액 41,800 USD'],
      ]} />
    ),
    '구성 · 거래 29건이 포함된 이유': (
      <Composition selectable rows={[['씨앗', '7건', '8%'], ['직접 경로 · 상류', '11건', '19%'], ['직접 경로 · 하류', '8건', '11%'], ['주변 맥락', '3건', '5%']]}
        note="Alert 3건의 거래(합 32건)를 거래 ID로 합치고 겹친 3건은 한 번만 셉니다. 씨앗의 상류·하류는 전후 2일, 2단계까지 따라갑니다." />
    ),
  }
}

const alertTags = (
  <>
    <Tag tone="black">담당 분석가-A</Tag><StatusTag status="inProgress" /><Tag tone="caution" icon={<Hourglass />}>3일 경과</Tag><Tag tone="cautionSubtle">항목 한도 도달</Tag>
    <Tag tone="neutral">탐지 2023-09-05</Tag><Tag tone="neutral">통화 변환 있음</Tag><Tag tone="neutral">Episode 미편입</Tag><PatternTag code="FAN-OUT" detail="Fan-in 61%" />
  </>
)
const episodeTags = (
  <>
    <Tag tone="black">담당 분석가-A</Tag><Tag tone="black">분석가-B · 원 담당</Tag><Tag tone="black">분석가-C · 원 담당</Tag><StatusTag status="inProgress" /><Tag tone="caution" icon={<Hourglass />}>3일 경과</Tag>
    <Tag tone="cautionSubtle">Alert 3건</Tag><Tag tone="neutral">탐지 2023-09-01 ~ 09-05</Tag><Tag tone="neutral">통화 변환 있음</Tag><Tag tone="neutral">검토 이관 전</Tag><PatternTag code="FAN-OUT" detail="Fan-in 61% · Fan-out 87% · Cycle 72%" />
  </>
)

// 줄마다 [패널 제목, 폭 비율, 고정 높이]. 시안의 줄 구성과 패널 크기를 따른다.
type Cell = [title: string, flex: number, height?: number]
const layouts: Record<CaseKind, Cell[][]> = {
  alert: [
    [['판단 요약', 486], ['핵심 계좌', 439], ['과거 판단', 447, 338], ['처리 이력', 486, 338]],
    [['탐지 근거', 1, 370], ['씨앗 거래', 1, 338]],
    [['돈의 흐름', 1]],
    [['룰 적중', 1, 338], ['구성 · 거래 16건이 포함된 이유', 1, 338]],
    [['데이터 범위·한계', 1, 338]],
  ],
  episode: [
    [['판단 요약', 1, 338], ['돈의 흐름', 1, 338], ['진행 · 최근 처리', 1, 338]],
    [['핵심 계좌', 1, 346], ['탐지 근거', 1, 338], ['룰 적중', 1, 338]],
    [['구성 · 거래 29건이 포함된 이유', 1, 338]],
  ],
}

type OverviewProps = { kind: CaseKind; /** null 이면 전체 패널, 숫자면 그 패널 하나만 크게 */ focus: number | null; onFocus: (index: number | null) => void }

export function Overview({ kind, focus, onFocus }: OverviewProps) {
  const titles: readonly string[] = overviewTitles[kind]
  const bodies: Record<string, ReactNode> = kind === 'alert' ? alertPanels() : episodePanels()

  if (focus !== null) {
    const title = titles[focus]
    return (
      <div className="flex min-h-full w-full flex-col p-3">
        <Panel title="패널 정보 시각화" onExpand={() => onFocus(null)} onClose={() => onFocus(null)} className="w-full flex-1">
          <div className="flex min-h-[480px] w-full flex-1">
            <div className="flex min-w-0 flex-1 flex-col gap-3 pr-4">
              <h4 className="text-[16px] font-semibold leading-[1.4] text-(--rd-ink)">{title}</h4>
              {bodies[title]}
            </div>
            <div className="flex w-[388px] shrink-0 items-center justify-center border-l border-(--rd-line)">
              <p className="text-[48px] font-bold leading-[1.2] tracking-[-0.96px] text-(--rd-strong)">상세 정보</p>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 p-3">
      <div className="flex w-full flex-wrap content-start items-start gap-[6px]">{kind === 'alert' ? alertTags : episodeTags}</div>
      <AiSummary data={kind === 'alert' ? alertSummary : episodeSummary} className="w-full" />
      <div className="flex w-full gap-2">
        {(kind === 'alert' ? alertKpis : episodeKpis).map(kpi => <KpiCard key={kpi.label} kpi={kpi} className="min-h-[148px] min-w-fit flex-1" />)}
      </div>
      {layouts[kind].map(row => (
        <div key={row[0][0]} className="flex w-full items-start gap-2">
          {row.map(([title, flex, height]) => (
            <Panel key={title} title={title} onExpand={() => onFocus(titles.indexOf(title))} style={{ flex: `${flex} 1 0`, minHeight: height }}>{bodies[title]}</Panel>
          ))}
        </div>
      ))}
    </div>
  )
}
