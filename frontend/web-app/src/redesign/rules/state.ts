import { useCallback, useState } from 'react'
import { backtestCases, currentUser, fanInLog, initialDraft, initialRuleId, initialRuns, initialTemplate, ruleRows, type LogItem, type RuleRow, type TemplateKey, type WorkLog } from './data'
import { actionLabel, statusAfter, type RuleAction, type RuleDraft, type RuleStatus } from './model'
import type { Bands } from './RiskBandPanel'

// 룰 엔진 세 화면(목록 · 만들기 · 백테스트)의 상태. 탭을 오가도 남도록 RuleEnginePage 가 한 번씩만 만든다.
// 지금은 전부 화면 안에서만 바뀐다. API 를 붙일 때 여기의 set… 자리를 요청으로 바꾸면 된다.

const two = (value: number) => String(value).padStart(2, '0')
/** 기록에 찍는 시각 "11-21 15:40" */
const stamp = () => { const now = new Date(); return `${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}` }
/** 시안의 기록은 이름을 "김OO" 처럼 가려 적는다 */
const masked = (name: string) => `${name.slice(0, 1)}OO`

// ── 룰 목록 ─────────────────────────────────────────────────────────────
export type RuleList = ReturnType<typeof useRuleList>
export function useRuleList() {
  const [rows, setRows] = useState<RuleRow[]>(ruleRows)
  const [selectedId, setSelectedId] = useState<string | null>(initialRuleId)
  /** 저장한 위험 점수 경계값. 저장한 적이 없으면 패널의 기본값(0.7 · 0.9)을 쓴다. */
  const [bands, setBands] = useState<Bands | undefined>(undefined)

  /** 상태를 바꾸고 변경 기록 맨 위에 한 줄을 남긴다 */
  const setStatus = useCallback((id: string, status: RuleStatus, what: string) => {
    const entry: LogItem = { when: stamp(), text: `${masked(currentUser)} · ${what}` }
    setRows(current => current.map(row => (row.id === id ? { ...row, status, detail: { ...row.detail, changes: [entry, ...row.detail.changes] } } : row)))
  }, [])
  /** 승인 · 반려 · 중지. 사유는 기록에 함께 남긴다. */
  const act = useCallback((id: string, action: RuleAction, reason: string) => setStatus(id, statusAfter[action], `${actionLabel[action]} · ${reason}`), [setStatus])

  return { rows, selectedId, select: setSelectedId, setStatus, act, bands, saveBands: setBands }
}

// ── 룰 만들기 ───────────────────────────────────────────────────────────
type Drafts = Partial<Record<TemplateKey, RuleDraft>>
export type RuleEditor = ReturnType<typeof useRuleEditor>
export function useRuleEditor() {
  const [template, setTemplate] = useState<TemplateKey>(initialTemplate)
  // 템플릿마다 고치던 조건을 따로 들고 있어, 다른 템플릿을 눌렀다 돌아와도 남는다
  const [drafts, setDrafts] = useState<Drafts>(() => ({ [initialTemplate]: initialDraft(initialTemplate) }))
  // 마지막으로 저장한 조건. drafts 와 같은 객체면 고친 것이 없다는 뜻이다. 처음에는 저장한 적이 없어 비어 있다.
  const [saved, setSaved] = useState<Drafts>({})
  const [logs, setLogs] = useState<Partial<Record<TemplateKey, WorkLog[]>>>({ fanIn: fanInLog })

  const draft = drafts[template] ?? initialDraft(template)
  const dirty = drafts[template] !== saved[template]

  const chooseTemplate = (key: TemplateKey) => {
    if (!drafts[key]) {
      const first = initialDraft(key)
      setDrafts(current => ({ ...current, [key]: first }))
      setLogs(current => ({ ...current, [key]: [{ at: stamp(), who: masked(currentUser), what: '새 룰 작성 시작' }] }))
    }
    setTemplate(key)
  }
  const change = (update: (draft: RuleDraft) => RuleDraft) => setDrafts(current => ({ ...current, [template]: update(current[template] ?? draft) }))
  const save = () => {
    setSaved(current => ({ ...current, [template]: draft }))
    setLogs(current => ({ ...current, [template]: [{ at: stamp(), who: masked(currentUser), what: '초안 저장' }, ...(current[template] ?? [])] }))
  }

  return { template, draft, dirty, log: logs[template] ?? [], chooseTemplate, change, save }
}

// ── 백테스트 ────────────────────────────────────────────────────────────
export type Backtest = ReturnType<typeof useBacktest>
export function useBacktest(runLabel: string) {
  const [runs, setRuns] = useState<LogItem[]>(initialRuns)
  const [caseId, setCaseId] = useState<string | null>(backtestCases[0].account)
  const run = () => setRuns(current => [{ when: stamp(), text: `${runLabel} · ${masked(currentUser)}` }, ...current])
  return { runs, caseId, selectCase: setCaseId, run }
}
