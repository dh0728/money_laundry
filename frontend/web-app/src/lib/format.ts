export const fmt = (n: number) => n.toLocaleString('ko-KR')

/** YYYY-MM-DD (로컬 날짜) */
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
