import { useEffect, useRef } from 'react'

type Node = { x: number; y: number; vx: number; vy: number; r: number }

// Vanta NET을 참고한 node·edge 네트워크. 화면 전체를 채우고, pointer에 약하게 끌리며, reduced-motion이면 첫 frame만 그린다.
export const nodeCountFor = (width: number, height: number) => Math.round(Math.min(160, Math.max(60, width * height / 11000)))

export default function LoginNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let nodes: Node[] = []
    const pointer = { x: .5, y: .5, active: false }
    let frame = 0, width = 0, height = 0
    const seed = () => { nodes = Array.from({ length: nodeCountFor(width, height) }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00022, vy: (Math.random() - .5) * .00022, r: 1.8 + Math.random() * 1.9 })) }
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2)
      const changed = Math.abs(rect.width - width) > 40 || Math.abs(rect.height - height) > 40
      width = rect.width; height = rect.height
      canvas.width = Math.max(1, width * ratio); canvas.height = Math.max(1, height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (changed || !nodes.length) seed()
      if (reduce) draw()
    }
    const move = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); pointer.x = (event.clientX - rect.left) / rect.width; pointer.y = (event.clientY - rect.top) / rect.height; pointer.active = true }
    const leave = () => { pointer.active = false }
    const draw = () => {
      context.clearRect(0, 0, width, height)
      if (!reduce) for (const node of nodes) {
        node.x += node.vx + (pointer.active ? (pointer.x - node.x) * .00002 : 0)
        node.y += node.vy + (pointer.active ? (pointer.y - node.y) * .00002 : 0)
        if (node.x < -.03 || node.x > 1.03) node.vx *= -1
        if (node.y < -.03 || node.y > 1.03) node.vy *= -1
      }
      const limit = Math.min(170, Math.max(120, width * .11))
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], distance = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
        if (distance < limit) { context.beginPath(); context.moveTo(a.x * width, a.y * height); context.lineTo(b.x * width, b.y * height); context.strokeStyle = `rgba(255,255,255,${.42 * (1 - distance / limit)})`; context.lineWidth = .9; context.stroke() }
      }
      for (const node of nodes) {
        const near = pointer.active && Math.hypot((node.x - pointer.x) * width, (node.y - pointer.y) * height) < 140
        context.beginPath(); context.arc(node.x * width, node.y * height, near ? node.r + 1.2 : node.r, 0, Math.PI * 2); context.fillStyle = near ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,.9)'; context.fill()
      }
      if (!reduce) frame = requestAnimationFrame(draw)
    }
    resize(); draw()
    window.addEventListener('pointermove', move); document.addEventListener('pointerleave', leave)
    const observer = new ResizeObserver(resize); observer.observe(canvas)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave) }
  }, [])
  return <canvas ref={canvasRef} aria-hidden data-testid="login-network" className="absolute inset-0 size-full block" style={{ background: "transparent" }} />
}
