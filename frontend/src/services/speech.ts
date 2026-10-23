export type SpeechState = 'start' | 'end' | 'error' | 'cancel' | 'pause' | 'resume'
let zhVoice: SpeechSynthesisVoice | undefined
let active: { utterance: SpeechSynthesisUtterance; finish: (state: SpeechState) => void } | undefined

function cacheVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const voices = window.speechSynthesis.getVoices() ?? []
  zhVoice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang))
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  cacheVoices()
  window.speechSynthesis.addEventListener('voiceschanged', cacheVoices)
}

/** Queuing speech does not imply audible playback. State follows the native lifecycle. */
export function speakChinese(text: string, onEnd?: () => void, onState?: (state: SpeechState) => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return false
  stopChineseSpeech()
  cacheVoices()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  if (zhVoice) utterance.voice = zhVoice
  utterance.rate = 1.02
  let finished = false
  const finish = (state: SpeechState) => {
    if (finished) return
    finished = true
    if (active?.utterance === utterance) active = undefined
    onState?.(state)
    onEnd?.()
  }
  const emit = (state: SpeechState) => {
    if (!finished && active?.utterance === utterance) onState?.(state)
  }
  active = { utterance, finish }
  utterance.onstart = () => emit('start')
  utterance.onresume = () => emit('resume')
  utterance.onpause = () => emit('pause')
  utterance.onend = () => finish('end')
  utterance.onerror = () => finish('error')
  try { window.speechSynthesis.speak(utterance); return true }
  catch { finish('error'); return false }
}

/** Native cancel is not guaranteed to dispatch end/error, so finalize explicitly. */
export function stopChineseSpeech(): void {
  active?.finish('cancel')
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
