// 설정 > 화면 > 글자 크기(김명기 10/12): 루트 글자 크기를 바꿔 rem 단위인 모든 글자·여백이 함께 커진다.
// 값은 이 브라우저에만 저장한다(사용자 서버 설정 아님). 저장소를 못 쓰는 환경에서도 화면은 그대로 뜬다.
import { useSyncExternalStore } from 'react'

export const FONT_SCALES = [{ value: 100, label: '보통 (100%)' }, { value: 115, label: '크게 (115%)' }, { value: 130, label: '더 크게 (130%)' }, { value: 150, label: '가장 크게 (150%)' }] as const
const KEY = 'aml:fontScale'
const read = () => { try { const v = Number(window.localStorage.getItem(KEY)); return FONT_SCALES.some(s => s.value === v) ? v : 100 } catch { return 100 } }
let current = typeof window === 'undefined' ? 100 : read()
const listeners = new Set<() => void>()
const apply = () => { if (typeof document !== 'undefined') document.documentElement.style.fontSize = `${current}%` }

export function setFontScale(value: number) {
  current = value; apply()
  try { window.localStorage.setItem(KEY, String(value)) } catch { /* 저장 불가: 이번 접속에서만 적용 */ }
  listeners.forEach(l => l())
}
export const useFontScale = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => current)
apply()
