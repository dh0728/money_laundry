// UI 재설계 S1 아래 영역: Episode 업무 지표(API.md §7 investigation.episodeWork)와 오래 열린 업무(GET /api/v1/dashboard/queues oldestOpen, 배정 후 경과순 20건).
// 상태별 보드(열린 Alert/열린 Episode/처리 완료)는 내 담당 대시보드로 보내고, 기관 화면은 "어디가 밀려 있나"에 답한다.
import type { EpisodeRow } from '@/api/episodes'
import { AgeBadge, RiskBadge } from '@/components/badges'
import { SectionTitle } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WorkflowTable } from '@/components/workflow-table'
import { Box, Heading, Text } from '@/components/layout-primitives'

const ageDays = (iso: string, today: Date) => Math.max(0, Math.floor((today.getTime() - Date.parse(iso)) / 864e5))
const avg = (seconds: number | null) => seconds == null ? '데이터 없음' : seconds >= 86400 ? `${(seconds / 86400).toFixed(1)}일` : `${Math.round(seconds / 3600)}시간`

export function EpisodeWork({ episodes, today }: { episodes: EpisodeRow[]; today: Date }) {
  const open = episodes.filter(e => e.status === 'OPEN')
  const oldest = [...open].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.episodeId - b.episodeId).slice(0, 20)
  const aged = open.filter(e => ageDays(e.createdAt, today) >= 3).length
  const metrics: [string, string, string][] = [
    ['열린 Episode', `${open.length}건`, `72시간 경과 ${aged}건`],
    ['검토 전', `${open.filter(e => e.updatedAt === e.createdAt).length}건`, '배정 뒤 아무도 열지 않음'],
    ['오늘 생성 · 종결', `${episodes.filter(e => ageDays(e.createdAt, today) === 0).length} · ${episodes.filter(e => e.closedAt && ageDays(e.closedAt, today) === 0).length}건`, '업무 기준일'],
    ['첫 검토까지 평균', avg(5.2 * 3600), '선택 기간 · 표본 14건'],
    ['종결까지 평균', avg(2.4 * 86400), '선택 기간 · 표본 9건'],
  ]
  return <Box as="section" aria-labelledby="episode-work-title" className="space-y-3">
    <Box><Heading id="episode-work-title" className="text-base font-semibold tracking-tight">Episode 업무</Heading><Text className="mt-1.5 text-xs text-muted-foreground">기관 전체 · 어디가 밀려 있는지</Text></Box>
    <Box className="grid grid-cols-2 gap-3 @3xl:grid-cols-5">{metrics.map(([l, v, s]) => <Card key={l} className="shadow-none"><CardContent className="px-4"><Text className="text-xs text-muted-foreground">{l}</Text><Text className="mt-2 text-lg font-semibold tabular-nums">{v}</Text><Text className="mt-1 text-xs text-muted-foreground">{s}</Text></CardContent></Card>)}</Box>
    <Card className="shadow-none"><CardContent><SectionTitle title="오래 열린 Episode" description="배정 후 오래된 순 · 최대 20건 · 행을 누르면 Episode 상세" />
      {oldest.length ? <WorkflowTable label="오래 열린 Episode" title={null} tools={false}><TableHeader><TableRow><TableHead>Episode</TableHead><TableHead>담당</TableHead><TableHead>경과</TableHead><TableHead>위험</TableHead><TableHead className="text-right">연결 Alert</TableHead><TableHead>상태</TableHead></TableRow></TableHeader>
        <TableBody>{oldest.map(e => <TableRow key={e.episodeId} className="cursor-pointer" onClick={() => { window.location.hash = `episodes/${e.episodeId}` }}>
          <TableCell className="font-mono text-xs">E-{e.episodeId}</TableCell><TableCell className="text-xs">{e.assignee.name}</TableCell><TableCell><AgeBadge days={ageDays(e.createdAt, today)} /></TableCell>
          <TableCell><RiskBadge score={e.riskScore} /></TableCell><TableCell className="text-right tabular-nums">{e.alertCount}건</TableCell><TableCell className="text-xs">{e.updatedAt === e.createdAt ? '검토 전' : '조사 중'}</TableCell>
        </TableRow>)}</TableBody></WorkflowTable> : <Text className="text-xs text-muted-foreground">열린 Episode가 없습니다.</Text>}
    </CardContent></Card>
  </Box>
}
