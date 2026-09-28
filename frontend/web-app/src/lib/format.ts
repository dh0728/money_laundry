export const fmt = (n: number) => n.toLocaleString('ko-KR')

/** YYYY-MM-DD (로컬 날짜) */
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// v24 Detail.tsx: 마지막 글자에 받침이 있으면 withFinal(이/을/은), 없으면 withoutFinal(가/를/는)
export function josa(word: string, withFinal: string, withoutFinal: string) {
  const last = word.charCodeAt(word.length - 1)
  if (!(last >= 0xac00 && last <= 0xd7a3)) return withoutFinal
  return (last - 0xac00) % 28 !== 0 ? withFinal : withoutFinal
}
