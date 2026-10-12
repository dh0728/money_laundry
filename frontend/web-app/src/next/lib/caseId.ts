// 화면에 보이는 ID는 Alert가 A-{alertId}, Episode가 E-{caseId}이며 자릿수를 맞추지 않는다.
export function alertDisplayId(alertId: number | string): string {
  return `A-${alertId}`
}

export function episodeDisplayId(caseId: number | string): string {
  return `E-${caseId}`
}

export function parseDisplayId(text: string): { kind: 'ALERT' | 'EPISODE'; id: number } | null {
  const match = /^([AE])-(\d+)$/i.exec(text.trim())
  if (!match) return null
  const id = Number(match[2])
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { kind: match[1].toUpperCase() === 'A' ? 'ALERT' : 'EPISODE', id }
}
