import { useId, useRef, useState, type PointerEvent } from 'react'
import { Send, PanelRight, AppWindow, Maximize2, X, Plus, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { IconButton } from './shared'
import { usd, type RecordItem } from './domain'

export type AgentMode = 'sidebar' | 'floating' | 'full'
export const AGENT_NAME = 'RDR 9000'
type Message = { role: 'user' | 'assistant'; text: string }

/* v16: "레이더가 도는지 안 보이고 섬뜩함이 약해졌다"는 지적으로 다시 그렸다.
   HAL 9000의 렌즈를 그대로 베끼지 않되 그 절충점(어둡고 위협적인 원판 + 붉은 코어 글로우)만 빌려온다:
   근접 흑색 disc + 얇은 금속 bezel 테두리 위에 붉은 sweep 조각 5개가 옅어지는 잔상을 그리며 함께 회전한다.
   reduced-motion에서는 회전을 멈추고 마지막 조각 위치의 정지 부채꼴만 남긴다. */
export function RadarSweep({ className = 'size-5', glow = false }: { className?: string; glow?: boolean }) {
  const id = useId().replace(/:/g, '')
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden data-testid="rdr-eye">
      <defs>
        <radialGradient id={`${id}-core`} cx="16" cy="16" r="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff8189" />
          <stop offset=".4" stopColor="var(--graph-l1)" />
          <stop offset="1" stopColor="#38050a" />
        </radialGradient>
        <linearGradient id={`${id}-bezel`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#55555e" />
          <stop offset=".5" stopColor="#0a0a0c" />
          <stop offset="1" stopColor="#2e2e35" />
        </linearGradient>
      </defs>
      {/* 근접 흑색 disc + 얇은 금속 bezel */}
      <circle cx="16" cy="16" r="15" fill="#08080a" stroke={`url(#${id}-bezel)`} strokeWidth="1.5" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#000" strokeOpacity=".5" strokeWidth=".5" />
      {/* 붉은 코어는 작게 두고(HAL의 눈), 그 바깥 어두운 원판 위로 sweep이 돌아 24px에서도 회전이 보이게 한다 */}
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".3" strokeWidth=".6" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".25" strokeWidth=".5" />
      <g>
        <path d="M16 16 L16.00 3.00 A13 13 0 0 1 18.70 3.28 Z" fill="var(--graph-l1)" fillOpacity="0.05" />
        <path d="M16 16 L18.70 3.28 A13 13 0 0 1 21.29 4.12 Z" fill="var(--graph-l1)" fillOpacity="0.1" />
        <path d="M16 16 L21.29 4.12 A13 13 0 0 1 23.64 5.48 Z" fill="var(--graph-l1)" fillOpacity="0.16" />
        <path d="M16 16 L23.64 5.48 A13 13 0 0 1 25.66 7.30 Z" fill="var(--graph-l1)" fillOpacity="0.24" />
        <path d="M16 16 L25.66 7.30 A13 13 0 0 1 27.26 9.50 Z" fill="var(--graph-l1)" fillOpacity="0.34" />
        <path d="M16 16 L27.26 9.50 A13 13 0 0 1 28.36 11.98 Z" fill="var(--graph-l1)" fillOpacity="0.46" />
        <path d="M16 16 L28.36 11.98 A13 13 0 0 1 28.93 14.64 Z" fill="var(--graph-l1)" fillOpacity="0.62" />
        <path d="M16 16 L28.93 14.64 A13 13 0 0 1 28.93 17.36 Z" fill="var(--graph-l1)" fillOpacity="0.82" />
        <path d="M16 16 L28.93 17.36" stroke="#ff5a5a" strokeWidth="1.4" strokeLinecap="round" />
        {!reduceMotion && <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="2.2s" repeatCount="indefinite" />}
      </g>
      <circle cx="16" cy="16" r="5" fill={`url(#${id}-core)`} className={glow ? 'rdr-glow' : undefined} />
      <circle cx="16" cy="16" r="1.3" fill="#fff" fillOpacity=".85" />
    </svg>
  )
}
/** 다른 곳에서 옛 이름으로 import해도 깨지지 않도록 유지하는 호환용 별칭 */
export const RdrEye = RadarSweep

// 헤더 검색창 오른쪽의 토글 pill. 열린 동안 선택 상태로 보인다.
// 헤더가 좁아지면(<1100px) 이름 글자를 지우고 정원형 icon button으로 줄어든다. aria-label은 그대로 유지된다.
export function AgentToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button type="button" variant={open ? 'secondary' : 'outline'} size="sm" aria-pressed={open} aria-label={open ? `${AGENT_NAME} 닫기` : `${AGENT_NAME} 열기`} data-testid="agent-toggle"
      className="agent-toggle h-9 shrink-0 rounded-full pl-1.5 pr-3.5 gap-2 font-mono text-xs tracking-wide max-[1100px]:w-9 max-[1100px]:px-0 max-[1100px]:justify-center" onClick={onToggle}>
      <RadarSweep className="size-6 shrink-0" glow={open} /><span className="max-[1100px]:hidden">{AGENT_NAME}</span>
    </Button>
  )
}

export default function Agent({ open, setOpen, mode, setMode, record, records }: { open: boolean; setOpen: (o: boolean) => void; mode: AgentMode; setMode: (m: AgentMode) => void; record?: RecordItem; records: RecordItem[] }) {
  const [input, setInput] = useState(''), [messages, setMessages] = useState<Message[]>([]), [historyOpen, setHistoryOpen] = useState(false)
  const [position, setPosition] = useState(() => ({ x: Math.max(24, (globalThis.innerWidth ?? 1440) - 440), y: 88 }))
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const summary = record
    ? `${record.id}에서 ${record.pattern} 유형이 ${record.probability}% 확률로 탐지됨.\n근거 거래 ${record.count}건, 총 ${usd(record.amount)} 확인됨. 계좌 간 관계와 거래 목적 확인 필요.`
    : `현재 미처리 업무 ${records.filter(r => r.status !== '종결').length}건 중 고위험 ${records.filter(r => r.risk === '고위험' && r.status !== '종결').length}건 확인됨.\n위험 점수와 경과 기간을 함께 확인하여 우선 검토 필요.`
  const send = (text = input) => {
    if (!text.trim()) return
    const answer = /근거|거래|흐름/.test(text)
      ? `${record ? record.id : '선택한 업무'}의 자금 흐름 및 거래 탭에서 송금 방향·거래 일시·금액 대조 필요. 연결 계좌의 반복 송금 여부와 실제 거래 목적 확인 필요.\n\n이 응답은 화면 검토용 예시이며 추가 분석은 수행되지 않음.`
      : /요약|우선/.test(text) ? summary : `질문 확인됨. ${record ? record.id + '의' : '목록에서 조사할 항목의'} 탐지 근거와 처리 이력을 함께 확인할 필요가 있음.\n\n자유 질문에 대한 모델 분석은 연결되지 않은 상태임.`
    setMessages(p => [...p, { role: 'user', text }, { role: 'assistant', text: answer }]); setInput('')
  }
  const modes = [{ value: 'sidebar', label: '우측 사이드바', icon: PanelRight }, { value: 'floating', label: '플로팅 패널', icon: AppWindow }, { value: 'full', label: '전체화면', icon: Maximize2 }] as const
  const activeMode = modes.find(i => i.value === mode)!
  // portal로 뜬 표시 방식 menu의 이벤트도 React 트리를 타고 header까지 올라오므로, header DOM 안에서 시작한 pointer만 drag로 본다
  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'floating' || !e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest('button,[role=menu],[role=menuitemradio]')) return
    drag.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y }; e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || mode !== 'floating') return
    setPosition({ x: Math.max(8, Math.min(window.innerWidth - 408, drag.current.left + e.clientX - drag.current.x)), y: Math.max(8, Math.min(window.innerHeight - 628, drag.current.top + e.clientY - drag.current.y)) })
  }
  if (!open) return null

  const conversations = [`현재 조사 · ${record?.id ?? '오늘 요약'}`, '어제 조사 · ALT-2026-1827', '주간 고위험 업무 요약']
  // 이전 대화 목록: 대화창 뒤에 포개져 있다가 왼쪽으로 스르륵 펼쳐지고, 다시 누르면 뒤로 접힌다
  const history = (
    <aside data-testid="agent-history" data-open={historyOpen} aria-hidden={!historyOpen} inert={!historyOpen}
      className={`agent-history absolute top-0 bottom-0 right-full z-0 w-56 flex flex-col border bg-background shadow-xl ${mode === 'full' ? 'rounded-l-lg' : 'rounded-l-lg'} ${historyOpen ? 'is-open' : ''}`}>
      <div className="p-3"><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setMessages([])}><Plus className="size-3.5" />새 대화</Button></div>
      <p className="px-3 pb-2 text-[10px] font-medium text-muted-foreground">이전 대화</p>
      <div className="px-2 space-y-1">{conversations.map((c, i) => <Button key={c} variant={i === 0 ? 'secondary' : 'ghost'} size="sm" className="w-full justify-start overflow-hidden text-xs"><span className="truncate">{c}</span></Button>)}</div>
    </aside>
  )
  const header = (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 select-none cursor-default" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className="flex items-center gap-1.5">
        <IconButton label={historyOpen ? '이전 대화 접기' : '이전 대화 펼치기'} className="size-8" onClick={() => setHistoryOpen(v => !v)}><Menu className="size-4" /></IconButton>
        <div className="flex items-center gap-2 text-sm font-semibold font-mono tracking-wide whitespace-nowrap"><RadarSweep className="size-5" glow />{AGENT_NAME}</div>
      </div>
      <div className="flex gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 text-xs" aria-label={`표시 방식: ${activeMode.label}`}><activeMode.icon className="size-3.5" />{activeMode.label}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={mode} onValueChange={v => setMode(v as AgentMode)}>{modes.map(i => <DropdownMenuRadioItem key={i.value} value={i.value}><i.icon className="size-3.5" />{i.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <IconButton label={`${AGENT_NAME} 닫기`} className="size-8" onClick={() => setOpen(false)}><X className="size-4" /></IconButton>
      </div>
    </div>
  )
  const chat = (
    <div className="agent-chat relative z-10 flex flex-col flex-1 min-w-0 min-h-0 h-full overflow-hidden rounded-lg border bg-background shadow-xl">
      {header}
      <div className="flex gap-2 items-center px-4 py-3 text-[11px] text-muted-foreground border-b"><Badge variant="outline" className="text-[10px]">예시 응답</Badge>{record?.id ?? '대시보드 · 오늘 요약'}</div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          <div className="space-y-3">
            <RadarSweep className="size-7" />
            <p className="text-sm leading-7 whitespace-pre-wrap">{summary}</p>
            <div className="flex flex-wrap gap-2">{['주요 근거 확인', '검토 우선순위 요약'].map(q => <Button key={q} variant="outline" size="sm" className="text-xs" onClick={() => send(q)}>{q}</Button>)}</div>
          </div>
          {messages.map((m, i) => <div key={i} className={m.role === 'user' ? 'ml-6 bg-muted rounded-lg p-3 text-sm' : 'text-sm leading-7 py-2 whitespace-pre-wrap'}>{m.text}</div>)}
        </div>
      </ScrollArea>
      <form className="p-4 border-t" onSubmit={e => { e.preventDefault(); send() }}>
        <div className="relative">
          <Textarea aria-label={`${AGENT_NAME}에게 질문`} placeholder="현재 조사에 대해 질문하세요" className="min-h-24 resize-none pr-12 text-xs" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
          <Button size="icon" className="absolute bottom-2 right-2 size-7" disabled={!input.trim()} aria-label="질문 보내기"><Send className="size-3.5" /></Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">화면 검토용 예시 · 실제 모델·외부 전송 없음 · 판단은 조사자가 내림</p>
      </form>
    </div>
  )
  const style = mode === 'floating' ? { left: position.x, top: position.y } : undefined
  // 전체화면은 왼쪽에 펼칠 공간이 없으므로 목록 폭만큼 오른쪽에서 시작해 대화창이 폭을 유지한다
  const shell = mode === 'sidebar' ? 'fixed z-50 right-0 top-15 bottom-0 w-[390px] max-w-[92vw]'
    : mode === 'full' ? `fixed z-50 top-4 bottom-4 right-4 transition-[left] duration-300 ${historyOpen ? 'left-[240px]' : 'left-4'}`
      : 'fixed z-50 w-[400px] h-[620px] max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)]'
  return <section aria-label={AGENT_NAME} data-mode={mode} className={`${shell} flex`} style={style}>{history}{chat}</section>
}
