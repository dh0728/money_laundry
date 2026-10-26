// 브랜드 마크: 블랙/화이트 + 레드 accent 원칙에 맞춰 currentColor 하나만 쓰는 미니멀 flat 레이더.
// 헤더 등 밝은 배경에서 쓰이므로 색은 부모가 text color로 정한다(기본 검정/흰색, 위험색 아님).
// v16: 예전 버전은 링 2개 + 바늘 하나뿐이라 계기판(speedometer)처럼 보인다는 지적이 있었다.
// 레이더로 분명히 읽히도록 링 3개 + 십자선 + 폭 있는 sweep 부채꼴(뒤로 갈수록 옅어지는 잔상 2겹) + blip 점을 그린다.
export function RadarMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      {/* 동심원 3겹 */}
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity=".55" />
      <circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity=".4" />
      {/* 십자선: 한쪽으로만 뻗는 바늘과 구분되도록 사방으로 대칭이다 */}
      <path d="M16 2.6 V29.4 M2.6 16 H29.4" stroke="currentColor" strokeWidth=".7" strokeOpacity=".3" />
      {/* sweep 부채꼴(~60°)과 뒤로 갈수록 옅어지는 잔상 2겹 — 바늘 하나로 보이지 않도록 폭을 준다 */}
      <path d="M16 16 L7.32 5.66 A13.5 13.5 0 0 1 11.38 3.31 Z" fill="currentColor" fillOpacity=".18" />
      <path d="M16 16 L11.38 3.31 A13.5 13.5 0 0 1 16 2.5 Z" fill="currentColor" fillOpacity=".4" />
      <path d="M16 16 L16 2.5 A13.5 13.5 0 0 1 27.69 9.25 Z" fill="currentColor" />
      {/* blip: 중심점과 별개로, sweep이 감지한 표적처럼 보이는 작은 점 */}
      <circle cx="12.62" cy="23.25" r="1.15" fill="currentColor" />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 shrink-0 font-semibold tracking-tight text-sm whitespace-nowrap ${className}`}>
      {/* 헤더 폭이 좁아지면(<1100px) 글자를 숨기고 마크만 남긴다 */}
      <RadarMark className="size-5 shrink-0" /><span className="max-[1100px]:hidden">AML RADAR</span>
    </div>
  )
}
