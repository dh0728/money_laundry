import { Hourglass, TriangleAlert } from 'lucide-react'
import { patternName, riskBand, type CaseRecord, type WorkState } from '../dashboard-data'
import type { TypeCode } from '@/api/codes'
import { caseHref } from '../workspace-store'

export function StatusTag({ preset, children }: { preset: WorkState | 'normal' | 'abnormal' | 'riskLow' | 'riskMedium' | 'riskHigh' | 'elapsedLow' | 'elapsedMid' | 'elapsedHigh'; children: React.ReactNode }) {
  return <span data-tag="status" data-preset={preset}>{preset.startsWith('elapsed') && <Hourglass aria-hidden="true" />}{children}</span>
}
export function PatternTag({ code, probability }: { code: TypeCode; probability: number }) {
  return <span data-tag="pattern">{patternName(code)} {Math.round(probability * 100)}%</span>
}
export function ScoreTag({ score }: { score: number }) {
  return <span data-tag="score" data-band={riskBand(score)} aria-label={`모델 점수 ${score.toFixed(2)}`}><TriangleAlert aria-hidden="true" />{score.toFixed(2)}</span>
}
export function CaseCard({ item }: { item: CaseRecord }) {
  return <article data-part="case-card" data-testid="case-card" data-verdict={item.verdict ?? 'unjudged'} aria-label={item.displayId}>
    <header><strong><a href={caseHref(item)}>{item.displayId}</a></strong></header>
    <dl>
      <div><dt>추정 패턴</dt><dd><PatternTag code={item.typeCode} probability={item.probability} /></dd></div>
      <div><dt>거래 건수</dt><dd>{item.transactionIds.length}건</dd></div>
      <div><dt>거래 금액</dt><dd>{item.amountUsd === null ? '값 없음' : `${item.amountUsd.toLocaleString('ko-KR')} USD`}</dd></div>
      <div><dt>담당자</dt><dd>{item.assignee}</dd></div>
    </dl>
    <footer>
      <div data-part="tag-row">{item.verdict && <StatusTag preset={item.verdict}>{item.verdict === 'normal' ? '정상' : '이상'}</StatusTag>}<ScoreTag score={item.score} /></div>
      <StatusTag preset={item.ageDays <= 3 ? 'elapsedLow' : item.ageDays <= 7 ? 'elapsedMid' : 'elapsedHigh'}>{item.ageDays}일 경과</StatusTag>
    </footer>
  </article>
}
