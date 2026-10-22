import { RESEARCH_SCENES, stageFrame } from './stageTimeline'

export function stageBoundaryKey(position: number, reduced: boolean) {
  const f=stageFrame(position)
  return reduced?`static:${f.active}`:`${f.base}:${f.active}:${Number(f.mix>0)}`
}
/** Sole continuous-visual writer. React owns mounting, accessibility and business state. */
export function paintStage(root: HTMLElement | null, position: number, reduced: boolean) {
  if(!root)return
  const f=stageFrame(position)
  root.dataset.stagePosition=position.toFixed(4)
  const pair=RESEARCH_SCENES[f.base].point?.figure==='xjtu-rul'&&RESEARCH_SCENES[f.next].point?.figure==='rul-sde-pf'
  for(const node of root.querySelectorAll<HTMLElement>('[data-stage-index]')){
    const index=Number(node.dataset.stageIndex),incoming=index!==f.base,shared=node.dataset.stageShared==='true'
    const lifePair=pair&&shared,depth=reduced||lifePair?0:incoming?1-f.mix:-f.mix
    node.style.setProperty('--stage-depth',String(depth));node.style.setProperty('--stage-scale',String(1-Math.abs(depth)*.018))
    node.style.setProperty('--stage-alpha',String(1-Math.abs(depth)))
    node.style.setProperty('--stage-clip-start',`${incoming&&!lifePair&&!reduced?(1-f.mix)*100:0}%`)
    node.style.setProperty('--stage-clip-end',`${!incoming&&!lifePair&&!reduced?f.mix*100:0}%`)
    const life=node.querySelector<HTMLElement>('[data-life-reveal]')
    if(life){
      const reveal=lifePair&&!reduced?f.mix:RESEARCH_SCENES[reduced?f.active:index].point?.figure==='rul-sde-pf'?1:0
      life.dataset.lifeReveal=reveal.toFixed(4)
      life.querySelector('[data-life-clip]')?.setAttribute('width',String(880*reveal))
      life.querySelector('[data-life-hi]')?.setAttribute('opacity',String(1-reveal))
      const cursor=life.querySelector('[data-life-cursor]');cursor?.setAttribute('x1',String(60+880*reveal));cursor?.setAttribute('x2',String(60+880*reveal))
    }
  }
  const rail=root.querySelector<HTMLElement>('.research-stage__progress i')
  if(rail)rail.style.transform=`scaleX(${(position+1)/RESEARCH_SCENES.length})`
}
