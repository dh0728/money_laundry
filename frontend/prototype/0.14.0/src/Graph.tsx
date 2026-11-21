import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { Expand, Minimize2, Minus, Plus, Search, X, Network, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { nodes, edges, neighborhood, riskColor, money, compactMoney, widthFor, selectGraph, type Risk, type GraphSelection, type AccountNode, type Transaction } from './domain'
import { IconButton } from './shared'

export default function Graph(){
  const [selection,setSelection]=useState<GraphSelection>({node:null,edge:null,hop:1})
  const [risks,setRisks]=useState<Risk[]>(['고위험','중위험','저위험'])
  const [labels,setLabels]=useState('hover'),[search,setSearch]=useState(''),[fullscreen,setFullscreen]=useState(false)
  const [view,setView]=useState({x:0,y:0,k:1}),[hover,setHover]=useState<string|null>(null)
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null)
  const allowed=useMemo(()=>selection.node?neighborhood(selection.node,selection.hop):new Set(nodes.map(n=>n.id)),[selection.node,selection.hop])
  const visible=nodes.filter(n=>risks.includes(n.risk)&&allowed.has(n.id))
  const visibleEdges=edges.filter(e=>visible.some(n=>n.id===e.a)&&visible.some(n=>n.id===e.b))
  const edge=edges.find(e=>e.id===selection.edge)
  const pick=(type:'node'|'edge',id:string)=>setSelection(s=>selectGraph(s,type,id))
  const reset=()=>{setSelection({node:null,edge:null,hop:1});setSearch('');setRisks(['고위험','중위험','저위험']);setView({x:0,y:0,k:1})}
  const fit=()=>{if(!visible.length)return;const xs=visible.map(n=>n.x),ys=visible.map(n=>n.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,k=Math.min(2.5,900/(Math.max(...xs)-Math.min(...xs)+100),590/(Math.max(...ys)-Math.min(...ys)+100));setView({x:(500-cx)*k,y:(345-cy)*k,k})}
  const zoom=(factor:number)=>setView(v=>({...v,k:Math.min(2.5,Math.max(.55,v.k*factor))}))
  function move(e:PointerEvent<SVGSVGElement>){if(!drag.current)return;const r=e.currentTarget.getBoundingClientRect();setView(v=>({...v,x:drag.current!.vx+(e.clientX-drag.current!.x)*1000/r.width,y:drag.current!.vy+(e.clientY-drag.current!.y)*690/r.height}))}
  const body=<div className={`graph-layout ${fullscreen?'h-full min-h-0':'h-[calc(100vh-210px)] min-h-[620px]'} overflow-hidden rounded-lg border bg-card`}>
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize="18%" minSize="155px" maxSize="240px">
        <div className="p-4 h-full flex flex-col gap-5"><div className="flex justify-between items-center"><h3 className="font-semibold text-sm">그래프 설정</h3><IconButton label="그래프 초기화" onClick={reset}><RotateCcw className="size-3.5"/></IconButton></div>
          <div className="space-y-2"><Label className="text-xs text-muted-foreground">거래 정보</Label><Select value={labels} onValueChange={setLabels}><SelectTrigger className="w-full text-xs"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="hover">호버 시 표시</SelectItem><SelectItem value="always">항상 표시</SelectItem></SelectContent></Select></div>
          <div className="space-y-3"><Label className="text-xs text-muted-foreground">계좌 위험도</Label>{(Object.keys(riskColor) as Risk[]).map(r=><Label key={r} className="flex items-center gap-2 text-xs font-normal" style={{color:riskColor[r]}}><Checkbox className="border-current data-[state=checked]:bg-current" style={{color:riskColor[r]}} checked={risks.includes(r)} onCheckedChange={v=>{setRisks(p=>v?[...p,r]:p.filter(x=>x!==r));setSelection(s=>({...s,edge:null}))}}/>{r}</Label>)}</div>
          <div className="space-y-3"><div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground">표시 범위</Label><Badge variant="outline">{selection.hop} hop</Badge></div><Slider aria-label="표시 범위 hop" min={1} max={3} step={1} value={[selection.hop]} disabled={!selection.node} onValueChange={([hop])=>setSelection(s=>({...s,hop}))}/><div className="flex justify-between text-[10px] text-muted-foreground"><span>1</span><span>2</span><span>3</span></div><p className="text-[11px] leading-relaxed text-muted-foreground">{selection.node?`${selection.node}에서 연결된 계좌를 표시합니다.`:'계좌를 선택하면 표시 범위를 조절할 수 있습니다.'}</p></div>
          <div className="mt-auto space-y-3 border-t pt-4 text-[11px] text-muted-foreground"><p>색 · 계좌 위험도<br/>굵기 · 거래 금액<br/>N건 · 계좌쌍 거래 건수</p><p>계좌 선택 → 연결 범위<br/>집계선 선택 → 개별 거래</p></div>
        </div>
      </ResizablePanel><ResizableHandle/>
      <ResizablePanel minSize="300px">
        <div className="h-full flex flex-col min-w-0"><div className="flex gap-2 p-3 border-b items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"/><Input aria-label="그래프 계좌 검색" placeholder="계좌 검색 · A01" className="pl-8 h-8 text-xs" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){const n=nodes.find(n=>n.id.toLowerCase()===search.trim().toLowerCase());if(n){pick('node',n.id);if(!risks.includes(n.risk))setRisks(p=>[...p,n.risk])}}}}/></div><IconButton label={fullscreen?'전체화면 종료':'전체화면'} onClick={()=>setFullscreen(!fullscreen)}><Expand className="size-4"/></IconButton><IconButton label="화면 맞춤" onClick={fit}><Minimize2 className="size-4"/></IconButton></div>
          <div className="relative flex-1 min-h-[500px] graph-canvas"><svg role="img" aria-label={`계좌 관계 그래프 · 계좌 ${visible.length}개, 연결 ${visibleEdges.length}개`} viewBox="0 0 1000 690" className="w-full h-full absolute inset-0 touch-none" onPointerMove={move} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onPointerDown={e=>{if(e.target===e.currentTarget){setSelection(s=>({...s,node:null,edge:null,hop:1}));drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};e.currentTarget.setPointerCapture(e.pointerId)}}} onWheel={e=>{if(e.ctrlKey||e.metaKey)zoom(e.deltaY>0?.9:1.1)}}>
            <defs>{(Object.keys(riskColor) as Risk[]).map((r,i)=><marker key={r} id={`head-${i}`} markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="14" refX="34" refY="7" orient="auto-start-reverse" overflow="visible"><path d="M 0 0 L 16 7 L 0 14 Z" fill={riskColor[r]}/></marker>)}</defs>
            <g transform={`translate(${500+view.x} ${345+view.y}) scale(${view.k}) translate(-500 -345)`}>
              {visibleEdges.map(e=>{
                const a=nodes.find(n=>n.id===e.a)!,b=nodes.find(n=>n.id===e.b)!,mi=Object.keys(riskColor).indexOf(e.risk)
                const color=riskColor[e.risk],active=selection.edge===e.id
                const line=(from:AccountNode,to:AccountNode,t:Transaction,j:number)=>{
                  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy),offset=e.tx.length===2?45:0,px=-dy/len*offset,py=dx/len*offset
                  const path=e.tx.length===2?`M ${from.x} ${from.y} C ${from.x+dx*.3+px} ${from.y+dy*.3+py}, ${to.x-dx*.3+px} ${to.y-dy*.3+py}, ${to.x} ${to.y}`:`M ${from.x} ${from.y} L ${to.x} ${to.y}`
                  return <g key={j}><path d={path} stroke={color} strokeWidth={widthFor(t.amount)} markerEnd={`url(#head-${mi})`} fill="none"/>{(labels==='always'||hover===e.id)&&<text x={(from.x+to.x)/2+px*.75} y={(from.y+to.y)/2+py*.75+3} textAnchor="middle" className="graph-label" fontSize="9">{t.at.slice(11,16)} · {compactMoney(t.amount)}원</text>}</g>
                }
                return <g key={e.id} className="cursor-pointer" opacity={active||hover===e.id?1:.62} onMouseEnter={()=>setHover(e.id)} onMouseLeave={()=>setHover(null)} onClick={()=>pick('edge',e.id)} role="button" tabIndex={0} aria-label={`${e.a} ↔ ${e.b} ${e.tx.length}건 거래`} onKeyDown={k=>{if(k.key==='Enter'||k.key===' '){k.preventDefault();pick('edge',e.id)}}}>
                  <title>{`${e.a} ↔ ${e.b} · ${e.tx.length}건 · ${money(e.amount)}`}</title><path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke="transparent" strokeWidth={25} fill="none"/>
                  {e.tx.length>=3?<path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={color} strokeWidth={widthFor(e.amount)} markerStart={`url(#head-${mi})`} markerEnd={`url(#head-${mi})`} fill="none"/>:e.tx.map((t,j)=>line(nodes.find(n=>n.id===t.from)!,nodes.find(n=>n.id===t.to)!,t,j))}
                  {(e.tx.length>=3)&&<text x={(a.x+b.x)/2} y={(a.y+b.y)/2-11} textAnchor="middle" className="graph-label" fontSize={e.tx.length>=3?12:10}>{e.tx.length>=3?`${e.tx.length}건`:`${e.tx[0].at.slice(11,16)} · ${compactMoney(e.amount)}원`}</text>}
                </g>
              })}
              {visible.map(n=><g key={n.id} role="button" tabIndex={0} aria-label={`계좌 ${n.id} ${n.risk}`} className="cursor-pointer graph-node" onClick={()=>pick('node',n.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick('node',n.id)}}}>
                <title>{`${n.id} · ${n.bank} · ${n.risk}`}</title><circle cx={n.x} cy={n.y} r={n.id.endsWith('01')?22:18} fill={riskColor[n.risk]} stroke={selection.node===n.id?'var(--foreground)':'none'} strokeWidth={3}/><text x={n.x} y={n.y+4} textAnchor="middle" fill="#18181b" fontSize="11" fontWeight="650">{n.id}</text>{search&&n.id.toLowerCase().includes(search.toLowerCase())&&<circle cx={n.x} cy={n.y} r="29" fill="none" stroke="var(--foreground)" strokeDasharray="3 3"/>}
              </g>)}
            </g>
          </svg>{visible.length===0&&<div className="absolute inset-0 grid place-items-center pointer-events-none text-sm text-muted-foreground">선택한 조건에 해당하는 계좌가 없습니다.</div>}
          <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-muted-foreground bg-card/90 rounded-md px-2 py-1"><Network className="size-3.5"/>계좌 {visible.length} · 연결 {visibleEdges.length}</div><div className="absolute bottom-3 right-3 flex items-center bg-card border rounded-md"><IconButton label="축소" onClick={()=>zoom(.85)}><Minus className="size-3.5"/></IconButton><span className="text-[11px] tabular-nums">{Math.round(view.k*100)}%</span><IconButton label="확대" onClick={()=>zoom(1.15)}><Plus className="size-3.5"/></IconButton></div>
          </div>
        </div>
      </ResizablePanel>
      {edge&&<><ResizableHandle withHandle/><ResizablePanel defaultSize="29%" minSize="285px" maxSize="440px"><div className="relative flex flex-col h-full overflow-hidden"><div className="account-lane pointer-events-none absolute left-0 top-[126px] bottom-0 w-3 opacity-80" style={{backgroundColor:riskColor[nodes.find(n=>n.id===edge.a)!.risk]}}/><div className="account-lane pointer-events-none absolute right-0 top-[126px] bottom-0 w-3 opacity-80" style={{backgroundColor:riskColor[nodes.find(n=>n.id===edge.b)!.risk]}}/><div className="p-4 border-b"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{edge.a} ↔ {edge.b}</h3><IconButton label="계좌쌍 상세 닫기" onClick={()=>setSelection(s=>({...s,edge:null}))}><X className="size-4"/></IconButton></div><p className="text-xs text-muted-foreground mt-1">개별 거래 {edge.tx.length}건 · 총 {money(edge.amount)}</p><p className="text-[10px] text-muted-foreground mt-2">{edge.tx[0].at.slice(5,16)} – {edge.tx.at(-1)!.at.slice(5,16)}</p></div><div className="flex justify-between px-5 py-3 border-b text-xs">{[edge.a,edge.b].map(id=><span key={id} className="font-semibold" style={{color:riskColor[nodes.find(n=>n.id===id)!.risk]}}>{id}<span className="font-normal ml-1 text-[10px]">{nodes.find(n=>n.id===id)!.bank}</span></span>)}</div><ScrollArea className="flex-1 min-h-0"><div className="px-4 py-2">{edge.tx.map(t=>{const right=t.from===edge.a,thickness=Math.min(52,10+Math.sqrt(t.amount/800000)*7),top=32-thickness/2,bottom=32+thickness/2;return <div key={t.id} className="py-4 border-b last:border-0"><div className="flex justify-between text-[10px] text-muted-foreground mb-2"><span>{t.id}</span><span>{t.from} → {t.to}</span></div><svg viewBox="0 0 300 64" className="w-full" role="img" aria-label={`${t.at} ${t.from}에서 ${t.to}로 ${money(t.amount)}`}><path d={right?`M0 ${top} H276 L300 32 L276 ${bottom} H0 Z`:`M300 ${top} H24 L0 32 L24 ${bottom} H300 Z`} fill={riskColor[t.risk]} opacity=".32"/><line x1={right?0:300} x2={right?280:20} y1="32" y2="32" stroke={riskColor[t.risk]} strokeWidth={widthFor(t.amount)*2} opacity=".5"/><path d={right?`M276 ${top} L298 32 L276 ${bottom} Z`:`M24 ${top} L2 32 L24 ${bottom} Z`} fill={riskColor[t.risk]}/><text x="150" y="28" textAnchor="middle" fontSize="10" fill="var(--foreground)">{t.at.slice(5,16)}</text><text x="150" y="44" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--foreground)">{money(t.amount)}</text></svg></div>})}</div></ScrollArea></div></ResizablePanel></>}
    </ResizablePanelGroup>
  </div>
  return <>{!fullscreen&&body}<Dialog open={fullscreen} onOpenChange={setFullscreen}><DialogContent className="graph-dialog w-[97vw] h-[94vh] max-w-none! p-4" showCloseButton={false}><DialogTitle className="sr-only">관계 그래프 전체화면</DialogTitle><DialogDescription className="sr-only">계좌 및 거래 탐색. 전체화면 종료 버튼으로 돌아갑니다.</DialogDescription>{fullscreen&&body}</DialogContent></Dialog></>
}
