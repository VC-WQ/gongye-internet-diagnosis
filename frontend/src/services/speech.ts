let zhVoice: SpeechSynthesisVoice | undefined

function cacheVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const vs = window.speechSynthesis.getVoices() ?? []
  zhVoice =
    vs.find((v) => /zh[-_]CN/i.test(v.lang)) ??
    vs.find((v) => /^zh/i.test(v.lang)) ??
    vs.find((v) => /chinese|CMN/i.test(v.name))
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  cacheVoices()
  window.speechSynthesis.onvoiceschanged = cacheVoices
}

/** 用中文语音朗读文本；返回是否成功发起（浏览器支持且文本非空）。 */
export function speakChinese(text: string, onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text)
    return false
  window.speechSynthesis.cancel()
  cacheVoices()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  if (zhVoice) u.voice = zhVoice
  u.rate = 1.02
  u.pitch = 1
  if (onEnd) u.onend = onEnd
  window.speechSynthesis.speak(u)
  return true
}

/** 立即停止当前语音播报。 */
export function stopChineseSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
