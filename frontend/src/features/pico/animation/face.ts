import { chevronPoints, idleLineY, smooth, type PicoFrame } from './controller'
import type { PicoEmotion } from '../core/types'
const INK = '#f3e8d7'
const FONT = '600 88px ui-monospace, "SFMono-Regular", Menlo, monospace'

function line(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 11; ctx.strokeStyle = INK; ctx.fillStyle = INK
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
}
function symbol(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha = 1, scale = 1) {
  ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(1, alpha))
  ctx.translate(x, y); ctx.scale(scale, scale); ctx.font = FONT; ctx.fillStyle = INK
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0); ctx.restore()
}
function chevron(ctx: CanvasRenderingContext2D, blink: number) {
  ctx.beginPath()
  chevronPoints(blink).forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(174 + x, 128 + y)
    else ctx.lineTo(174 + x, 128 + y)
  })
  ctx.stroke()
}
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
  ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(1, alpha))
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore()
}
function drawEmotion(ctx: CanvasRenderingContext2D, emotion: PicoEmotion, f: PicoFrame, small: boolean) {
  line(ctx)
  if (emotion !== 'happy') chevron(ctx, f.blink)
  switch (emotion) {
    case 'idle': {
      const y = idleLineY(f.blink, f.time, f.reduced)
      ctx.beginPath(); ctx.moveTo(294, y)
      ctx.quadraticCurveTo(322, y + (f.reduced ? 0 : Math.sin(f.time * 0.6) * 3), 350, y); ctx.stroke(); break
    }
    case 'curious': {
      const mix = f.curiousMix
      symbol(ctx, '?', 326, 131, 1 - mix * 0.8, 1 - mix * 0.08)
      symbol(ctx, 'o', 326, 130, mix * 0.72, 0.84 + mix * 0.08)
      dot(ctx, 326, 130, 9, Math.max(0, (mix - 0.7) / 0.3)); break
    }
    case 'thinking': f.dots.forEach((a, i) => dot(ctx, 292 + i * 28, 145, 7.5, a)); break
    case 'search': {
      ctx.fillStyle = '#18201f'; ctx.fillRect(110, 62, 290, 132)
      const sets = ['> / 01', '01 + >', '+ 10 /', '/ > 10']
      const phase = f.reduced ? 0 : f.time * 0.65, index = Math.floor(phase) % sets.length, mix = f.reduced ? 1 : Math.min(1, (phase % 1) * 5)
      ctx.font = `${small ? 67 : 48}px ui-monospace, Menlo, monospace`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK
      ctx.save(); ctx.globalAlpha *= 1 - mix; ctx.fillText(sets[(index + sets.length - 1) % sets.length], 256, small ? 128 : 94); ctx.restore()
      ctx.save(); ctx.globalAlpha *= mix; ctx.fillText(sets[index], 256, small ? 128 : 94); ctx.restore()
      if (!small) { ctx.globalAlpha *= 0.65; ctx.fillText('10 / +', 256, 160) }; break
    }
    case 'talking':
      if (f.reduced) { symbol(ctx, 'O', 326, 130); break }
      symbol(ctx, f.mouthFrom, 326, 130, 1 - f.mouthMix, 0.98 - f.mouthMix * 0.09)
      symbol(ctx, f.mouthTo, 326, 130, f.mouthMix, 0.88 + f.mouthMix * 0.12); break
    case 'happy': {
      const phase = f.reduced ? 0 : (f.time * 0.26) % 3
      const index = Math.floor(phase)
      const mix = smooth(((phase % 1) - 0.72) / 0.28)
      const draw = (variant: number, alpha: number) => {
        ctx.save(); ctx.globalAlpha *= alpha
        if (variant === 2) chevron(ctx, f.blink)
        else { dot(ctx, 174, 109, 7.5, 1); dot(ctx, 174, 146, 7.5, 1) }
        symbol(ctx, ['D', 'p', 'ᴗ'][variant], 326, 132, 1, 1.05)
        ctx.restore()
      }
      draw(index, 1 - mix); draw((index + 1) % 3, mix); break
    }
    case 'alert':
      symbol(ctx, '!', 326, 128, 1, 1.08)
      ctx.beginPath(); ctx.moveTo(143, 76); ctx.lineTo(190, 69); ctx.stroke(); break
    case 'confused': {
      const mix = f.reduced ? 0 : smooth((Math.sin(f.time * 1.1) + .15) / 1.15)
      symbol(ctx, 'x', 326, 130, 1 - mix * .75, .95)
      symbol(ctx, '?', 326, 128, mix * .75, .92)
      ctx.beginPath(); ctx.moveTo(148, 72); ctx.lineTo(187, 82); ctx.stroke(); break
    }
  }
}

/** Only generates the face texture: both the body and this display are Three meshes. */
export function paintFace(ctx: CanvasRenderingContext2D, frame: PicoFrame, small: boolean): void {
  ctx.clearRect(0, 0, 512, 256); ctx.fillStyle = '#18201f'; ctx.fillRect(0, 0, 512, 256)
  ctx.strokeStyle = '#49504a'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 506, 250)
  for (const [emotion, weight] of Object.entries(frame.weights) as [PicoEmotion, number][]) {
    if (weight < 0.002) continue
    ctx.save(); ctx.globalAlpha = weight
    ctx.translate(frame.gazeX * 15, frame.gazeY * 11)
    drawEmotion(ctx, emotion, frame, small); ctx.restore()
  }
}

/** Only visible texture inputs: sub-pixel changes need no new Canvas/GPU upload. */
export function faceSignature(f: PicoFrame, small: boolean): string {
  const q=(v:number,precision=250)=>Math.round(v*precision)
  const parts: (number|string)[]=[Number(small),Number(f.reduced),q(f.blink,1000),q(f.gazeX,100),q(f.gazeY,100)]
  for(const [emotion,weight] of Object.entries(f.weights) as [PicoEmotion,number][]){
    if(weight<.002)continue
    parts.push(emotion,q(weight,1000))
    switch(emotion){
      case 'idle':parts.push(q(idleLineY(f.blink,f.time,f.reduced),10),q(f.reduced?0:Math.sin(f.time*.6)*3,10));break
      case 'curious':parts.push(q(f.curiousMix));break
      case 'thinking':parts.push(...f.dots.map(v=>q(v)));break
      case 'search':{const phase=f.reduced?0:f.time*.65;parts.push(Math.floor(phase)%4,q(f.reduced?1:Math.min(1,(phase%1)*5)));break}
      case 'talking':parts.push(f.mouthFrom,f.mouthTo,q(f.mouthMix));break
      case 'happy':{const phase=f.reduced?0:(f.time*.26)%3;parts.push(Math.floor(phase),q(smooth(((phase%1)-.72)/.28)));break}
      case 'confused':parts.push(q(f.reduced?0:smooth((Math.sin(f.time*1.1)+.15)/1.15)));break
    }
  }
  return parts.join('|')
}
