import type { AlertResolution } from '@/api/codes'

// Alert 판정 선택지 (2026-09-28 회의 결정). 판정은 Alert를 어디로 보낼지 정하는 것이다.
//   정상
//   이상거래 → Alert 단독 / 기존 Episode 연결 / 새 Episode 생성
// v24의 "오탐 · 종결"은 뺐다. 오탐은 모델 평가이지 사람의 판정 결과가 아니다.
// 선택지를 바꿀 때는 이 파일만 고친다.
export type AlertVerdict = 'normal' | 'standalone' | 'link-episode' | 'new-episode'

export type VerdictOption = {
  value: AlertVerdict
  group: '정상' | '이상거래'
  label: string
  /** 확인 버튼 문구 */
  action: string
  /** 처리 뒤 알림·이력 문구 */
  result: string
  /** API.md에 요청이 없어 mock으로만 동작하는 선택지 */
  proposal?: true
}

export const verdictOptions: VerdictOption[] = [
  { value: 'normal', group: '정상', label: '정상 · 종결', action: '종결 확인', result: '정상으로 종결' },
  { value: 'standalone', group: '이상거래', label: 'Alert 단독', action: '판정 확인', result: '이상거래(Alert 단독)로 판정' },
  { value: 'link-episode', group: '이상거래', label: '기존 Episode 연결', action: 'Episode 연결 확인', result: '이상거래로 기존 Episode에 연결' },
  { value: 'new-episode', group: '이상거래', label: '새 Episode 생성', action: 'Episode 생성 확인', result: '이상거래로 새 Episode 생성' },
]

export const verdictGroups = ['정상', '이상거래'] as const

export const verdictOption = (value: AlertVerdict) => verdictOptions.find(o => o.value === value) ?? verdictOptions[0]

/** 종결로 끝나는 판정의 resolution. Episode로 보내는 판정은 종결이 아니라 ESCALATED가 된다. */
export const verdictResolution: Partial<Record<AlertVerdict, AlertResolution>> = {
  normal: 'NORMAL',
  standalone: 'SUSPICIOUS',
}
