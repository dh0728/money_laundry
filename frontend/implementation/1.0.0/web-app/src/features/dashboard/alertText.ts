import type { AlertRow } from '@/api/alerts'
import { typeDisplay } from '@/api/codes'

// 서버 요약문은 "{typeName} · 계좌 …"로 시작한다. 화면에서 쓰는 유형 이름으로 맞춘다.
export const alertSummary = (alert: Pick<AlertRow, 'summary' | 'primaryType'>) =>
  alert.summary.startsWith(alert.primaryType.name)
    ? typeDisplay(alert.primaryType.code).key + alert.summary.slice(alert.primaryType.name.length)
    : alert.summary
