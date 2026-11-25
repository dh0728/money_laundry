// 번호 배지(김명기 10/12): 계좌 번호·읽는 순서 ①~⑦ 모두 이 컴포넌트로 그린다.
// (원래 이름 계좌 번호 배지): ①② 같은 유니코드 특수기호는 글꼴에 따라 아주 작게 나와 읽히지 않는다.
// 그래프 노드와 같은 모양(원 + 굵은 숫자)을 CSS로 그린다. 크기는 둘러싼 글자(em)를 따라가서 글자 크기 설정이 그대로 적용된다.
export function NumBadge({ n, className = '' }: { n: number; className?: string }) {
  return <span aria-label={`${n}번 계좌`} className={`inline-flex h-(--number-badge-size) min-w-(--number-badge-size) shrink-0 items-center justify-center rounded-full border border-current px-(--number-badge-inline-padding) align-middle font-sans text-(length:--number-badge-font-size) font-bold leading-none tabular-nums ${className}`}>{n}</span>
}
