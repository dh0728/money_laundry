import { useEffect, useRef } from 'react'
import { useTheme } from './ThemeProvider'

type Node = { x: number; y: number; r: number; vx: number; vy: number }

export const nodeCountFor = (width: number, height: number) => Math.round(Math.min(160, Math.max(60, width * height / 11000)))

export default function LoginNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const reducedMotion = motion?.matches ?? false
    let nodes: Node[] = [], frame = 0, previous = performance.now()
    let width = 0, height = 0
    const pointer = { x: 0, y: 0, active: false }
    const seed = () => { nodes = Array.from({ length: nodeCountFor(width, height) }, () => ({ x: Math.random(), y: Math.random(), r: 1.8 + Math.random() * 1.9, vx: (Math.random() - .5) * .000006, vy: (Math.random() - .5) * .000006 })) }
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2)
      const changed = Math.abs(rect.width - width) > 40 || Math.abs(rect.height - height) > 40
      width = rect.width; height = rect.height
      canvas.width = Math.max(1, width * ratio); canvas.height = Math.max(1, height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (changed || !nodes.length) seed()
      draw()
    }
    const draw = () => {
      context.clearRect(0, 0, width, height)
      const theme = getComputedStyle(canvas)
      context.strokeStyle = theme.getPropertyValue('--login-network-edge').trim()
      context.fillStyle = theme.getPropertyValue('--login-network-node').trim()
      const limit = Math.min(170, Math.max(120, width * .11))
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], distance = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
        if (distance < limit) {
          const hoverDistance = pointer.active ? Math.min(Math.hypot(a.x * width - pointer.x, a.y * height - pointer.y), Math.hypot(b.x * width - pointer.x, b.y * height - pointer.y)) : Infinity
          context.beginPath(); context.moveTo(a.x * width, a.y * height); context.lineTo(b.x * width, b.y * height)
          context.globalAlpha = Math.min(1, (1 - distance / limit) * (hoverDistance < 150 ? 2.8 : 1)); context.lineWidth = hoverDistance < 150 ? 1.3 : .9; context.stroke()
        }
      }
      for (const node of nodes) {
        const distance = pointer.active ? Math.hypot(node.x * width - pointer.x, node.y * height - pointer.y) : Infinity
        context.globalAlpha = distance < 120 ? 1 : .78
        context.beginPath(); context.arc(node.x * width, node.y * height, node.r * (distance < 120 ? 1.45 : 1), 0, Math.PI * 2); context.fill()
      }
      context.globalAlpha = 1
    }
    const tick = (time: number) => {
      const elapsed = Math.min(32, time - previous); previous = time
      for (const node of nodes) {
        node.x += node.vx * elapsed; node.y += node.vy * elapsed
        if (node.x < 0 || node.x > 1) { node.x = Math.max(0, Math.min(1, node.x)); node.vx *= -1 }
        if (node.y < 0 || node.y > 1) { node.y = Math.max(0, Math.min(1, node.y)); node.vy *= -1 }
      }
      draw(); frame = requestAnimationFrame(tick)
    }
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect(); pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top; pointer.active = true
      if (reducedMotion) draw()
    }
    const onPointerLeave = () => { pointer.active = false; if (reducedMotion) draw() }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(canvas)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerleave', onPointerLeave)
    if (!reducedMotion) frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [resolvedTheme])
  return <canvas ref={canvasRef} aria-hidden data-testid="login-network" className="absolute inset-0 size-full block" style={{ background: "transparent" }} />
}
