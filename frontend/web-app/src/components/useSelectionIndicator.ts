// v24 shared.tsx: 탭 밑줄·사이드바 선택 배경이 선택 항목을 따라 움직이게 한다
import { useLayoutEffect, useRef, useState } from 'react'

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

// 선택 직후 이 시간 안에 생긴 크기 변화(선택 탭 글자가 굵어져 폭이 바뀌는 것 등)는 선택 애니메이션으로 이어 간다.
// 이걸 레이아웃 변화로 처리하면 애니메이션이 꺼져 밑줄·선택 배경이 미끄러지지 않고 바로 옮겨 간다.
const SELECTION_SETTLE_MS = 400

function updateIndicator(previous: IndicatorState, geometry: IndicatorGeometry | null, reason: 'selection' | 'layout'): IndicatorState {
  const old = previous.geometry
  if (old?.x === geometry?.x && old?.y === geometry?.y && old?.width === geometry?.width && old?.height === geometry?.height && old?.clipTop === geometry?.clipTop && old?.clipBottom === geometry?.clipBottom) return previous
  // Clipped endpoints cannot interpolate safely against a stationary scroll viewport.
  // Mount, reentry, and layout tracking must attach immediately to their real target.
  const animate = reason === 'selection' && !!old && !!geometry && !old.clipTop && !old.clipBottom && !geometry.clipTop && !geometry.clipBottom
  return { geometry, animate }
}

export function useSelectionIndicator(value: string, targets: string, active: string, layoutKey = '') {
  const root = useRef<HTMLDivElement>(null)
  const selectedValue = useRef(value)
  const selectedAt = useRef(-Infinity)
  const [state, setState] = useState<IndicatorState>({ geometry: null, animate: false })
  useLayoutEffect(() => {
    const surface = root.current
    if (!surface) return
    let disposed = false
    const measure = (reason: 'selection' | 'layout') => {
      if (disposed) return
      const next = indicatorGeometry(surface, surface.querySelector<HTMLElement>(active))
      const settling = reason === 'layout' && performance.now() - selectedAt.current < SELECTION_SETTLE_MS
      setState(previous => updateIndicator(previous, next, settling ? 'selection' : reason))
    }
    if (selectedValue.current !== value) selectedAt.current = performance.now()
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
