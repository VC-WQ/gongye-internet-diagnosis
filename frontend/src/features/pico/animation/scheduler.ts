type FrameClient = { active: () => boolean; due?: () => number; resume?: () => void; render: (now: number) => void }
const clients = new Set<FrameClient>()
let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined
let listening = false
let wasHidden = false
function stop() { cancelAnimationFrame(raf); raf = 0; clearTimeout(timer); timer = undefined }
function loop(now: number) {
  raf = 0
  if (document.hidden) return
  let next = Infinity
  for (const client of clients) {
    if (!client.active()) continue
    if ((client.due?.() ?? 0) <= now + .5) client.render(now)
    if (client.active()) next = Math.min(next, client.due?.() ?? now)
  }
  if (!Number.isFinite(next)) return
  const delay = next - now
  // Sleep between low-frequency frames instead of waking at every display tick.
  if (delay > 20) timer = setTimeout(() => { timer = undefined; wakePicoFrames() }, Math.max(0, delay - 8))
  else raf = requestAnimationFrame(loop)
}
export function wakePicoFrames(): void {
  clearTimeout(timer); timer = undefined
  if (!raf && clients.size && !document.hidden) raf = requestAnimationFrame(loop)
}
function visibility() {
  if(document.hidden){wasHidden=true;stop()}
  else {if(wasHidden)for(const client of clients)client.resume?.();wasHidden=false;wakePicoFrames()}
}
/** One deadline-aware scheduler; last unmount releases RAF, timer and listener. */
export function subscribePicoFrame(client: FrameClient): () => void {
  clients.add(client)
  if (!listening) { wasHidden=document.hidden; document.addEventListener('visibilitychange', visibility); listening = true }
  wakePicoFrames()
  return () => {
    clients.delete(client)
    if (!clients.size) { stop(); document.removeEventListener('visibilitychange', visibility); listening = false }
  }
}
