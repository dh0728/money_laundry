import { useState, type CSSProperties } from 'react'
import { Minus, Plus, Shrink } from 'lucide-react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { IconButton } from '@/components/IconButton'
import { Box, Text } from '@/components/layout-primitives'
import { readChartNumber } from '../../chart-design-values'

type AmountFormatter = (value: number) => string
type FlowLink = { source: number; target: number; value: number; suspect: boolean; count: number; first: string; last: string }
export type FlowSankeyData = { nodes: (FlowThroughput & { name: string; suspect: boolean })[]; links: FlowLink[] }

function readSankeySizes() {
  return {
    minScale: readChartNumber('--flow-sankey-min-scale', 0.5),
    maxScale: readChartNumber('--flow-sankey-max-scale', 6),
    wheelStep: readChartNumber('--flow-sankey-wheel-step', 0.0015),
    nodePadding: readChartNumber('--flow-sankey-node-padding', 18),
    nodeWidth: readChartNumber('--flow-sankey-node-width', 10),
    marginInline: readChartNumber('--flow-sankey-margin-inline', 96),
    marginTop: readChartNumber('--flow-sankey-margin-top', 22),
    marginBottom: readChartNumber('--flow-sankey-margin-bottom', 10),
    edgeTolerance: readChartNumber('--aml-stroke-divider', 1),
    labelGapBlock: readChartNumber('--aml-space-8', 8),
    labelGapInline: readChartNumber('--aml-space-6', 6),
    minLinkWidth: readChartNumber('--aml-stroke-divider', 1),
    minPulseWidth: readChartNumber('--flow-sankey-pulse-min-width', 1.5),
    maxPulseWidth: readChartNumber('--flow-sankey-pulse-max-width', 3),
  }
}

const span = (first: string, last: string) => first.slice(5, 10) === last.slice(5, 10) ? first.slice(5, 16) : `${first.slice(5, 10)} ~ ${last.slice(5, 10)}`

function flowLinkLabel({ value, count, first, last }: FlowLink, formatCompactAmount: AmountFormatter) {
  return `${formatCompactAmount(value)}${count > 1 ? ` · ${count}건` : ''} · ${span(first, last)}`
}

function sankeyLinkLabelLayout({ sourceX, targetX, sourceY, targetY }: { sourceX: number; targetX: number; sourceY: number; targetY: number }) {
  return { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 }
}

type FlowThroughput = { incoming: number; outgoing: number }
function centerSankeyLink({ sourceY, targetY, payload }: { sourceY: number; targetY: number; payload: { source: FlowThroughput & { value: number; dy: number }; target: FlowThroughput & { value: number; dy: number } } }) {
  const padding = (node: FlowThroughput & { value: number; dy: number }, side: keyof FlowThroughput) => node.value > 0 ? Math.max(0, node.dy * (1 - node[side] / node.value) / 2) : 0
  return { sourceY: sourceY + padding(payload.source, 'outgoing'), targetY: targetY + padding(payload.target, 'incoming') }
}

function flowTipContent(p: Record<string, unknown>, formatAmount: AmountFormatter) {
  // Recharts wraps Sankey tooltip data more than once
  // (tooltip entry -> searched item -> original link/node payload).
  let data = p
  const seen = new Set<unknown>([p])
  while (!('source' in data && 'target' in data)) {
    const nested = data.payload
    if (!nested || typeof nested !== 'object' || Array.isArray(nested) || seen.has(nested)) break
    seen.add(nested)
    data = nested as Record<string, unknown>
  }
  const link = 'source' in data && 'target' in data
  const first = typeof data.first === 'string' ? data.first : ''
  const last = typeof data.last === 'string' ? data.last : ''
  const count = Number(data.count ?? 0)
  return {
    primary: link && first && last ? span(first, last) : String(p.name ?? data.name ?? '').trim(),
    secondary: `${formatAmount(Number(data.value ?? p.value))}${link && count > 1 ? ` · ${count}건` : ''}`,
  }
}

// web-app: 맨 왼쪽 열(보내는 쪽) 막대는 이름을 바깥 왼쪽에 둔다. 선택한 계좌(index 0)가 가운데 열이면
// 양옆이 흐름 띠라 이름을 막대 위에 둔다. 나머지(받는 쪽)는 바깥 오른쪽.
// v24는 첫 노드를 항상 오른쪽에 두어 이름이 흐름 띠 위에 겹쳤다.
function sankeyLabelLayout({ x, y, width, height, index }: { x: number; y: number; width: number; height: number; index: number }, sizes: ReturnType<typeof readSankeySizes>) {
  const left = x <= sizes.marginInline + sizes.edgeTolerance
  if (!left && index === 0) {
    return { x: x + width / 2, y: y - sizes.labelGapBlock, textAnchor: 'middle', dominantBaseline: 'auto', transformOrigin: 'center bottom' } as const
  }
  return {
    x: left ? x - sizes.labelGapInline : x + width + sizes.labelGapInline,
    y: y + height / 2,
    textAnchor: left ? 'end' : 'start',
    dominantBaseline: 'middle',
    transformOrigin: left ? 'right center' : 'left center',
  } as const
}

// 호버 정보창: 링크는 기간을 먼저, 금액·건수를 다음 줄에 보여준다. 계좌쌍은 도식에 이미 보이므로 반복하지 않는다.
function FlowTip({ p, formatAmount }: { p: Record<string, unknown>; formatAmount: AmountFormatter }) {
  const content = flowTipContent(p, formatAmount)
  return (
    <Box className="grid flow-sankey-tooltip gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <Text className="font-medium font-mono" translate="no">{content.primary}</Text>
      <Text className="tabular-nums text-muted-foreground">{content.secondary}</Text>
    </Box>
  )
}

export function FlowSankey({ data, showInfo, formatAmount, formatCompactAmount }: {
  data: FlowSankeyData
  showInfo: boolean
  formatAmount: AmountFormatter
  formatCompactAmount: AmountFormatter
}) {
  const [sizes] = useState(readSankeySizes)
  const [zoom, setZoom] = useState(1)
  const [fitted, setFitted] = useState(true)
  const red = 'var(--graph-l1)', redEdge = 'var(--graph-l1-edge)', grey = 'var(--graph-l0)'

  return (
    <TransformWrapper
      minScale={sizes.minScale}
      maxScale={sizes.maxScale}
      smooth
      wheel={{ step: sizes.wheelStep }}
      doubleClick={{ disabled: true }}
      onTransform={(_, state) => {
        setZoom(state.scale)
        setFitted(Math.abs(state.scale - 1) < .001 && Math.abs(state.positionX) < .5 && Math.abs(state.positionY) < .5)
      }}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <Box>
          <TransformComponent wrapperClass="!w-full rounded-md" contentClass="!w-full">
            <Box className="flow-sankey-plot w-full" style={{ '--flow-sankey-inverse-zoom': 1 / zoom } as CSSProperties}>
              <ResponsiveContainer>
                <Sankey
                  data={data}
                  nodePadding={sizes.nodePadding}
                  nodeWidth={sizes.nodeWidth}
                  margin={{ left: sizes.marginInline, right: sizes.marginInline, top: sizes.marginTop, bottom: sizes.marginBottom }}
                  link={({ sourceX, targetX, sourceY: rawSourceY, targetY: rawTargetY, sourceControlX, targetControlX, linkWidth, payload }) => {
                    const { sourceY, targetY } = centerSankeyLink({ sourceY: rawSourceY, targetY: rawTargetY, payload: payload as unknown as Parameters<typeof centerSankeyLink>[0]['payload'] })
                    const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
                    const link = payload as unknown as FlowLink
                    const label = sankeyLinkLabelLayout({ sourceX, targetX, sourceY, targetY })
                    return (
                      <g>
                        <path d={d} fill="none" stroke={link.suspect ? redEdge : grey} strokeWidth={Math.max(sizes.minLinkWidth, linkWidth)} />
                        {/* 의심 거래는 빨간 점, 정상 거래는 반투명 흰 점이 보낸 쪽 → 받은 쪽으로 흐른다. */}
                        <path d={d} fill="none" className="flow-dash flow-sankey-link-pulse" data-suspect={link.suspect} stroke={link.suspect ? red : 'var(--foreground)'} strokeWidth={Math.min(sizes.maxPulseWidth, Math.max(sizes.minPulseWidth, linkWidth / 4))} strokeLinecap="round" />
                        {showInfo && <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" className="flow-sankey-label flow-sankey-link-label fill-foreground text-3xs tabular-nums">{flowLinkLabel(link, formatCompactAmount)}</text>}
                      </g>
                    )
                  }}
                  node={({ x, y, width, height, index, payload }) => {
                    const label = sankeyLabelLayout({ x, y, width, height, index }, sizes)
                    return (
                      <Layer key={`n-${index}`}>
                        <Rectangle x={x} y={y} width={width} height={height} fill={(payload as unknown as { suspect: boolean }).suspect ? red : 'var(--muted-foreground)'} />
                        <text x={label.x} y={label.y} textAnchor={label.textAnchor} dominantBaseline={label.dominantBaseline}
                          style={{ '--flow-sankey-label-origin': label.transformOrigin } as CSSProperties} className="flow-sankey-label fill-foreground font-mono text-2xs">{payload.name.trim()}</text>
                      </Layer>
                    )
                  }}>
                  <Tooltip content={({ active, payload }) => active && payload?.[0] ? <FlowTip p={payload[0].payload} formatAmount={formatAmount} /> : null} />
                </Sankey>
              </ResponsiveContainer>
            </Box>
          </TransformComponent>
          <Box className="absolute bottom-3 right-3 flex items-center rounded-md border bg-card">
            <IconButton label="축소" onClick={() => zoomOut()}><Minus className="size-3.5" /></IconButton>
            <Text as="span" className="w-10 text-center text-2xs tabular-nums">{Math.round(zoom * 100)}%</Text>
            <IconButton label="확대" onClick={() => zoomIn()}><Plus className="size-3.5" /></IconButton>
            <IconButton label="화면 맞춤" disabled={fitted} onClick={() => resetTransform()}><Shrink className="size-3.5" /></IconButton>
          </Box>
        </Box>
      )}
    </TransformWrapper>
  )
}
