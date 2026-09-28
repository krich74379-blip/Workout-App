/**
 * Siri / Shortcuts deep-link helpers.
 * Example: https://HOST/?log=bench%20press%20185%20for%208
 */

export type DeepLinkPayload = {
  utterance: string
  /** When true, auto-save high-confidence complete parses. Default true if `log`/`voice` present. */
  autolog: boolean
}

/** Read `log` (preferred) or `voice` (+ optional `autolog`) from a URLSearchParams / location. */
export function readDeepLinkParams(
  search: string | URLSearchParams = typeof window !== 'undefined'
    ? window.location.search
    : '',
): DeepLinkPayload | null {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search
  const raw = params.get('log') ?? params.get('voice')
  if (raw == null) return null
  const utterance = raw.trim()
  if (!utterance) return null

  const autoRaw = params.get('autolog')
  // Default true when utterance present; only false for 0/false/no
  const autolog =
    autoRaw == null
      ? true
      : !['0', 'false', 'no', 'off'].includes(autoRaw.trim().toLowerCase())

  return { utterance, autolog }
}

/** Remove log/voice/autolog from the URL without adding history (avoid re-log on refresh). */
export function clearDeepLinkParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of ['log', 'voice', 'autolog'] as const) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next || '/')
}

/** Example deep-link URL for the current origin. */
export function exampleDeepLinkUrl(
  utterance = 'bench press 185 for 8',
  origin = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const base = origin || 'https://YOUR_ORIGIN'
  return `${base}/?log=${encodeURIComponent(utterance)}`
}
