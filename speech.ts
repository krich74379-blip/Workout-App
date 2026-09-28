/** Small browser helpers for the voice UI (no Web Speech / SpeechRecognition). */

export function isSecureContextOk(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
}

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS = /iPad|iPhone|iPod/.test(ua)
  const iPadOS =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOS || iPadOS
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia?.('(display-mode: standalone)')?.matches
  const nav = navigator as Navigator & { standalone?: boolean }
  return Boolean(mq || nav.standalone)
}

/**
 * Quiet optional TTS — speechSynthesis only (no HTMLAudioElement).
 * Disabled on iOS: speechSynthesis can interfere with the next mic session.
 */
export function speakQuiet(text: string): void {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    if (isIOSDevice()) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.volume = 0.35
    u.rate = 1.05
    u.lang = 'en-US'
    window.speechSynthesis.speak(u)
  } catch {
    /* ignore */
  }
}
