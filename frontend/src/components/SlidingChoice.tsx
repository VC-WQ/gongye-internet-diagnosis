import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { useUiPreferences } from '../services/uiPrefs'
import './slidingChoice.css'

/** A controlled radio group: one value, one persistent shared visual indicator. */
export default function SlidingChoice<T extends string>({ value, options, onChange, label, dataPrefix }: {
  value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string; dataPrefix?: string
}) {
  const rail=useRef<HTMLDivElement>(null),indicator=useRef<HTMLSpanElement>(null),animation=useRef<Animation>()
  const { reducedMotion }=useUiPreferences()
  useLayoutEffect(()=>{
    const root=rail.current!,node=indicator.current!
    const update=()=>{
      const selected=root.querySelector<HTMLElement>('[aria-checked=true]')
      if(!selected)return
      const from=node.getBoundingClientRect(),parent=root.getBoundingClientRect()
      animation.current?.cancel()
      const x=selected.offsetLeft,width=selected.offsetWidth
      const scroller=root.parentElement
      if(scroller){
        const left=selected.offsetLeft,right=left+width
        if(left<scroller.scrollLeft)scroller.scrollLeft=Math.max(0,left-4)
        else if(right>scroller.scrollLeft+scroller.clientWidth)scroller.scrollLeft=right-scroller.clientWidth+4
      }
      node.style.width=`${width}px`;node.style.transform=`translateX(${x}px)`
      if(!reducedMotion&&from.width)animation.current=node.animate([
        {transform:`translateX(${from.left-parent.left-root.clientLeft}px)`,width:`${from.width}px`},
        {transform:`translateX(${x}px)`,width:`${width}px`},
      ],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'})
    }
    update();const observer=new ResizeObserver(update);observer.observe(root)
    return()=>observer.disconnect()
  },[value,reducedMotion])
  useLayoutEffect(()=>()=>animation.current?.cancel(),[])
  const key=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:delta?(index+delta+options.length)%options.length:undefined
    if(next===undefined)return
    event.preventDefault();onChange(options[next].value)
    rail.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus({preventScroll:true})
  }
  return <div className="sliding-choice-scroll"><div className="sliding-choice" ref={rail} role="radiogroup" aria-label={label}>
    <span className="sliding-choice__indicator" ref={indicator} aria-hidden="true" data-sliding-indicator />
    {options.map((option,i)=><button type="button" key={option.value} role="radio" aria-checked={value===option.value} tabIndex={value===option.value?0:-1}
      {...(dataPrefix?{[dataPrefix]:option.value}:{})} onClick={()=>onChange(option.value)} onKeyDown={event=>key(event,i)}>{option.label}</button>)}
  </div></div>
}
