// API.md §0: 시각은 서울 오프셋(+09:00)이 붙은 ISO-8601 문자열이다. mock도 같은 모양으로 만든다.
export function seoulIso(ms: number) {
  const local = new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)
  return `${local}+09:00`
}
