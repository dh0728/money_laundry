import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { PanelRight, PictureInPicture2, Plus, Send, X } from 'lucide-react'
import { Rnd } from 'react-rnd'
import { IconButton } from '@/components/IconButton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatScore } from '@/api/codes'
import { live } from '@/lib/apiMode'
import type { AgentRecord } from './agentData'
import { RadarSweep } from '@/components/radar-sweep'
import { readChartDurationSeconds, readChartNumber } from '@/components/charts/chart-design-values'
import { appReducedMotion } from '@/hooks/use-reduced-motion'
import { Box, Text } from '@/components/layout-primitives'

export type AgentMode = 'sidebar' | 'floating'
const name = 'RDR 9000'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
type Message = { role: 'user' | 'assistant'; text: string }
type Rect = { left: number; top: number; width: number; height: number }
type Morph = { kind: 'opening' | 'closing'; rect: Rect; id: number }
let pendingTriggerOrigin: Rect | null = null
const takeTriggerOrigin = () => { const origin = pendingTriggerOrigin; pendingTriggerOrigin = null; return origin }

function readAgentDimensions() {
  return {
    sidebarWidth: readChartNumber('--agent-sidebar-default-width', 390),
    sidebarMax: readChartNumber('--agent-sidebar-max-width', 720),
    sidebarShare: readChartNumber('--agent-sidebar-viewport-share', 0.92),
    panelMinWidth: readChartNumber('--agent-panel-min-width', 320),
    floatingWidth: readChartNumber('--agent-floating-width', 400),
    floatingHeight: readChartNumber('--agent-floating-height', 620),
    floatingMinHeight: readChartNumber('--agent-floating-min-height', 360),
    floatingTop: readChartNumber('--agent-floating-start-top', 88),
    floatingEnd: readChartNumber('--aml-space-40', 40),
    viewportInset: readChartNumber('--aml-space-8', 8),
    triggerSize: readChartNumber('--aml-space-32', 32),
    triggerTop: readChartNumber('--aml-space-12', 12),
    triggerEnd: readChartNumber('--aml-space-48', 48),
    morphSettleMs: 1000 * readChartDurationSeconds('--agent-morph-settle-time', 0.52),
  }
}

function triggerHomeRect(dimensions: ReturnType<typeof readAgentDimensions>): Rect {
  const rect = document.querySelector('[data-testid="agent-toggle"] svg')?.getBoundingClientRect()
  if (rect) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  return { left: innerWidth - dimensions.triggerEnd, top: dimensions.triggerTop, width: dimensions.triggerSize, height: dimensions.triggerSize }
}

export function AgentTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <Button type="button" size="icon" variant="ghost"
    aria-label={open ? `${name} 패널 숨기기` : `${name} 열기`} aria-expanded={open} data-testid="agent-toggle" title={name}
    className="agent-trigger rounded-full p-0 transition-none hover:bg-transparent hover:text-inherit focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-ring"
    onClick={event => {
    const rect = event.currentTarget.querySelector('svg')?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()
    pendingTriggerOrigin = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    onToggle()
  }}><RadarSweep className="size-8" /></Button>
}

function answer(text: string, record: AgentRecord | undefined, summary: string) {
  if (/근거|거래|흐름/.test(text)) return `${record?.id ?? '선택한 업무'}의 자금 흐름 및 거래 탭에서 송금 방향·거래 일시·금액 대조가 필요합니다. 연결 계좌의 반복 송금 여부와 실제 거래 목적을 확인하세요.`
  if (/요약|우선/.test(text)) return summary
  return `${record?.id ?? '목록에서 조사할 항목'}의 탐지 근거와 처리 이력을 먼저 확인하세요.\n\n거래 흐름, 주요 근거, 검토 우선순위 중 확인할 내용을 선택하면 조사를 이어갈 수 있습니다.`
}

type Props = { open: boolean; setOpen: (open: boolean) => void; closeRef: { current: () => void }; mode: AgentMode; setMode: (mode: AgentMode) => void; record?: AgentRecord; records: AgentRecord[] }
export default function Agent({ open, setOpen, closeRef, mode, setMode, record, records }: Props) {
  const [dimensions] = useState(readAgentDimensions)
  const { viewportInset } = dimensions
  const floatMaxWidth = Math.max(1, innerWidth - 2 * viewportInset)
  const floatMaxHeight = Math.max(1, innerHeight - 2 * viewportInset)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(dimensions.sidebarWidth)
  const [floatSize, setFloatSize] = useState(() => ({
    width: Math.min(dimensions.floatingWidth, floatMaxWidth),
    height: Math.min(dimensions.floatingHeight, floatMaxHeight),
  }))
  const [floatPosition, setFloatPosition] = useState(() => ({
    x: Math.max(viewportInset, innerWidth - dimensions.floatingWidth - dimensions.floatingEnd),
    y: dimensions.floatingTop,
  }))
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
    morphTimer.current = setTimeout(() => finishMorph(id), dimensions.morphSettleMs)
  }, [clearMorph, finishMorph, dimensions.morphSettleMs])
  useLayoutEffect(() => {
    if (!open) return
    const from = takeTriggerOrigin()
    const node = avatarRef.current
    if (!from || appReducedMotion()) return
    if (!node) return
    const to = node.getBoundingClientRect()
    if (to.width > 0) startMorph('opening', from, { left: to.left, top: to.top, width: to.width, height: to.height })
  }, [open, startMorph])
  useEffect(() => () => clearMorph(), [clearMorph])
  const requestClose = useCallback(() => {
    if (closing) return
    const from = avatarRef.current?.getBoundingClientRect()
    if (!from || from.width === 0 || appReducedMotion()) { setOpen(false); return }
    setClosing(true)
    startMorph('closing', { left: from.left, top: from.top, width: from.width, height: from.height }, triggerHomeRect(dimensions), () => { setOpen(false); setClosing(false) })
  }, [closing, dimensions, setOpen, startMorph])
  useLayoutEffect(() => { closeRef.current = requestClose }, [closeRef, requestClose])
  useEffect(() => {
    document.documentElement.style.setProperty('--agent-width', `${sidebarWidth}px`)
    return () => { document.documentElement.style.removeProperty('--agent-width') }
  }, [sidebarWidth])
  useEffect(() => {
    const fitToWindow = () => {
      const maxWidth = Math.max(1, innerWidth - 2 * viewportInset)
      const maxHeight = Math.max(1, innerHeight - 2 * viewportInset)
      setFloatSize(current => ({ width: Math.min(current.width, maxWidth), height: Math.min(current.height, maxHeight) }))
      setFloatPosition(current => ({
        x: clamp(current.x, viewportInset, Math.max(viewportInset, innerWidth - Math.min(floatSize.width, maxWidth) - viewportInset)),
        y: clamp(current.y, viewportInset, Math.max(viewportInset, innerHeight - Math.min(floatSize.height, maxHeight) - viewportInset)),
      }))
    }
    window.addEventListener('resize', fitToWindow)
    return () => window.removeEventListener('resize', fitToWindow)
  }, [floatSize.width, floatSize.height, viewportInset])
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
  const header = <Box data-testid="agent-header" className={`agent-drag-handle flex items-center justify-between gap-2 border-b px-3 py-2.5 ${mode === 'floating' ? 'cursor-move' : ''}`}>
    <Text as="span" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide">
      <Button ref={avatarRef} type="button" size="icon-xs" variant="ghost" aria-label={`${name} 심볼로 닫기`}
        onClick={requestClose} disabled={Boolean(morph) || closing}
        className={`agent-logo rdr-avatar rounded-full p-0 hover:bg-transparent hover:text-inherit focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-ring ${morph ? 'invisible opacity-0' : ''}`}>
        <RadarSweep className="size-6" />
      </Button>
      {name}{live && <Text as="span" className="rounded-full border px-2 py-0.5 font-sans text-3xs font-normal">mock</Text>}
    </Text>
    <Box className="agent-action flex gap-0.5">
      <IconButton label="새 대화" className="size-8" onClick={() => setMessages([])}><Plus className="size-4" /></IconButton>
      <IconButton label={mode === 'sidebar' ? '플로팅 패널로 보기' : '우측 사이드바로 보기'} className="size-8" onClick={() => setMode(mode === 'sidebar' ? 'floating' : 'sidebar')}>
        {mode === 'sidebar' ? <PictureInPicture2 className="size-4" /> : <PanelRight className="size-4" />}
      </IconButton>
      <IconButton label={`${name} 닫기`} className="size-8" onClick={requestClose}><X className="size-4" /></IconButton>
    </Box>
  </Box>
  const content = <Box as="section" aria-label={name} data-mode={mode} data-closing={closing || undefined} className={`agent-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl ${closing ? 'pointer-events-none opacity-0' : ''}`}>
    {header}
    <Box className="flex items-center gap-2 px-4 py-3 text-2xs text-muted-foreground"><Text as="span">{record?.id ?? '전체 업무 · 오늘 요약'}</Text></Box>
    <Box className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <Box className="space-y-3"><Text className="whitespace-pre-wrap text-sm leading-7">{summary}</Text>
        <Box className="flex flex-wrap gap-2">{['주요 근거 확인', '검토 우선순위 요약'].map(question => <Button key={question} variant="outline" size="sm" className="text-xs" onClick={() => send(question)}>{question}</Button>)}</Box>
      </Box>
      {messages.map((message, index) => <Text key={index} className={message.role === 'user' ? 'agent-user-message ml-auto mt-4 w-fit rounded-2xl bg-muted px-4 py-2.5 text-sm' : 'mt-4 whitespace-pre-wrap text-sm leading-7'}>{message.text}</Text>)}
    </Box>
    <Box as="form" className="border-t p-4" onSubmit={event => { event.preventDefault(); send() }}>
      <Box className="relative"><Textarea aria-label={`${name}에게 질문`} placeholder="현재 조사에 대해 질문하세요" className="min-h-24 resize-y pr-12 text-xs" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} />
        <Button size="icon" className="absolute bottom-2 right-2 size-7" disabled={!input.trim()} aria-label="질문 보내기"><Send className="size-3.5" /></Button></Box>
      <Text className="mt-2 text-center text-3xs text-muted-foreground">판단과 최종 처리는 조사자가 수행합니다.</Text>
    </Box>
  </Box>
  const morphLayer = morph && createPortal(
    <Box aria-hidden data-testid="rdr-morph" className="rdr-morph pointer-events-none fixed overflow-hidden rounded-full"
      style={{
        '--agent-morph-x': `${morph.rect.left}px`, '--agent-morph-y': `${morph.rect.top}px`,
        '--agent-morph-width': `${morph.rect.width}px`, '--agent-morph-height': `${morph.rect.height}px`,
      } as CSSProperties}>
      <RadarSweep className="size-full" />
    </Box>, document.body,
  )
  if (mode === 'sidebar') return <>{morphLayer}<Box className="agent-sidebar fixed right-0 z-50" style={{ '--agent-width': `${sidebarWidth}px` } as CSSProperties}>
    <Box role="separator" aria-orientation="vertical" aria-label="도우미 너비 조절"
      className="agent-resize-handle agent-resize-handle-x absolute inset-y-0 left-0"
      onPointerDown={event => { resizeRef.current = { x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => {
        const start = resizeRef.current
        if (start) setSidebarWidth(clamp(start.width + start.x - event.clientX, dimensions.panelMinWidth, Math.min(dimensions.sidebarMax, innerWidth * dimensions.sidebarShare)))
      }}
      onPointerUp={() => { resizeRef.current = null }} />
    {content}
  </Box></>
  return <>{morphLayer}{createPortal(
    <Box className="pointer-events-none fixed inset-0 z-50">
      <Rnd bounds="parent" dragHandleClassName="agent-drag-handle" cancel=".agent-action,.agent-logo"
        size={floatSize} position={floatPosition}
        minWidth={Math.min(dimensions.panelMinWidth, floatMaxWidth)} minHeight={Math.min(dimensions.floatingMinHeight, floatMaxHeight)}
        maxWidth={floatMaxWidth} maxHeight={floatMaxHeight}
        onDragStop={(_, position) => setFloatPosition({ x: position.x, y: position.y })}
        onResizeStop={(_, __, element, ___, position) => { setFloatSize({ width: element.offsetWidth, height: element.offsetHeight }); setFloatPosition(position) }}
        className="pointer-events-auto">{content}</Rnd>
    </Box>, document.body,
  )}</>
}
