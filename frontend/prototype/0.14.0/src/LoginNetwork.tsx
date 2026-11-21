import { useEffect, useRef } from 'react'

type Node = { x:number; y:number; vx:number; vy:number; r:number }

export default function LoginNetwork(){
  const canvasRef=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const canvas=canvasRef.current
    if(!canvas)return
    const context=canvas.getContext('2d')
    if(!context)return
    const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nodes:Array<Node>=Array.from({length:38},()=>({x:Math.random(),y:Math.random(),vx:(Math.random()-.5)*.00018,vy:(Math.random()-.5)*.00018,r:1.4+Math.random()*1.8}))
    const pointer={x:.5,y:.5,active:false}
    let frame=0,width=0,height=0
    const resize=()=>{const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,2);width=rect.width;height=rect.height;canvas.width=Math.max(1,width*ratio);canvas.height=Math.max(1,height*ratio);context.setTransform(ratio,0,0,ratio,0,0)}
    const move=(event:PointerEvent)=>{const rect=canvas.getBoundingClientRect();pointer.x=(event.clientX-rect.left)/rect.width;pointer.y=(event.clientY-rect.top)/rect.height;pointer.active=true}
    const leave=()=>{pointer.active=false}
    const draw=()=>{
      context.clearRect(0,0,width,height)
      for(const node of nodes){
        if(!reduce){node.x+=node.vx+(pointer.active?(pointer.x-node.x)*.000015:0);node.y+=node.vy+(pointer.active?(pointer.y-node.y)*.000015:0);if(node.x<-.05||node.x>1.05)node.vx*=-1;if(node.y<-.05||node.y>1.05)node.vy*=-1}
      }
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
        const a=nodes[i],b=nodes[j],dx=(a.x-b.x)*width,dy=(a.y-b.y)*height,distance=Math.hypot(dx,dy),limit=Math.min(190,width*.23)
        if(distance<limit){context.beginPath();context.moveTo(a.x*width,a.y*height);context.lineTo(b.x*width,b.y*height);context.strokeStyle=`rgba(255,255,255,${.2*(1-distance/limit)})`;context.lineWidth=.75;context.stroke()}
      }
      for(const node of nodes){context.beginPath();context.arc(node.x*width,node.y*height,node.r,0,Math.PI*2);context.fillStyle='rgba(255,255,255,.72)';context.fill()}
      if(!reduce)frame=requestAnimationFrame(draw)
    }
    resize();draw();canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);const observer=new ResizeObserver(resize);observer.observe(canvas)
    return()=>{cancelAnimationFrame(frame);observer.disconnect();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave)}
  },[])
  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full opacity-80"/>
}
