import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PanelRight, PictureInPicture2, Plus, Send, X } from 'lucide-react'
import { Rnd } from 'react-rnd'
import { IconButton } from '@/components/IconButton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatScore } from '@/api/codes'
import { live } from '@/lib/apiMode'
import type { AgentRecord } from './agentData'

export type AgentMode = 'sidebar' | 'floating'
const name = 'RDR 9000'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
type Message = { role: 'user' | 'assistant'; text: string }
type Rect = { left: number; top: number; width: number; height: number }
type Morph = { kind: 'opening' | 'closing'; rect: Rect; id: number }
let pendingTriggerOrigin: Rect | null = null
const takeTriggerOrigin = () => { const origin = pendingTriggerOrigin; pendingTriggerOrigin = null; return origin }

function RadarSweep({ className = 'size-14' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return <svg viewBox="0 0 32 32" className={className} aria-hidden data-testid="rdr-eye">
    <defs>
      <radialGradient id={`${id}-core`} cx="16" cy="16" r="5" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-core-hot)" /><stop offset=".4" stopColor="var(--graph-l1)" /><stop offset="1" stopColor="var(--radar-core-deep)" />
      </radialGradient>
      <linearGradient id={`${id}-bezel`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-bezel-light)" /><stop offset=".5" stopColor="var(--radar-bezel-mid)" /><stop offset="1" stopColor="var(--radar-bezel-dark)" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="15" fill="var(--radar-disc)" stroke={`url(#${id}-bezel)`} strokeWidth="1.5" />
    <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".3" strokeWidth=".6" />
    <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".25" strokeWidth=".5" />
    <g>
      <path d="M16 16 L16 3 A13 13 0 0 1 18.7 3.28 Z" fill="var(--graph-l1)" fillOpacity=".08" />
      <path d="M16 16 L18.7 3.28 A13 13 0 0 1 23.64 5.48 Z" fill="var(--graph-l1)" fillOpacity=".2" />
      <path d="M16 16 L23.64 5.48 A13 13 0 0 1 28.93 17.36 Z" fill="var(--graph-l1)" fillOpacity=".6" />
      <path d="M16 16 L28.93 17.36" stroke="var(--radar-core-hot)" strokeWidth="1.4" strokeLinecap="round" />
      {!reducedMotion && <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="2.2s" repeatCount="indefinite" />}
    </g>
    <circle cx="16" cy="16" r="5" fill={`url(#${id}-core)`} className="rdr-glow" />
    <circle cx="16" cy="16" r="1.3" fill="var(--radar-bezel-light)" fillOpacity=".85" />
  </svg>
}

function triggerHomeRect(): Rect {
  const rect = document.querySelector('[data-testid="agent-toggle"] svg')?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: innerWidth - 48, top: 12, width: 32, height: 32 }
}

export function AgentTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <button type="button" aria-label={open ? `${name} 패널 숨기기` : `${name} 열기`} aria-expanded={open} data-testid="agent-toggle" title={name} className="agent-trigger inline-flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring" onClick={event => {
    const rect = event.currentTarget.querySelector('svg')?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()
    pendingTriggerOrigin = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    onToggle()
  }}><RadarSweep className="size-8" /></button>
}

function answer(text: string, record: AgentRecord | undefined, summary: string) {
  if (/근거|거래|흐름/.test(text)) return `${record?.id ?? '선택한 업무'}의 자금 흐름 및 거래 탭에서 송금 방향·거래 일시·금액 대조가 필요합니다. 연결 계좌의 반복 송금 여부와 실제 거래 목적을 확인하세요.`
  if (/요약|우선/.test(text)) return summary
  return `${record?.id ?? '목록에서 조사할 항목'}의 탐지 근거와 처리 이력을 먼저 확인하세요.\n\n거래 흐름, 주요 근거, 검토 우선순위 중 확인할 내용을 선택하면 조사를 이어갈 수 있습니다.`
}

type Props = { open: boolean; setOpen: (open: boolean) => void; closeRef: { current: () => void }; mode: AgentMode; setMode: (mode: AgentMode) => void; record?: AgentRecord; records: AgentRecord[] }
export default function Agent({ open, setOpen, closeRef, mode, setMode, record, records }: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(390)
  const [floatSize, setFloatSize] = useState({ width: Math.min(400, innerWidth - 16), height: Math.min(620, innerHeight - 16) })
  const [floatPosition, setFloatPosition] = useState({ x: Math.max(8, innerWidth - 440), y: 88 })
  const resizeRef = useRef<{ x: number; width: number } | null>(null)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const [morph, setMorph] = useState<Morph | null>(null)
  const [closing, setClosing] = useState(false)
  const morphId = useRef(0)
  const morphRafs = useRef<number[]>([])
  const morphTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const morphFinish = useRef<(() => void) | null>(null)
  const clearMorph = useCallback(() => {
    morphRafs.current.forEach(cancelAnimationFrame)
    morphRafs.current = []
    if (morphTimer.current) clearTimeout(morphTimer.current)
    morphTimer.current = null
  }, [])
  const finishMorph = useCallback((id: number) => {
    if (id !== morphId.current) return
    clearMorph()
    setMorph(null)
    const finish = morphFinish.current
    morphFinish.current = null
    finish?.()
  }, [clearMorph])
  const startMorph = useCallback((kind: Morph['kind'], from: Rect, to: Rect, finish?: () => void) => {
    clearMorph()
    const id = ++morphId.current
    morphFinish.current = finish ?? null
    setMorph({ kind, rect: from, id })
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => setMorph(current => current?.id === id ? { kind, rect: to, id } : current))
      morphRafs.current = [second]
    })
    morphRafs.current = [first]
    morphTimer.current = setTimeout(() => finishMorph(id), 520)
  }, [clearMorph, finishMorph])
  useLayoutEffect(() => {
    if (!open) return
    const from = takeTriggerOrigin()
    const node = avatarRef.current
    if (!from || (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) return
    if (!node) return
    const to = node.getBoundingClientRect()
    if (to.width > 0) startMorph('opening', from, { left: to.left, top: to.top, width: to.width, height: to.height })
  }, [open, startMorph])
  useEffect(() => () => clearMorph(), [clearMorph])
  const requestClose = useCallback(() => {
    if (closing) return
    const from = avatarRef.current?.getBoundingClientRect()
    if (!from || from.width === 0 || (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) { setOpen(false); return }
    setClosing(true)
    startMorph('closing', { left: from.left, top: from.top, width: from.width, height: from.height }, triggerHomeRect(), () => { setOpen(false); setClosing(false) })
  }, [closing, setOpen, startMorph])
  useLayoutEffect(() => { closeRef.current = requestClose }, [closeRef, requestClose])
  useEffect(() => {
    document.documentElement.style.setProperty('--agent-width', `${sidebarWidth}px`)
    return () => { document.documentElement.style.removeProperty('--agent-width') }
  }, [sidebarWidth])
  useEffect(() => {
    const fitToWindow = () => {
      setFloatSize(current => ({ width: Math.min(current.width, innerWidth - 16), height: Math.min(current.height, innerHeight - 16) }))
      setFloatPosition(current => ({ x: clamp(current.x, 8, Math.max(8, innerWidth - Math.min(floatSize.width, innerWidth - 16) - 8)), y: clamp(current.y, 8, Math.max(8, innerHeight - Math.min(floatSize.height, innerHeight - 16) - 8)) }))
    }
    window.addEventListener('resize', fitToWindow)
    return () => window.removeEventListener('resize', fitToWindow)
  }, [floatSize.width, floatSize.height])
  const pending = records.filter(item => item.status === 'OPEN')
  const summary = record
    ? `${record.id} · ${record.pattern} · 위험 점수 ${formatScore(record.score)}.\n근거 거래 ${record.count}건. 거래 금액은 상세 개요에서 확인하세요. 담당 조사자가 계좌 간 관계와 거래 목적을 확인합니다.`
    : records.length
      ? `전체 미처리 업무 ${pending.length}건 중 위험 점수 0.80 이상 ${pending.filter(item => item.score >= 0.8).length}건 확인됨.\n담당 조사자는 위험 점수와 경과 기간을 확인하고, 관리자는 지연 현황을 살펴봅니다.`
      : '조사할 Alert 또는 Episode를 선택하면 해당 사건의 근거를 함께 살펴볼 수 있습니다.'
  const send = (text = input) => {
    if (!text.trim()) return
    setMessages(current => [...current, { role: 'user', text }, { role: 'assistant', text: answer(text, record, summary) }])
    setInput('')
  }
  if (!open) return null
  const header = <div data-testid="agent-header" className={`agent-drag-handle flex items-center justify-between gap-2 border-b px-3 py-2.5 ${mode === 'floating' ? 'cursor-move' : ''}`}>
    <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide"><button ref={avatarRef} type="button" aria-label={`${name} 심볼로 닫기`} onClick={requestClose} disabled={Boolean(morph) || closing} className={`agent-logo rdr-avatar size-6 shrink-0 rounded-full p-0 ${morph ? 'invisible opacity-0' : ''}`}><RadarSweep className="size-6" /></button>{name}{live && <span className="rounded-full border px-2 py-0.5 font-sans text-[10px] font-normal">mock</span>}</span>
    <div className="agent-action flex gap-0.5">
      <IconButton label="새 대화" className="size-8" onClick={() => setMessages([])}><Plus className="size-4" /></IconButton>
      <IconButton label={mode === 'sidebar' ? '플로팅 패널로 보기' : '우측 사이드바로 보기'} className="size-8" onClick={() => setMode(mode === 'sidebar' ? 'floating' : 'sidebar')}>
        {mode === 'sidebar' ? <PictureInPicture2 className="size-4" /> : <PanelRight className="size-4" />}
      </IconButton>
      <IconButton label={`${name} 닫기`} className="size-8" onClick={requestClose}><X className="size-4" /></IconButton>
    </div>
  </div>
  const content = <section aria-label={name} data-mode={mode} data-closing={closing || undefined} className={`agent-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl ${closing ? 'pointer-events-none opacity-0' : ''}`}>
    {header}
    <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground"><span>{record?.id ?? '전체 업무 · 오늘 요약'}</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="space-y-3"><p className="whitespace-pre-wrap text-sm leading-7">{summary}</p>
        <div className="flex flex-wrap gap-2">{['주요 근거 확인', '검토 우선순위 요약'].map(question => <Button key={question} variant="outline" size="sm" className="text-xs" onClick={() => send(question)}>{question}</Button>)}</div>
      </div>
      {messages.map((message, index) => <p key={index} className={message.role === 'user' ? 'ml-auto mt-4 w-fit max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm' : 'mt-4 whitespace-pre-wrap text-sm leading-7'}>{message.text}</p>)}
    </div>
    <form className="border-t p-4" onSubmit={event => { event.preventDefault(); send() }}>
      <div className="relative"><Textarea aria-label={`${name}에게 질문`} placeholder="현재 조사에 대해 질문하세요" className="min-h-24 resize-y pr-12 text-xs" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} />
        <Button size="icon" className="absolute bottom-2 right-2 size-7" disabled={!input.trim()} aria-label="질문 보내기"><Send className="size-3.5" /></Button></div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground">판단과 최종 처리는 조사자가 수행합니다.</p>
    </form>
  </section>
  const morphLayer = morph && createPortal(<div aria-hidden data-testid="rdr-morph" className="rdr-morph pointer-events-none fixed z-[80] overflow-hidden rounded-full" style={{ left: morph.rect.left, top: morph.rect.top, width: morph.rect.width, height: morph.rect.height }}><RadarSweep className="size-full" /></div>, document.body)
  if (mode === 'sidebar') return <>{morphLayer}<div className="fixed right-0 top-[60px] z-50 h-[calc(100dvh-60px)] max-w-[92vw]" style={{ width: sidebarWidth }}>
    <div role="separator" aria-orientation="vertical" aria-label="도우미 너비 조절" className="agent-resize-handle agent-resize-handle-x absolute inset-y-0 left-0 z-[51]" onPointerDown={event => { resizeRef.current = { x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { const start = resizeRef.current; if (start) setSidebarWidth(clamp(start.width + start.x - event.clientX, 320, Math.min(720, innerWidth * .92))) }} onPointerUp={() => { resizeRef.current = null }} />
    {content}
  </div></>
  return <>{morphLayer}{createPortal(<div className="pointer-events-none fixed inset-0 z-50"><Rnd bounds="parent" dragHandleClassName="agent-drag-handle" cancel=".agent-action,.agent-logo" size={floatSize} position={floatPosition} minWidth={Math.min(320, innerWidth - 16)} minHeight={Math.min(360, innerHeight - 16)} maxWidth={innerWidth - 16} maxHeight={innerHeight - 16} onDragStop={(_, position) => setFloatPosition({ x: position.x, y: position.y })} onResizeStop={(_, __, element, ___, position) => { setFloatSize({ width: element.offsetWidth, height: element.offsetHeight }); setFloatPosition(position) }} className="pointer-events-auto">{content}</Rnd></div>, document.body)}</>
}
