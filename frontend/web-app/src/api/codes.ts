// API.md §2.3 유형 코드와 §3.3·§4.3 상태·종결 결과

export type TypeCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type TypeRef = { code: TypeCode; name: string }

export type AlertStatus = 'OPEN' | 'ESCALATED' | 'CLOSED'
export type AlertResolution = 'NORMAL' | 'FALSE_POSITIVE'
export type EpisodeStatus = 'OPEN' | 'CLOSED'
export type EpisodeResolution = 'NORMAL' | 'SUSPICIOUS'

// 코드 0은 API 이름이 NORMAL이지만, 의심 거래·Alert에서는 정상이 아니라
// "패턴 없는 이상거래"다(학습 때 정상과 NONPAT을 한 칸으로 합침). 이름 대신 코드로 표시한다.
const typeLabels: Record<TypeCode, { key: string; label: string }> = {
  0: { key: 'NON_PATTERN', label: '패턴 없는 이상거래' },
  1: { key: 'FAN-OUT', label: '분산 송금' },
  2: { key: 'FAN-IN', label: '집중 수취' },
  3: { key: 'G-SCATTER', label: '모아서 뿌리기' },
  4: { key: 'S-GATHER', label: '뿌려서 모으기' },
  5: { key: 'CYCLE', label: '순환 거래' },
  6: { key: 'RANDOM', label: '무작위 경로' },
  7: { key: 'BIPARTITE', label: '그룹 간 교차 송금' },
  8: { key: 'STACK', label: '다층 중계' },
}

export const typeDisplay = (code: TypeCode) => typeLabels[code]

export const alertStatusLabels: Record<AlertStatus, string> = {
  OPEN: '검토 전',
  ESCALATED: '심층 조사',
  CLOSED: '종결',
}

// 종결 결과의 NORMAL은 "정상 거래로 판단"이라 유형 코드 0과 다르다.
export const alertResolutionLabels: Record<AlertResolution, string> = {
  NORMAL: '정상 판단',
  FALSE_POSITIVE: '오탐',
}

/** 모델 점수(0~1)를 소수 둘째 자리까지 표시 */
export const formatScore = (score: number) => score.toFixed(2)
