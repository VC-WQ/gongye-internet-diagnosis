type FrameClient = { active: () => boolean; render: (now: number) => void }
const clients = new Set<FrameClient>()
let raf = 0
let listening = false
function loop(now: number) {
  raf = 0
  if (document.hidden) return
  let active = false
  for (const client of clients) {
    if (!client.active()) continue
    active = true; client.render(now)
  }
  if (active) raf = requestAnimationFrame(loop)
}
export function wakePicoFrames(): void {
  if (!raf && clients.size && !document.hidden) raf = requestAnimationFrame(loop)
}
function visibility() {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
  else wakePicoFrames()
}
/** All visible avatars share one RAF; the last unmount releases the scheduler. */
export function subscribePicoFrame(client: FrameClient): () => void {
  clients.add(client)
  if (!listening) { document.addEventListener('visibilitychange', visibility); listening = true }
  wakePicoFrames()
  return () => {
    clients.delete(client)
    if (!clients.size) {
      cancelAnimationFrame(raf); raf = 0
      document.removeEventListener('visibilitychange', visibility); listening = false
    }
  }
}
