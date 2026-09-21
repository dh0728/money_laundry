import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Calendar } from './components/ui/calendar'

it.each([[2026,7,31],[2026,8,30],[2026,1,28],[2024,1,29]])('calendar includes every date once: %i-%i', (year,month,days)=>{
  const date=new Date(year,month,1)
  const html=renderToStaticMarkup(<Calendar mode="single" month={date} today={date} showOutsideDays={false}/>)
  const displayed=[...html.matchAll(/<button\b[^>]*data-day="([^"]+)"/g)].map(m=>new Date(m[1])).filter(d=>d.getFullYear()===year&&d.getMonth()===month).map(d=>d.getDate())
  expect(displayed).toEqual(Array.from({length:days},(_,i)=>i+1))
})
