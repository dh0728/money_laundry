import { useSyncExternalStore } from "react"
import { MotionGlobalConfig } from "motion/react"

// 움직임은 기본으로 켠다. 앱 설정(설정 > 모션 줄이기, <html data-reduced-motion>)을 먼저 따르고,
// 설정이 아직 없으면 OS의 prefers-reduced-motion을 따른다. 움직임을 고르는 코드는 모두 이 파일을 거친다.
const QUERY = "(prefers-reduced-motion: reduce)"

/** OS 설정 그대로. 앱 설정의 기본값을 정할 때만 쓴다(app/layout.js). */
export const systemReducedMotion: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null

/** 지금 움직임을 줄여야 하는지. 앱 설정 → OS 설정 순서. */
export function appReducedMotion(): boolean {
  const flag = typeof document !== "undefined" ? document.documentElement.dataset.reducedMotion : undefined
  if (flag === "true") return true
  if (flag === "false") return false
  return systemReducedMotion?.matches ?? false
}

/** 앱 설정이나 OS 설정이 바뀔 때 알린다. 반환값으로 구독을 끊는다. */
export function subscribeReducedMotion(listener: () => void): () => void {
  systemReducedMotion?.addEventListener("change", listener)
  const observer = typeof MutationObserver !== "undefined" && typeof document !== "undefined" ? new MutationObserver(listener) : null
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] })
  return () => {
    systemReducedMotion?.removeEventListener("change", listener)
    observer?.disconnect()
  }
}

const unsubscribers = new Map<() => void, () => void>()

/** MediaQueryList처럼 쓰는 앱 기준 움직임 설정(.matches, change 이벤트). */
export const appMotionPreference = {
  get matches() { return appReducedMotion() },
  addEventListener(_type: "change", listener: () => void) {
    if (!unsubscribers.has(listener)) unsubscribers.set(listener, subscribeReducedMotion(listener))
  },
  removeEventListener(_type: "change", listener: () => void) {
    unsubscribers.get(listener)?.()
    unsubscribers.delete(listener)
  },
}

/** React 컴포넌트용. motion의 useReducedMotion 대신 쓴다. */
export function useAppReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, appReducedMotion, () => false)
}

// motion 라이브러리 애니메이션도 같은 설정을 따르게 한다.
const syncMotionLibrary = () => { MotionGlobalConfig.skipAnimations = appReducedMotion() }
syncMotionLibrary()
subscribeReducedMotion(syncMotionLibrary)
