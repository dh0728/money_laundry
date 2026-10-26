import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Send, PanelRight, PictureInPicture2, X, Plus, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { IconButton } from './shared'
import { usd, type RecordItem } from './domain'

export type AgentMode = 'sidebar' | 'floating'
export const AGENT_NAME = 'RDR 9000'
type Message = { role: 'user' | 'assistant'; text: string }
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
/** FAB·채팅 아바타 공통 크기(px). 드래그 금지구역: 헤더·사이드바 */
export const FAB_SIZE = 56
export type FabOrigin = { left: number; top: number; width: number; height: number }
let pendingFabOrigin: FabOrigin | null = null
export const takeFabOrigin = () => { const o = pendingFabOrigin; pendingFabOrigin = null; return o }
// v20 R10: 본문 스크롤바를 침범하지 않도록 오른쪽 한계는 .app-main 스크롤바의 왼쪽 경계다.
export const rightLimit = () => {
  const main = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.app-main')
  if (!main) return globalThis.innerWidth ?? 1440
  return Math.floor(main.getBoundingClientRect().right - (main.offsetWidth - main.clientWidth))
}
export const peekFabDragBounds = () => {
  const header = document.querySelector<HTMLElement>('.app-header')
  const sidebar = document.querySelector<HTMLElement>('.app-sidebar') ?? document.querySelector<HTMLElement>('[data-slot="sidebar"]')
  const minLeft = Math.ceil((sidebar?.getBoundingClientRect().right ?? 210) + 8)
  const minTop = Math.ceil((header?.getBoundingClientRect().bottom ?? 60) + 8)
  const maxLeft = Math.max(minLeft, rightLimit() - FAB_SIZE - 8)
  const maxTop = Math.max(minTop, (globalThis.innerHeight ?? 900) - FAB_SIZE - 8)
  return { minLeft, minTop, maxLeft, maxTop }
}
export const clampFabPos = (left: number, top: number) => {
  const b = peekFabDragBounds()
  return { left: clamp(left, b.minLeft, b.maxLeft), top: clamp(top, b.minTop, b.maxTop) }
}

/** 닫힐 때 심볼이 돌아갈 FAB 자리(저장된 위치 또는 우하단 기본) */
export const fabHomeRect = (): FabOrigin => {
  try {
    const raw = localStorage.getItem('aml-rdr-fab-pos')
    if (raw) {
      const p = JSON.parse(raw) as { left: number; top: number }
      if (typeof p.left === 'number' && typeof p.top === 'number') {
        const c = clampFabPos(p.left, p.top)
        return { left: c.left, top: c.top, width: FAB_SIZE, height: FAB_SIZE }
      }
    }
  } catch { /* ignore */ }
  const vw = globalThis.innerWidth ?? 1440
  const vh = globalThis.innerHeight ?? 900
  return { left: Math.min(vw, rightLimit()) - 24 - FAB_SIZE, top: vh - 24 - FAB_SIZE, width: FAB_SIZE, height: FAB_SIZE }
}

const SIDEBAR_DEFAULT = 390, SIDEBAR_MIN = 320, SIDEBAR_MAX = 720
const HISTORY_DEFAULT = 360, HISTORY_MIN = 280, HISTORY_MAX = 560
const FLOAT_W_DEFAULT = 400, FLOAT_H_DEFAULT = 620, FLOAT_MIN_W = 320, FLOAT_MIN_H = 360
/** R4: 세로 뷰포트에서도 플로팅 패널이 화면 밖으로 나가지 않도록 크기·위치를 뷰포트에 맞춤 */
const fitFloatSize = (size: { width: number; height: number }, vw = globalThis.innerWidth ?? 1440, vh = globalThis.innerHeight ?? 900) => {
  const maxW = Math.max(160, Math.min(vw - 16, vw * 0.9))
  const maxH = Math.max(160, Math.min(vh - 16, vh * 0.85))
  return {
    width: clamp(size.width, Math.min(FLOAT_MIN_W, maxW), maxW),
    height: clamp(size.height, Math.min(FLOAT_MIN_H, maxH), maxH),
  }
}
const fitFloatPosition = (pos: { x: number; y: number }, size: { width: number; height: number }, vw = globalThis.innerWidth ?? 1440, vh = globalThis.innerHeight ?? 900) => ({
  x: clamp(pos.x, 8, Math.max(8, Math.min(vw, rightLimit()) - size.width - 8)),
  y: clamp(pos.y, 8, Math.max(8, vh - size.height - 8)),
})

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

// v18: Notion-style floating action button (FAB). 헤더 pill이 아니라 화면 우하단 고정.
// 에이전트가 닫혀 있을 때만 보이고, 열리면 패널 쪽 close로 닫는다.
export function AgentFab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const fabRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ px: number; py: number; left: number; top: number; moved: boolean } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('aml-rdr-fab-pos')
      if (!raw) return
      const p = JSON.parse(raw) as { left: number; top: number }
      if (typeof p.left === 'number' && typeof p.top === 'number') setPos(clampFabPos(p.left, p.top))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const reclamp = () => setPos(curr => (curr ? clampFabPos(curr.left, curr.top) : curr))
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [])

  if (open) return null

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const el = fabRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    drag.current = { px: e.clientX, py: e.clientY, left: r.left, top: r.top, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.px
    const dy = e.clientY - drag.current.py
    if (Math.hypot(dx, dy) > 4) drag.current.moved = true
    if (!drag.current.moved) return
    setPos(clampFabPos(drag.current.left + dx, drag.current.top + dy))
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    try { fabRef.current?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d?.moved) {
      setPos(curr => {
        if (curr) try { localStorage.setItem('aml-rdr-fab-pos', JSON.stringify(curr)) } catch { /* ignore */ }
        return curr
      })
      return
    }
    const r = fabRef.current?.getBoundingClientRect()
    if (r) pendingFabOrigin = { left: r.left, top: r.top, width: r.width, height: r.height }
    onToggle()
  }

  // 기본 자리도 본문 스크롤바 안쪽 24px(v20 R10)
  const style = pos
    ? ({ left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } as const)
    : ({ right: Math.max(24, (globalThis.innerWidth ?? 1440) - rightLimit() + 24) } as const)

  return (
    <button
      ref={fabRef}
      type="button"
      aria-pressed={false}
      aria-label={`${AGENT_NAME} 열기`}
      data-testid="agent-toggle"
      className={`agent-fab fixed z-50 size-14 rounded-full overflow-hidden border-0 bg-transparent p-0 shadow-none touch-none ${pos ? '' : 'bottom-6 right-6'}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null }}
    >
      <RadarSweep className="size-14 block pointer-events-none" glow={false} />
    </button>
  )
}

export const AgentToggle = AgentFab

export default function Agent({ open, setOpen, mode, setMode, record, records }: { open: boolean; setOpen: (o: boolean) => void; mode: AgentMode; setMode: (m: AgentMode) => void; record?: RecordItem; records: RecordItem[] }) {
  const [input, setInput] = useState(''), [messages, setMessages] = useState<Message[]>([]), [historyOpen, setHistoryOpen] = useState(false)

  const avatarRef = useRef<HTMLButtonElement>(null)
  const [avatarVisible, setAvatarVisible] = useState(false)
  const [morph, setMorph] = useState<{ from: FabOrigin; to: FabOrigin } | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!open) { setAvatarVisible(false); setMorph(null); setClosing(false); return }
    const from = takeFabOrigin()
    if (!from) { setAvatarVisible(true); return }
    // 패널 레이아웃 후 아바타 위치로 모프
    let raf2 = 0
    const id = requestAnimationFrame(() => {
      const toEl = avatarRef.current
      if (!toEl) { setAvatarVisible(true); return }
      const r = toEl.getBoundingClientRect()
      const to = { left: r.left, top: r.top, width: r.width, height: r.height }
      setMorph({ from, to: from }) // 첫 페인트는 FAB 위치
      raf2 = requestAnimationFrame(() => setMorph({ from, to }))
    })
    return () => { cancelAnimationFrame(id); cancelAnimationFrame(raf2) }
  }, [open])
  const [floatSize, setFloatSize] = useState(() => fitFloatSize({ width: FLOAT_W_DEFAULT, height: FLOAT_H_DEFAULT }))
  const [position, setPosition] = useState(() => {
    const size = fitFloatSize({ width: FLOAT_W_DEFAULT, height: FLOAT_H_DEFAULT })
    const vw = globalThis.innerWidth ?? 1440
    return fitFloatPosition({ x: Math.max(24, vw - size.width - 40), y: 88 }, size)
  })
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [historyWidth, setHistoryWidth] = useState(HISTORY_DEFAULT)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const sidebarResize = useRef<{ x: number; width: number } | null>(null)
  const historyResize = useRef<{ x: number; width: number } | null>(null)
  const floatResize = useRef<{ x: number; y: number; width: number; height: number; axis: 'x' | 'y' | 'both' } | null>(null)
  // 사이드바 폭은 CSS 변수로 내보내 App.tsx의 .agent-sidebar-space가 본문 margin을 같은 값으로 맞추게 한다
  useEffect(() => { document.documentElement.style.setProperty('--agent-width', `${sidebarWidth}px`) }, [sidebarWidth])
  // R4: 플로팅 + 세로 뷰포트에서 패널이 화면 밖으로 나가지 않도록 리사이즈·모드 전환 시 클램프
  useEffect(() => {
    if (!open || mode !== 'floating') return
    const reclamp = () => {
      setFloatSize(s => {
        const next = fitFloatSize(s)
        setPosition(p => fitFloatPosition(p, next))
        return next
      })
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [open, mode])
  const startSidebarResize = (e: PointerEvent<HTMLDivElement>) => { sidebarResize.current = { x: e.clientX, width: sidebarWidth }; e.currentTarget.setPointerCapture(e.pointerId) }
  const moveSidebarResize = (e: PointerEvent<HTMLDivElement>) => { if (!sidebarResize.current) return; setSidebarWidth(clamp(sidebarResize.current.width + (sidebarResize.current.x - e.clientX), SIDEBAR_MIN, SIDEBAR_MAX)) }
  const endSidebarResize = () => { sidebarResize.current = null }
  const startHistoryResize = (e: PointerEvent<HTMLDivElement>) => { historyResize.current = { x: e.clientX, width: historyWidth }; e.currentTarget.setPointerCapture(e.pointerId) }
  const moveHistoryResize = (e: PointerEvent<HTMLDivElement>) => { if (!historyResize.current) return; setHistoryWidth(clamp(historyResize.current.width + (historyResize.current.x - e.clientX), HISTORY_MIN, HISTORY_MAX)) }
  const endHistoryResize = () => { historyResize.current = null }
  const startFloatResize = (axis: 'x' | 'y' | 'both') => (e: PointerEvent<HTMLDivElement>) => {
    floatResize.current = { x: e.clientX, y: e.clientY, width: floatSize.width, height: floatSize.height, axis }; e.currentTarget.setPointerCapture(e.pointerId); e.stopPropagation()
  }
  const moveFloatResize = (e: PointerEvent<HTMLDivElement>) => {
    const r = floatResize.current
    if (!r) return
    setFloatSize(prev => fitFloatSize({
      width: r.axis === 'y' ? prev.width : r.width + (e.clientX - r.x),
      height: r.axis === 'x' ? prev.height : r.height + (e.clientY - r.y),
    }))
  }
  const endFloatResize = () => { floatResize.current = null }
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
  // 플로팅 패널에서 header의 빈 곳만 drag로 본다.
  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'floating' || !e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y }; e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || mode !== 'floating') return
    setPosition(fitFloatPosition({
      x: drag.current.left + e.clientX - drag.current.x,
      y: drag.current.top + e.clientY - drag.current.y,
    }, floatSize))
  }
  if (!open) return null

  const conversations = [`현재 조사 · ${record?.id ?? '오늘 요약'}`, '어제 조사 · ALT-2026-1827', '주간 고위험 업무 요약']
  // 이전 대화 목록: 대화창 뒤에 포개져 있다가 왼쪽으로 스르륵 펼쳐지고, 다시 누르면 뒤로 접힌다. 왼쪽 끝 hairline으로 폭도 조절된다
  const history = (
    <aside data-testid="agent-history" data-open={historyOpen} aria-hidden={!historyOpen} inert={!historyOpen}
      className={`agent-history absolute top-0 bottom-0 right-full z-0 flex flex-col border-y border-l bg-background rounded-l-lg ${historyOpen ? 'is-open' : ''}`}
      style={{ width: historyWidth }}>
      <div role="separator" aria-orientation="vertical" aria-label="이전 대화 너비 조절" className="agent-resize-handle agent-resize-handle-x absolute left-0 top-0 bottom-0 z-10"
        onPointerDown={startHistoryResize} onPointerMove={moveHistoryResize} onPointerUp={endHistoryResize} onPointerCancel={endHistoryResize} />
      <div className="p-3"><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setMessages([])}><Plus className="size-3.5" />새 대화</Button></div>
      <p className="px-3 pb-2 text-[10px] font-medium text-muted-foreground">이전 대화</p>
      <div className="px-2 space-y-1">{conversations.map((c, i) => <Button key={c} variant={i === 0 ? 'secondary' : 'ghost'} size="sm" className="w-full justify-start overflow-hidden text-xs"><span className="truncate">{c}</span></Button>)}</div>
    </aside>
  )
  const header = (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 select-none cursor-default" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className="flex items-center gap-1.5">
        <IconButton label={historyOpen ? '이전 대화 접기' : '이전 대화 펼치기'} className="size-8" onClick={() => setHistoryOpen(v => !v)}><Menu className="size-4" /></IconButton>
        <div className="text-sm font-semibold font-mono tracking-wide whitespace-nowrap">{AGENT_NAME}</div>
      </div>
      <div className="flex gap-0.5">
        <IconButton label={mode === 'sidebar' ? '플로팅 패널로 보기' : '우측 사이드바로 보기'} className="size-8" onClick={() => setMode(mode === 'sidebar' ? 'floating' : 'sidebar')}>
          {mode === 'sidebar' ? <PictureInPicture2 className="size-4" /> : <PanelRight className="size-4" />}
        </IconButton>
        <IconButton label={`${AGENT_NAME} 닫기`} className="size-8" onClick={() => requestClose()}><X className="size-4" /></IconButton>
      </div>
    </div>
  )
  const chat = (
    <div className={`agent-chat relative z-10 flex flex-col flex-1 min-w-0 min-h-0 h-full overflow-hidden border bg-background shadow-xl ${historyOpen ? 'rounded-r-lg rounded-l-none' : 'rounded-lg'}`}>
      {mode === 'sidebar' && (
        <div role="separator" aria-orientation="vertical" aria-label="도우미 너비 조절" className="agent-resize-handle agent-resize-handle-x absolute left-0 top-0 bottom-0 z-20"
          onPointerDown={startSidebarResize} onPointerMove={moveSidebarResize} onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize} />
      )}
      {header}
      <div className="flex gap-2 items-center px-4 py-3 text-[11px] text-muted-foreground"><Badge variant="outline" className="text-[10px]">예시 응답</Badge>{record?.id ?? '대시보드 · 오늘 요약'}</div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          <div className="space-y-3">
            <button ref={avatarRef} type="button" aria-label={`${AGENT_NAME} 심볼로 닫기`} onClick={() => requestClose()}
              className={`rdr-avatar size-14 shrink-0 rounded-full border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-ring ${avatarVisible ? "opacity-100" : "opacity-0"}`}>
              <RadarSweep className="size-14 block" />
            </button>
            <p className="text-sm leading-7 whitespace-pre-wrap">{summary}</p>
            <div className="flex flex-wrap gap-2">{['주요 근거 확인', '검토 우선순위 요약'].map(q => <Button key={q} variant="outline" size="sm" className="text-xs" onClick={() => send(q)}>{q}</Button>)}</div>
          </div>
          {messages.map((m, i) => <div key={i} className={m.role === 'user' ? 'ml-auto max-w-[80%] w-fit rounded-2xl bg-muted px-4 py-2.5 text-sm' : 'text-sm leading-7 py-2 whitespace-pre-wrap'}>{m.text}</div>)}
        </div>
      </ScrollArea>
      <form className="p-4 border-t" onSubmit={e => { e.preventDefault(); send() }}>
        <div className="relative">
          <Textarea aria-label={`${AGENT_NAME}에게 질문`} placeholder="현재 조사에 대해 질문하세요" className="min-h-24 resize-y pr-12 text-xs" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
          <Button size="icon" className="absolute bottom-2 right-2 size-7" disabled={!input.trim()} aria-label="질문 보내기"><Send className="size-3.5" /></Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">화면 검토용 예시 · 실제 모델·외부 전송 없음 · 판단은 조사자가 내림</p>
      </form>
      {mode === 'floating' && (
        <>
          <div role="separator" aria-orientation="vertical" aria-label="도우미 너비 조절" className="agent-resize-handle agent-resize-handle-x absolute right-0 top-0 bottom-0 z-20"
            onPointerDown={startFloatResize('x')} onPointerMove={moveFloatResize} onPointerUp={endFloatResize} onPointerCancel={endFloatResize} />
          <div role="separator" aria-orientation="horizontal" aria-label="도우미 높이 조절" className="agent-resize-handle agent-resize-handle-y absolute left-0 right-0 bottom-0 z-20"
            onPointerDown={startFloatResize('y')} onPointerMove={moveFloatResize} onPointerUp={endFloatResize} onPointerCancel={endFloatResize} />
          <div role="separator" aria-orientation="horizontal" aria-label="도우미 크기 조절" className="agent-resize-handle agent-resize-handle-corner absolute right-0 bottom-0 z-20 cursor-nwse-resize"
            onPointerDown={startFloatResize('both')} onPointerMove={moveFloatResize} onPointerUp={endFloatResize} onPointerCancel={endFloatResize} />
        </>
      )}
    </div>
  )
  const style = mode === 'floating' ? { left: position.x, top: position.y, width: floatSize.width, height: floatSize.height } : { width: sidebarWidth }
  const shell = mode === 'sidebar' ? 'fixed z-50 right-0 top-15 bottom-0 max-w-[92vw]'
    : 'fixed z-50 max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)]'


  const requestClose = () => {
    if (closing) return
    const el = avatarRef.current
    const r = el?.getBoundingClientRect()
    if (!r || r.width < 1) { setOpen(false); return }
    const from: FabOrigin = { left: r.left, top: r.top, width: r.width, height: r.height }
    const to = fabHomeRect()
    setClosing(true)
    setAvatarVisible(false)
    setMorph({ from, to: from })
    requestAnimationFrame(() => requestAnimationFrame(() => setMorph({ from, to })))
  }

  const morphLayer = morph && createPortal(
    <div
      className="rdr-morph pointer-events-none fixed z-[80] overflow-hidden rounded-full"
      style={{
        left: morph.to.left,
        top: morph.to.top,
        width: morph.to.width,
        height: morph.to.height,
        transition: 'left 420ms cubic-bezier(0.22,1,0.36,1), top 420ms cubic-bezier(0.22,1,0.36,1), width 420ms cubic-bezier(0.22,1,0.36,1), height 420ms cubic-bezier(0.22,1,0.36,1)',
      }}
      onTransitionEnd={() => {
        if (closing) {
          setMorph(null)
          setClosing(false)
          setOpen(false)
          return
        }
        setMorph(null)
        setAvatarVisible(true)
      }}
    >
      <RadarSweep className="size-full block" />
    </div>,
    document.body,
  )

  return <>
    {morphLayer}
    <section aria-label={AGENT_NAME} data-closing={closing || undefined} data-mode={mode} className={`${shell} flex transition-opacity duration-300 ${closing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={style}>{history}{chat}</section>
    </>
}
