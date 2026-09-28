import type { AlertRow } from '@/api/alerts'
import { typeDisplay } from '@/api/codes'

// 서버 요약문은 "{typeName} · 계좌 …"로 시작한다. 코드 0은 이름이 NORMAL로 오므로 화면 이름으로 바꾼다.
export const alertSummary = (alert: Pick<AlertRow, 'summary' | 'primaryType'>) =>
  alert.summary.startsWith(alert.primaryType.name)
    ? typeDisplay(alert.primaryType.code).key + alert.summary.slice(alert.primaryType.name.length)
    : alert.summary
