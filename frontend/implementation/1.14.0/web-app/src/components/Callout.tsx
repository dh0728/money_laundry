import type { ReactNode } from 'react'

// 경고 문구 공용 상자(김명기 10/12): 배경·테두리·글자색을 한 곳에서 정해 어두운 화면에서도 주변과 확실히 구분되고 읽히게 한다.
// 화면마다 `text-destructive`를 직접 쓰지 말고 이 컴포넌트를 쓴다.
export function Callout({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p role="alert" className={`rounded-md border border-destructive/70 bg-destructive/20 px-3 py-2 text-sm font-medium text-destructive-text ${className}`}>{children}</p>
}
