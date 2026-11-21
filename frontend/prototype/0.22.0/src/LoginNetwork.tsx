import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'

type Node = { x: number; y: number; r: number }

// Static node·edge decoration redraws only for mount, theme, and size changes.
export const nodeCountFor = (width: number, height: number) => Math.round(Math.min(160, Math.max(60, width * height / 11000)))

export default function LoginNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let nodes: Node[] = []
    let width = 0, height = 0
    const seed = () => { nodes = Array.from({ length: nodeCountFor(width, height) }, () => ({ x: Math.random(), y: Math.random(), r: 1.8 + Math.random() * 1.9 })) }
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
        if (distance < limit) { context.beginPath(); context.moveTo(a.x * width, a.y * height); context.lineTo(b.x * width, b.y * height); context.globalAlpha = 1 - distance / limit; context.lineWidth = .9; context.stroke() }
      }
      context.globalAlpha = 1
      for (const node of nodes) {
        context.beginPath(); context.arc(node.x * width, node.y * height, node.r, 0, Math.PI * 2); context.fill()
      }
    }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(canvas)
    return () => observer.disconnect()
  }, [resolvedTheme])
  return <canvas ref={canvasRef} aria-hidden data-testid="login-network" className="absolute inset-0 size-full block" style={{ background: "transparent" }} />
}
