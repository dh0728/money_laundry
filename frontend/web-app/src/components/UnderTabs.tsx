// v24 shared.tsx의 밑줄 탭과 움직이는 선택 표시를 옮김
import { useLayoutEffect, useRef, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
type IndicatorGeometry = { x: number; y: number; width: number; height: number; clipTop?: number; clipBottom?: number }

function indicatorGeometry(root: HTMLElement, target: HTMLElement | null): IndicatorGeometry | null {
  if (!target) return null
  const bounds = root.getBoundingClientRect(), rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const viewport = target.closest<HTMLElement>('[data-slot=sidebar-content]')?.getBoundingClientRect()
  const clipping = viewport ? { clipTop: Math.max(0, viewport.top - rect.top), clipBottom: Math.max(0, rect.bottom - viewport.bottom) } : {}
  if ((clipping.clipTop ?? 0) + (clipping.clipBottom ?? 0) >= rect.height) return null
  return { x: rect.left - bounds.left - root.clientLeft + root.scrollLeft, y: rect.top - bounds.top - root.clientTop + root.scrollTop, width: rect.width, height: rect.height, ...clipping }
}

type IndicatorState = { geometry: IndicatorGeometry | null; animate: boolean }

function updateIndicator(previous: IndicatorState, geometry: IndicatorGeometry | null, reason: 'selection' | 'layout'): IndicatorState {
  const old = previous.geometry
  if (old?.x === geometry?.x && old?.y === geometry?.y && old?.width === geometry?.width && old?.height === geometry?.height && old?.clipTop === geometry?.clipTop && old?.clipBottom === geometry?.clipBottom) return previous
  // Clipped endpoints cannot interpolate safely against a stationary scroll viewport.
  // Mount, reentry, and layout tracking must attach immediately to their real target.
  const animate = reason === 'selection' && !!old && !!geometry && !old.clipTop && !old.clipBottom && !geometry.clipTop && !geometry.clipBottom
  return { geometry, animate }
}

function useSelectionIndicator(value: string, targets: string, active: string, layoutKey = '') {
  const root = useRef<HTMLDivElement>(null)
  const selectedValue = useRef(value)
  const [state, setState] = useState<IndicatorState>({ geometry: null, animate: false })
  useLayoutEffect(() => {
    const surface = root.current
    if (!surface) return
    let disposed = false
    const measure = (reason: 'selection' | 'layout') => {
      if (disposed) return
      const next = indicatorGeometry(surface, surface.querySelector<HTMLElement>(active))
      setState(previous => updateIndicator(previous, next, reason))
    }
    measure(selectedValue.current === value ? 'layout' : 'selection')
    selectedValue.current = value
    const trackLayout = () => measure('layout')
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(trackLayout)
    observer?.observe(surface)
    surface.querySelectorAll<HTMLElement>(targets).forEach(target => observer?.observe(target))
    // Capturing scroll also tracks the independently scrolling sidebar content.
    surface.addEventListener('scroll', trackLayout, true)
    window.addEventListener('resize', trackLayout)
    document.fonts?.addEventListener('loadingdone', trackLayout)
    document.fonts?.ready.then(trackLayout)
    return () => {
      disposed = true
      observer?.disconnect()
      surface.removeEventListener('scroll', trackLayout, true)
      window.removeEventListener('resize', trackLayout)
      document.fonts?.removeEventListener('loadingdone', trackLayout)
    }
  }, [value, targets, active, layoutKey])
  return { root, ...state }
}
export function UnderTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-slot=tabs-trigger]', '[data-slot=tabs-trigger][data-state=active]', JSON.stringify(items))
  return (
    <Tabs value={value} onValueChange={next => onChange(next as T)}>
      <TabsList ref={root} variant="line" className="underline-tabs">
        <span aria-hidden="true" data-slot="tab-indicator" data-animate={animate} className="tab-indicator" style={{ visibility: geometry ? 'visible' : 'hidden', transform: `translateX(${geometry?.x ?? 0}px)`, width: geometry?.width ?? 0 }} />
        {items.map(i => <TabsTrigger value={i.value} key={i.value}>{i.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
