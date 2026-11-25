import { useState, type ReactNode } from 'react'
import { ArrowDownUp, Calendar, Crosshair, Download, ListFilter, Play, SkipBack, SkipForward, ZoomIn, ZoomOut } from 'lucide-react'
import { Panel } from './Panel'
import { Button, Checkbox, Switch } from './primitives'

// 분석·관련 탭의 그래프 묶음: [그래프 설정 패널 | 캔버스 + 재생·확대 조절 | 상세 내용 패널]
// 캔버스는 시안에서도 비어 있다. 실제 그래프(기존 features/graph)는 API 연결 때 넣는다.

const legend: { mark: ReactNode; label: string }[] = [
  { mark: <i className="size-[6px] rounded-full bg-(--rd-danger)" />, label: '의심 거래 참여 계좌' },
  { mark: <i className="size-[6px] rounded-full bg-(--rd-mute)" />, label: '주변 계좌' },
  { mark: <i className="h-[2px] w-3 bg-(--rd-negative-solid)" />, label: '의심 거래' },
  { mark: <i className="h-[2px] w-3 bg-(--rd-positive)" />, label: '정상 거래' },
  { mark: <i className="h-[2px] w-3 bg-(--rd-caution)" />, label: '미분석 · 미확인 거래' },
  { mark: <i className="w-3 border-t-2 border-dotted border-(--rd-mute)" />, label: '연결 경로' },
  { mark: <i className="h-[5px] w-3 border-y border-(--rd-mute)" />, label: '선 굵기 = 금액(USD)' },
  { mark: <i className="w-3 border-t-2 border-dotted border-(--rd-danger)" />, label: '흐르는 점 = 돈이 가는 방향' },
]

export function GraphSettings({ ids, withTools = false }: { ids: string[]; withTools?: boolean }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set(ids))
  const [detail, setDetail] = useState(true)
  const toggle = (id: string, next: boolean) => setShown(current => { const copy = new Set(current); if (next) copy.add(id); else copy.delete(id); return copy })
  return (
    <Panel title="그래프 설정" className="w-[370px] shrink-0 self-start" contentClassName="gap-2"
      headerRight={withTools ? <><Button size="sm" aria-label="필터" iconStart={<ListFilter />} className="[&_svg]:size-4" /><Button size="sm" aria-label="정렬" iconStart={<ArrowDownUp />} className="[&_svg]:size-4" /><Button size="sm" iconStart={<Calendar />} className="text-[16px] font-medium [&_svg]:size-4">기간</Button></> : undefined}>
      {ids.map(id => (
        <label key={id} className="flex cursor-pointer items-center gap-3 text-[16px] leading-[1.4] text-(--rd-strong)">
          <Checkbox checked={shown.has(id)} onChange={next => toggle(id, next)} label={`${id} 그래프에 표시`} />
          {id}
        </label>
      ))}
      <div className="flex items-center justify-between">
        <p className="text-[16px] leading-[1.4] text-(--rd-strong)">상세 거래 정보 표시</p>
        <Switch checked={detail} onChange={setDetail} label="상세 거래 정보 표시" />
      </div>
      <p className="text-[14px] leading-[1.4] text-(--rd-mute)">Node와 Edge에 상세 정보가 항상 노출됩니다.</p>
      <p className="text-[16px] leading-[1.4] text-(--rd-line)">선택 계좌 기준 연결 단계 (hop)</p>
      <div className="flex flex-col gap-2 py-1" aria-disabled>
        <div className="relative h-2 w-full rounded-full bg-(--rd-hover)"><i className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--rd-line)" /></div>
        <div className="flex justify-between text-[14px] text-(--rd-line)">{[1, 2, 3, 4, 5].map(step => <span key={step} className={step === 3 ? 'font-semibold text-(--rd-mute)' : undefined}>{step}</span>)}</div>
      </div>
      <p className="text-[14px] leading-[1.4] text-(--rd-line)">그래프에서 계좌 노드를 선택하면<br />hop 범위 설정이 활성화됩니다.</p>
      <p className="pt-1 text-[16px] font-medium leading-[1.4] text-(--rd-ink)">범례</p>
      <ul className="flex flex-col gap-[6px]">
        {legend.map(item => (
          <li key={item.label} className="flex items-center gap-3 text-[12px] leading-[1.4] text-(--rd-mute)">
            <span className="flex w-3 shrink-0 items-center justify-center">{item.mark}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function GraphCanvas({ start, end, progress, chips }: { start: string; end: string; progress: string; chips?: ReactNode }) {
  return (
    <div className="flex min-h-[440px] min-w-0 flex-1 flex-col gap-2">
      <div aria-label="그래프 캔버스" className="flex min-h-0 flex-1 items-start gap-2">{chips}</div>
      <div className="flex w-full items-center gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) px-2">
          <Button aria-label="처음으로" iconStart={<SkipBack />} />
          <Button aria-label="재생" iconStart={<Play />} />
          <Button aria-label="끝으로" iconStart={<SkipForward />} />
          <p className="shrink-0 whitespace-nowrap text-[16px] font-medium text-(--rd-ink)">{start}</p>
          <div className="relative mx-2 h-1 min-w-10 flex-1 rounded-full bg-(--rd-brand-subtle)"><i className="absolute right-0 top-1/2 size-4 -translate-y-1/2 rounded-full bg-(--rd-brand)" /></div>
          <p className="shrink-0 whitespace-nowrap text-[16px] font-medium text-(--rd-ink)">{end}</p>
          <p className="shrink-0 whitespace-nowrap px-2 text-[12px] text-(--rd-sub)">{progress}</p>
        </div>
        <div className="flex h-11 shrink-0 items-center gap-1 rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) px-2">
          <Button aria-label="축소" iconStart={<ZoomOut />} />
          <p className="rd-mono w-12 text-center text-[14px] text-(--rd-sub)">100%</p>
          <Button aria-label="확대" iconStart={<ZoomIn />} />
          <Button aria-label="화면에 맞추기" iconStart={<Crosshair />} />
        </div>
      </div>
    </div>
  )
}

export function GraphDetail() {
  return (
    <Panel title="상세 내용" className="w-[370px] shrink-0 self-stretch" headerRight={<Button size="sm" aria-label="상세 내용 내려받기" iconStart={<Download />} className="[&_svg]:size-4" />}>
      <p className="text-[16px] leading-[1.4] text-(--rd-strong)">계좌 또는 거래를 선택하세요.</p>
    </Panel>
  )
}
