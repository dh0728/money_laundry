import { Button, SegmentedSwitch, type Segment } from '../components/primitives'
import { Shell } from '../layout/Shell'
import { hrefFor, navigate, type Route, type RuleTab } from '../route'
import { backtestTarget } from '../rules/data'
import { RuleBacktestView } from '../rules/RuleBacktestView'
import { RuleCreateView } from '../rules/RuleCreateView'
import { RuleListView } from '../rules/RuleListView'
import { useBacktest, useRuleEditor, useRuleList } from '../rules/state'

// Figma "RuleEngine" 섹션: 룰 목록 · 룰 만들기 · 백테스트. mock 데이터로만 동작한다.
const tabs: Segment<RuleTab>[] = [
  { key: 'list', label: '룰 목록', href: hrefFor({ page: 'rules', tab: 'list' }) },
  { key: 'create', label: '룰 만들기', href: hrefFor({ page: 'rules', tab: 'create' }) },
  { key: 'backtest', label: '백테스트', href: hrefFor({ page: 'rules', tab: 'backtest' }) },
]

export function RuleEnginePage({ route, tab }: { route: Route; tab: RuleTab }) {
  // 세 화면의 상태를 여기서 들고 있어 탭을 오가도 고치던 내용이 남는다
  const list = useRuleList()
  const editor = useRuleEditor()
  const backtest = useBacktest(backtestTarget.runLabel)

  /** 백테스트에서 다음 단계로 넘기면 목록의 그 룰로 돌아가 바뀐 상태를 보여 준다 */
  const advance = (status: 'trial' | 'pending', what: string) => {
    list.setStatus(backtestTarget.key, status, what)
    list.select(backtestTarget.key)
    navigate({ page: 'rules', tab: 'list' })
  }

  const headerRight =
    tab === 'create' ? <Button tone={editor.dirty ? 'brand' : 'disabled'} disabled={!editor.dirty} className="font-medium" onClick={editor.save}>저장</Button>
    : tab === 'backtest' ? <Button tone="brand" className="font-medium" onClick={backtest.run}>백테스트 실행</Button>
    : undefined

  return (
    <Shell route={route} headerLeft={<SegmentedSwitch label="룰 엔진 화면" items={tabs} value={tab} />} headerRight={headerRight}>
      {tab === 'list' && <RuleListView list={list} />}
      {tab === 'create' && <RuleCreateView editor={editor} />}
      {tab === 'backtest' && <RuleBacktestView backtest={backtest} onStartTrial={() => advance('trial', '시험 운영 시작')} onRequestApproval={() => advance('pending', '승인 요청')} />}
    </Shell>
  )
}
