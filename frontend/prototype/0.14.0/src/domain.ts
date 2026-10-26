export type Risk = '고위험' | '중위험' | '저위험'
export type Kind = 'Alert' | 'Episode'
export type RecordItem = {id:string;kind:Kind;risk:Risk;score:number;pattern:string;probability:number;amount:number;count:number;owner:string;status:string;date:string;age:number;title:string;episodeId?:string}
export type Filter = {field:'risk'|'owner'|'status'|'pattern'|'age';value:string}
export const riskColor:Record<Risk,string> = {'고위험':'#ef7777','중위험':'#e6bd62','저위험':'#72bba0'}
export const patterns=['FAN_OUT','FAN_IN','CYCLE','STACK']
export const money=(n:number)=>new Intl.NumberFormat('ko-KR').format(n)+'원'
export const compactMoney=(n:number)=>n>=100000000 ? `${(n/100000000).toFixed(1)}억` : `${Math.round(n/10000).toLocaleString()}만`
export const records:RecordItem[]=Array.from({length:32},(_,i)=>({
  id:`${i<22?'ALT':'EP'}-2026-${String(i<22?1842-i:328-(i-22)).padStart(4,'0')}`,
  kind:i<22?'Alert':'Episode', risk:(['고위험','중위험','저위험'] as Risk[])[i%3],score:[92,67,34][i%3],
  pattern:patterns[i%4],probability:[87,76,62,91,83][i%5],amount:[128400000,76200000,31800000,584000000,9700000][i%5],count:18+(i*7)%60,
  owner:i<22?(i%4===1?'김조사':'오검토'):(i%4===1?'박분석':'안분석'),status:i%7===6?'종결':i%4===0?'신규':i<22?'검토 중':'조사 중',
  date:`2026-09-${String(16-(i%12)).padStart(2,'0')}`,age:i%12,
  title:['단시간 다수 계좌 분산 송금','소액 반복 입금 후 일괄 이체','연결 계좌 간 순환 거래','중계 계좌를 경유한 자금 이동'][i%4]
}))
export function matches(r:RecordItem,filters:Filter[],query:string,start?:Date,end?:Date){
  const day=new Date(r.date+'T12:00:00')
  return filters.every(f=>f.field==='age'?r.age>=Number(f.value):r[f.field]===f.value)&&`${r.id} ${r.title} ${r.owner} ${r.pattern}`.toLowerCase().includes(query.toLowerCase())&&(!start||day>=new Date(start.getFullYear(),start.getMonth(),start.getDate()))&&(!end||day<new Date(end.getFullYear(),end.getMonth(),end.getDate()+1))
}
export const canClose=(actor:string,owner:string,reason:string)=>actor===owner&&reason.trim().length>0
export type AccountNode={id:string;x:number;y:number;risk:Risk;bank:string}
export type Transaction={id:string;from:string;to:string;amount:number;at:string;risk:Risk}
export type Edge={id:string;a:string;b:string;tx:Transaction[];amount:number;risk:Risk}
const centers=[[205,160],[505,120],[805,175],[800,485],[505,530],[195,480]]
export const nodes:AccountNode[]=centers.flatMap(([x,y],i)=>Array.from({length:5},(_,j)=>({id:`${'ABCDEF'[i]}${String(j+1).padStart(2,'0')}`,x:j===0?x:x+Math.cos((j-1)*Math.PI/2+Math.PI/4)*94,y:j===0?y:y+Math.sin((j-1)*Math.PI/2+Math.PI/4)*94,risk:(['고위험','중위험','저위험'] as Risk[])[(i+(j===0?0:j%3))%3],bank:['금융회사 A','금융회사 B','금융회사 C'][i%3]})))
const pairs=centers.flatMap((_,i)=>Array.from({length:4},(_,j)=>[nodes[i*5].id,nodes[i*5+j+1].id] as const))
for(let i=0;i<6;i++)pairs.push([nodes[i*5].id,nodes[((i+1)%6)*5].id])
pairs.push(['A01','C01'],['B01','E01'],['D01','F01'])
export const edges:Edge[]=pairs.map(([a,b],i)=>{
  const risk=nodes.find(n=>n.id===a)!.risk
  const tx:Transaction[]=Array.from({length:i%4===0?1:i%4===1?2:5+i%5},(_,j)=>({
    id:`TX-${i+1}-${j+1}`,from:j%3===1?b:a,to:j%3===1?a:b,
    amount:[800000,2400000,12400000,48000000,180000000][(i+j)%5],
    at:`2026-09-${String(14+Math.floor(j/4)).padStart(2,'0')} ${String(9+j).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:24`,risk
  }))
  return {id:`E${String(i+1).padStart(2,'0')}`,a,b,tx,amount:tx.reduce((n,t)=>n+t.amount,0),risk}
})
export const transactions=edges.flatMap(e=>e.tx)
export function transactionsFor(record:RecordItem){const index=Math.abs(Number(record.id.split('-').at(-1)))%edges.length;return [...edges[index].tx,...edges[(index+1)%edges.length].tx]}
records.forEach(r=>{const tx=transactionsFor(r);r.count=tx.length;r.amount=tx.reduce((s,t)=>s+t.amount,0)})
export const widthFor=(amount:number)=>1.4+Math.log10(1+Math.max(0,amount)/10000)*1.75
export function neighborhood(id:string,hop:number){
  const seen=new Set([id]);let layer=[id]
  for(let i=0;i<hop;i++){const next:string[]=[];edges.forEach(e=>{if(layer.includes(e.a)&&!seen.has(e.b)){seen.add(e.b);next.push(e.b)}if(layer.includes(e.b)&&!seen.has(e.a)){seen.add(e.a);next.push(e.a)}});layer=next}
  return seen
}
export type GraphSelection={node:string|null;edge:string|null;hop:number}
export function selectGraph(_:GraphSelection,type:'node'|'edge',id:string):GraphSelection{return {node:type==='node'?id:null,edge:type==='edge'?id:null,hop:1}}

records.filter(r=>r.kind==='Alert').forEach(r=>{r.episodeId=records.find(e=>e.kind==='Episode'&&e.pattern===r.pattern)?.id})
