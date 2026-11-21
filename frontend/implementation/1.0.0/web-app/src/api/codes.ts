// API.md §2.3 유형 코드와 §3.3·§4.3 상태·종결 결과

export type TypeCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type TypeRef = { code: TypeCode; name: string }

export type AlertStatus = 'OPEN' | 'ESCALATED' | 'CLOSED'
// SUSPICIOUS는 FE 제안이다(API.md에 없음). 9/28 회의에서 Alert 판정에 "이상거래 · Alert 단독"을 두기로 해
// 담을 값이 필요하다. FALSE_POSITIVE(오탐)는 판정 선택지에서 뺐고 Backend와 정리할 예정이다.
export type AlertResolution = 'NORMAL' | 'FALSE_POSITIVE' | 'SUSPICIOUS'
export type EpisodeStatus = 'OPEN' | 'CLOSED'
export type EpisodeResolution = 'NORMAL' | 'SUSPICIOUS'

// 코드 0은 API에서 NON_PATTERN이다. 사람의 정상 판정 NORMAL과는 별개이며,
// 화면 이름은 숫자 코드로 결정한다.
const typeLabels: Record<TypeCode, { key: string; label: string }> = {
  0: { key: 'NON_PATTERN', label: '패턴 없는 이상거래' },
  1: { key: 'FAN-OUT', label: '분산 송금' },
  2: { key: 'FAN-IN', label: '집중 수취' },
  3: { key: 'GATHER-SCATTER', label: '모아서 뿌리기' },
  4: { key: 'SCATTER-GATHER', label: '뿌려서 모으기' },
  5: { key: 'CYCLE', label: '순환 거래' },
  6: { key: 'RANDOM', label: '무작위 경로' },
  7: { key: 'BIPARTITE', label: '그룹 간 교차 송금' },
  8: { key: 'STACK', label: '다층 중계' },
}

export const typeDisplay = (code: TypeCode) => typeLabels[code]


// 종결 결과의 NORMAL은 "정상 거래로 판단"이라 유형 코드 0과 다르다.
export const alertResolutionLabels: Record<AlertResolution, string> = {
  NORMAL: '정상 판단',
  FALSE_POSITIVE: '오탐',
  SUSPICIOUS: '이상거래 · Alert 단독',
}

/** 모델 점수(0~1)를 소수 둘째 자리까지 표시 */
export const formatScore = (score: number) => score.toFixed(2)
