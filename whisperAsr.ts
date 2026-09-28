/**
 * Mic capture via MediaRecorder (audio-only) + POST /api/transcribe.
 * ScriptProcessor/PCM path removed — iOS Safari/PWA reliably encodes with
 * MediaRecorder (typically audio/mp4); server ffmpeg-decodes to 16 kHz mono.
 *
 * Level meter uses an AnalyserNode on each recording's own MediaStream
 * (meter only). Each recording gets a fresh getUserMedia stream that is
 * stopped when the recording ends — streams are never reused.
 *
 * iOS Safari: start() with NO timeslice; blob assembled only in onstop.
 */

import { isIOSDevice } from './speech'

const MIC_GRANTED_STORAGE_KEY = 'workout-log:mic-granted'

/** Prefer mp4/aac on iOS; webm elsewhere. */
const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
] as const


export function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

/** Primary capability check — MediaRecorder is required. */
export function isMicSupported(): boolean {
  return isMediaRecorderSupported()
}

/** @deprecated use isMicSupported */
export function isWhisperSupported(): boolean {
  return isMicSupported()
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      /* ignore */
    }
  }
  // Safari sometimes supports MediaRecorder but reports no types — let browser pick.
  return undefined
}

function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return w.AudioContext || w.webkitAudioContext || null
}

/**
 * Mic permission bookkeeping only. There is deliberately NO shared/cached
 * MediaStream: every recording calls getUserMedia fresh and stops its tracks
 * when it finishes. Reusing one stream across MediaRecorder instances (plus an
 * AudioContext source on it) makes iOS Safari produce empty/silent recordings
 * after the first one. Within one page session iOS Safari does not re-prompt
 * after the first grant, so "ask once" is still effectively preserved.
 */
let micGranted = readMicGrantedFromStorage()
let visibilityHooksInstalled = false
/**
 * Meter-only AudioContext primed in the user-gesture turn. Ownership moves to
 * the next startMediaCapture() call, which closes it when that recording ends
 * (one AudioContext per recording — nothing carries over).
 */
let primedMeterCtx: AudioContext | null = null

function readMicGrantedFromStorage(): boolean {
  try {
    return localStorage.getItem(MIC_GRANTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistMicGranted(granted: boolean): void {
  micGranted = granted
  try {
    if (granted) localStorage.setItem(MIC_GRANTED_STORAGE_KEY, '1')
    else localStorage.removeItem(MIC_GRANTED_STORAGE_KEY)
  } catch {
    /* private mode / quota */
  }
}

export function isMicPermissionGranted(): boolean {
  return micGranted
}

export type MicPermissionQuery = 'granted' | 'denied' | 'prompt' | 'unknown'

export async function queryMicPermission(): Promise<MicPermissionQuery> {
  try {
    const perms = navigator.permissions
    if (!perms?.query) return micGranted ? 'granted' : 'unknown'
    const status = await perms.query({
      name: 'microphone' as PermissionName,
    })
    const state = status.state
    if (state === 'granted') {
      persistMicGranted(true)
      return 'granted'
    }
    if (state === 'denied') return 'denied'
    if (state === 'prompt') return 'prompt'
    return micGranted ? 'granted' : 'unknown'
  } catch {
    return micGranted ? 'granted' : 'unknown'
  }
}

function onPageVisibilityOrShow(): void {
  if (primedMeterCtx && primedMeterCtx.state === 'suspended') {
    void primedMeterCtx.resume().catch(() => undefined)
  }
}

function installVisibilityHooks(): void {
  if (visibilityHooksInstalled || typeof document === 'undefined') return
  visibilityHooksInstalled = true
  document.addEventListener('visibilitychange', onPageVisibilityOrShow)
  window.addEventListener('pageshow', onPageVisibilityOrShow)
}

/**
 * Sync: create/resume meter AudioContext in the user-gesture turn.
 * Safe no-op if Web Audio is unavailable (MediaRecorder still works).
 * The context is handed to (and closed by) the next recording.
 */
export function primeCaptureAudioContext(): AudioContext | null {
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  try {
    if (!primedMeterCtx || primedMeterCtx.state === 'closed') {
      primedMeterCtx = new Ctor()
    }
    if (primedMeterCtx.state === 'suspended') {
      void primedMeterCtx.resume().catch(() => undefined)
    }
  } catch {
    primedMeterCtx = null
  }
  return primedMeterCtx
}

/** Take ownership of the primed meter context (caller must close it). */
function takePrimedMeterCtx(): AudioContext | null {
  const ctx = primeCaptureAudioContext()
  primedMeterCtx = null
  return ctx
}

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return
  try {
    for (const t of stream.getTracks()) t.stop()
  } catch {
    /* ignore */
  }
}

async function requestUserMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API not available in this browser.')
  }
  const attempts: MediaStreamConstraints[] = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    { audio: true },
  ]
  let lastErr: unknown
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastErr = err
    }
  }
  const err = lastErr
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    throw new Error(
      'Microphone permission denied. Allow mic access for this site, then try again.',
    )
  }
  throw err instanceof Error
    ? err
    : new Error('Could not access the microphone.')
}

/** Fresh getUserMedia stream for ONE recording. Caller must stop its tracks. */
async function openFreshMicStream(): Promise<MediaStream> {
  installVisibilityHooks()
  const stream = await requestUserMedia()
  persistMicGranted(true)
  for (const track of stream.getAudioTracks()) track.enabled = true
  return stream
}

/**
 * Permission warm-up: opens the mic once (triggers the prompt if needed) and
 * immediately releases it. No stream is kept for later recordings.
 */
export async function ensureSharedMicStream(): Promise<void> {
  const stream = await openFreshMicStream()
  stopStreamTracks(stream)
}

export async function warmUpMicrophone(): Promise<void> {
  return ensureSharedMicStream()
}

export type MediaCaptureResult = {
  blob: Blob
  mime: string
  size: number
  /** Peak analyser level (0–1-ish) while recording. */
  peak: number
  chunkCount: number
  /** Wall-clock ms from start() to stop(). */
  durationMs: number
}

export type MediaCaptureHandle = {
  /** Stop recorder; returns encoded audio + debug fields. */
  stop: () => Promise<MediaCaptureResult>
  cancel: () => void
  /** Peak analyser level seen while recording (0–1-ish). */
  getPeakLevel: () => number
}

/** Max wait for Safari to fire onstop after recorder.stop(). */
const STOP_SAFETY_TIMEOUT_MS = 4000

/**
 * Start MediaRecorder capture (must be called from a user-gesture turn).
 *
 * iOS Safari: recorder.start() is called WITHOUT a timeslice. With a timeslice
 * Safari emits fragmented MP4 where only the first chunk carries the init
 * segment (ftyp/moov); any incomplete assembly produced files ffmpeg could not
 * decode ("moov atom not found"). Without a timeslice Safari delivers one
 * complete MP4 in a single dataavailable right before onstop.
 *
 * Every call is fully independent: fresh getUserMedia stream, fresh
 * MediaRecorder, fresh chunks/promise/timers, fresh meter AudioContext.
 * When the recording ends (onstop / error / cancel / safety timeout) the
 * stream's tracks are stopped and the meter nodes + context are closed.
 */
export async function startMediaCapture(
  onLevel?: (level01: number) => void,
): Promise<MediaCaptureHandle> {
  if (!isMediaRecorderSupported()) {
    const hint = isIOSDevice()
      ? ' This iOS Safari/PWA build needs MediaRecorder (iOS 14.3+). Update Safari or open in a newer browser.'
      : ' Update your browser or try Chrome/Firefox.'
    throw new Error(`MediaRecorder is not supported.${hint}`)
  }

  // Claim the gesture-primed meter context (this recording owns + closes it).
  let ctx: AudioContext | null = takePrimedMeterCtx()
  const closeCtx = () => {
    const c = ctx
    ctx = null
    if (c && c.state !== 'closed') void c.close().catch(() => undefined)
  }

  let stream: MediaStream
  try {
    stream = await openFreshMicStream()
  } catch (err) {
    closeCtx()
    throw err
  }

  const mimeType = pickRecorderMimeType()
  let recorder: MediaRecorder
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
  } catch (err) {
    try {
      recorder = new MediaRecorder(stream)
    } catch {
      stopStreamTracks(stream)
      closeCtx()
      throw new Error(
        err instanceof Error
          ? `Could not start MediaRecorder: ${err.message}`
          : 'Could not start MediaRecorder.',
      )
    }
  }

  const chunks: Blob[] = []
  let peakSeen = 0
  let meterRaf: number | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  const startedAt = Date.now()
  let stoppedAt = 0

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }

  // Meter graph (optional — capture still works if Web Audio fails)
  if (ctx) {
    try {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)
      // Do NOT connect to destination — avoids feedback / Safari quirks.

      const timeData = new Uint8Array(analyser.fftSize)
      const tick = () => {
        if (!analyser) return
        analyser.getByteTimeDomainData(timeData)
        let sum = 0
        let peak = 0
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128
          sum += v * v
          const a = Math.abs(v)
          if (a > peak) peak = a
        }
        if (peak > peakSeen) peakSeen = peak
        const rms = Math.sqrt(sum / timeData.length)
        onLevel?.(Math.min(1, rms * 5 + peak * 0.6))
        meterRaf = requestAnimationFrame(tick)
      }
      meterRaf = requestAnimationFrame(tick)
    } catch {
      /* meter optional */
    }
  }

  const cleanupMeter = () => {
    if (meterRaf != null) {
      cancelAnimationFrame(meterRaf)
      meterRaf = null
    }
    try {
      source?.disconnect()
      analyser?.disconnect()
    } catch {
      /* ignore */
    }
    source = null
    analyser = null
  }

  /** Release EVERYTHING this recording holds. Idempotent. */
  let released = false
  let safetyTimer: ReturnType<typeof setTimeout> | null = null
  const releaseAll = () => {
    if (safetyTimer != null) {
      clearTimeout(safetyTimer)
      safetyTimer = null
    }
    if (released) return
    released = true
    cleanupMeter()
    recorder.ondataavailable = null
    recorder.onstop = null
    recorder.onerror = null
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      /* ignore */
    }
    stopStreamTracks(stream)
    closeCtx()
  }

  // Build the blob + result ONLY once the recorder has stopped.
  let resolveStopped: ((r: MediaCaptureResult) => void) | null = null
  let rejectStopped: ((e: Error) => void) | null = null
  const stoppedPromise = new Promise<MediaCaptureResult>((res, rej) => {
    resolveStopped = res
    rejectStopped = rej
  })
  // Avoid unhandled-rejection noise if stop() is never awaited (cancel path).
  stoppedPromise.catch(() => undefined)
  let finished = false
  const buildResult = (): MediaCaptureResult => {
    const type = recorder.mimeType || mimeType || 'audio/mp4'
    const blob = new Blob(chunks, { type })
    return {
      blob,
      mime: type,
      size: blob.size,
      peak: peakSeen,
      chunkCount: chunks.length,
      durationMs: (stoppedAt || Date.now()) - startedAt,
    }
  }
  const finishOk = () => {
    if (finished) return
    finished = true
    const result = buildResult() // blob built from chunks BEFORE tracks stop
    releaseAll()
    resolveStopped?.(result)
  }
  const finishErr = (e: Error) => {
    if (finished) return
    finished = true
    releaseAll()
    rejectStopped?.(e)
  }
  recorder.onstop = () => finishOk()
  recorder.onerror = (ev) => {
    const msg =
      (ev as unknown as { error?: { message?: string } })?.error?.message || ''
    finishErr(new Error(`MediaRecorder error${msg ? `: ${msg}` : ''}`))
  }

  try {
    // NO timeslice — see doc comment above.
    recorder.start()
  } catch (err) {
    finished = true
    releaseAll()
    throw err instanceof Error ? err : new Error('MediaRecorder.start failed.')
  }

  let stopCalled = false

  return {
    getPeakLevel: () => peakSeen,
    stop: () => {
      if (!stopCalled) {
        stopCalled = true
        stoppedAt = Date.now()
        cleanupMeter()
        try {
          if (recorder.state !== 'inactive') {
            recorder.stop()
            // Safety: Safari never fired onstop — use whatever chunks arrived.
            safetyTimer = setTimeout(() => {
              safetyTimer = null
              finishOk()
            }, STOP_SAFETY_TIMEOUT_MS)
          } else {
            finishOk()
          }
        } catch (err) {
          finishErr(
            err instanceof Error ? err : new Error('Failed to stop recorder.'),
          )
        }
      }
      return stoppedPromise
    },
    cancel: () => {
      if (stopCalled && finished) return
      stopCalled = true
      if (!finished) {
        finished = true
        rejectStopped?.(new Error('Recording cancelled.'))
      }
      releaseAll()
    },
  }
}

/** @deprecated alias — use startMediaCapture */
export async function startPcmCapture(
  onLevel?: (level01: number) => void,
): Promise<MediaCaptureHandle> {
  return startMediaCapture(onLevel)
}

export type TranscribeResult = {
  status: number
  text: string
  error?: string
}

/** Blobs at or below this size are not uploaded (nothing was encoded). */
const MIN_UPLOAD_BYTES = 1000
/** Upper bound for one /api/transcribe round trip. */
const TRANSCRIBE_TIMEOUT_MS = 120_000

/**
 * POST an encoded audio blob (mp4/webm/wav/…) to host Whisper.
 * Returns HTTP status + server text. Throws `Server <status>: <error>` on failure.
 * No client-side silence gating — anything > 1000 bytes is uploaded.
 */
export async function transcribeAudioBlobDetailed(
  blob: Blob,
  opts?: { peak?: number; durationMs?: number },
): Promise<TranscribeResult> {
  const peak = opts?.peak
  const durationMs = opts?.durationMs

  if (blob.size <= MIN_UPLOAD_BYTES) {
    throw Object.assign(
      new Error(
        blob.size === 0
          ? 'No audio was captured (the recorder returned 0 bytes), so nothing was sent. The mic has been reset.'
          : `Recording too short (${blob.size} bytes), so nothing was sent. Speak for 2+ seconds before tapping stop. The mic has been reset.`,
      ),
      { status: 0 },
    )
  }

  const mime = (blob.type || 'application/octet-stream').split(';')[0].trim()

  let res: Response
  // Never leave the UI stuck in "Transcribing…" if the network stalls.
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null
  const abortTimer = abort
    ? setTimeout(() => abort.abort(), TRANSCRIBE_TIMEOUT_MS)
    : null
  try {
    // Raw body + Content-Type — reliable on iOS Safari (multipart also accepted server-side).
    res = await fetch('/api/transcribe', {
      method: 'POST',
      cache: 'no-store',
      signal: abort?.signal,
      headers: {
        'Content-Type': mime || 'application/octet-stream',
        ...(peak != null ? { 'X-Client-Meter-Peak': peak.toFixed(4) } : {}),
        ...(durationMs != null
          ? { 'X-Client-Duration-Ms': String(Math.round(durationMs)) }
          : {}),
      },
      body: blob,
    })
  } catch (err) {
    if (abortTimer) clearTimeout(abortTimer)
    const timedOut = abort?.signal.aborted
    throw Object.assign(
      new Error(
        timedOut
          ? `Transcription server did not answer within ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s.`
          : `Could not reach transcription server (${err instanceof Error ? err.message : 'network error'}).`,
      ),
      { status: 0 },
    )
  }

  let payload: { text?: string; error?: string } = {}
  let rawBody = ''
  try {
    rawBody = await res.text()
    payload = JSON.parse(rawBody) as { text?: string; error?: string }
  } catch {
    /* non-JSON body (or body read aborted by timeout) */
  } finally {
    if (abortTimer) clearTimeout(abortTimer)
  }

  if (!res.ok) {
    const serverErr =
      payload.error || rawBody.slice(0, 200) || res.statusText || 'unknown error'
    throw Object.assign(new Error(`Server ${res.status}: ${serverErr}`), {
      status: res.status,
    })
  }

  const text = (payload.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) {
    throw Object.assign(new Error(`Server ${res.status}: empty transcript`), {
      status: res.status,
    })
  }
  return { status: res.status, text }
}

/** Back-compat: returns just the text. */
export async function transcribeAudioBlob(
  blob: Blob,
  opts?: { peak?: number; durationMs?: number },
): Promise<string> {
  return (await transcribeAudioBlobDetailed(blob, opts)).text
}

/** @deprecated PCM path removed — transcribe the MediaRecorder blob instead. */
export async function transcribePcm(_audio16k: Float32Array): Promise<string> {
  void _audio16k
  throw new Error(
    'PCM upload removed — use MediaRecorder + transcribeAudioBlob.',
  )
}

export function isWhisperPipelineReady(): boolean {
  return true
}
export function preloadWhisperPipeline(): void {
  /* server-side model */
}
export async function loadWhisperPipeline(): Promise<null> {
  return null
}
