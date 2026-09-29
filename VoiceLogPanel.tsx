import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import { correctGymTranscript } from '../lib/correctGymTranscript'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'
import { parseSetUtterance } from '../lib/parseSetUtterance'
import {
  isSecureContextOk,
  speakQuiet,
} from '../lib/speech'
import {
  getTranscribeKey,
  isMicPermissionGranted,
  isMicSupported,
  isMediaRecorderSupported,
  primeCaptureAudioContext,
  queryMicPermission,
  setTranscribeKey,
  startMediaCapture,
  transcribeAudioBlobDetailed,
} from '../lib/whisperAsr'
import type { WeightUnit, SetEntry } from '../types'
import { isCardioEquipmentName, entryKind } from '../utils'

type Props = {
  store: WorkoutStore
  onLogged?: () => void
  emphasize?: boolean
  /** Utterance from Siri / Shortcuts deep link (?log=…) */
  deepLinkUtterance?: string | null
  /** Auto-save strong parses from deep link (default true) */
  deepLinkAutolog?: boolean
  /** Called after deep-link utterance has been consumed */
  onDeepLinkConsumed?: () => void
}

/** Guided = pick equipment first, speak numbers only. Freeform = full utterance. */
type VoiceLogMode = 'guided' | 'freeform'

const VOICE_MODE_KEY = 'workout-log:voice-mode'
const GUIDED_EQUIP_KEY = 'workout-log:guided-equipment'


type ConfirmState = {
  equipmentName: string
  weight: string
  reps: string
  setCount: string
  miles: string
  flights: string
  /** Combined miles/flights field uses flights when true. */
  distanceAsFlights: boolean
  calories: string
  minutes: string
  /** When true, confirm UI shows cardio fields instead of weight×reps×sets. */
  cardio: boolean
  unit: WeightUnit
  transcript: string
  confidence: number
}

function parsedIsCardio(parsed: {
  kind?: string
  miles?: number
  flights?: number
  calories?: number
  minutes?: number
  equipmentName?: string
}): boolean {
  if (parsed.kind === 'cardio') return true
  if (
    (parsed.miles ?? 0) > 0 ||
    (parsed.flights ?? 0) > 0 ||
    (parsed.calories ?? 0) > 0 ||
    (parsed.minutes ?? 0) > 0
  ) {
    return true
  }
  return Boolean(parsed.equipmentName && isCardioEquipmentName(parsed.equipmentName))
}

function confirmFromParsed(
  parsed: {
    equipmentName: string
    weight: number
    reps: number
    setCount: number
    unit: WeightUnit
    miles?: number
    flights?: number
    calories?: number
    minutes?: number
    kind?: string
    confidence: number
  },
  transcript: string,
  preferredUnit: WeightUnit,
): ConfirmState {
  const cardio = parsedIsCardio(parsed)
  const asFlights = cardio && (parsed.flights ?? 0) > 0
  return {
    equipmentName: parsed.equipmentName,
    weight: !cardio && parsed.weight > 0 ? String(parsed.weight) : '',
    reps: !cardio && parsed.reps > 0 ? String(parsed.reps) : '',
    setCount: String(parsed.setCount >= 1 ? parsed.setCount : 1),
    miles: cardio && !asFlights && (parsed.miles ?? 0) > 0 ? String(parsed.miles) : '',
    flights: asFlights ? String(parsed.flights) : '',
    distanceAsFlights: asFlights,
    calories: cardio && (parsed.calories ?? 0) > 0 ? String(parsed.calories) : '',
    minutes: cardio && (parsed.minutes ?? 0) > 0 ? String(parsed.minutes) : '',
    cardio,
    unit: parsed.unit || preferredUnit,
    transcript,
    confidence: parsed.confidence,
  }
}

function emptyConfirm(transcript: string, unit: WeightUnit): ConfirmState {
  return {
    equipmentName: '',
    weight: '',
    reps: '',
    setCount: '1',
    miles: '',
    flights: '',
    distanceAsFlights: false,
    calories: '',
    minutes: '',
    cardio: false,
    unit,
    transcript,
    confidence: 0,
  }
}

/** "again", "same", "one more" → repeat the most recent set. */
function isRepeatUtterance(text: string): boolean {
  return /^(same|again|one more|another|repeat|same again|do it again|same as last( one| time)?|log (it |that )?again)[\s.!]*$/i.test(
    text.trim(),
  )
}

/** Prefill the confirm card from an existing set (for "repeat last set"). */
function confirmFromSetEntry(entry: SetEntry, transcript: string): ConfirmState {
  const cardio = entryKind(entry) === 'cardio'
  const asFlights = cardio && (entry.flights ?? 0) > 0
  return {
    equipmentName: entry.equipmentName,
    weight: !cardio && entry.weight > 0 ? String(entry.weight) : '',
    reps: !cardio && entry.reps > 0 ? String(entry.reps) : '',
    setCount: '1',
    miles:
      cardio && !asFlights && (entry.miles ?? 0) > 0 ? String(entry.miles) : '',
    flights: asFlights ? String(entry.flights) : '',
    distanceAsFlights: asFlights,
    calories:
      cardio && (entry.calories ?? 0) > 0 ? String(entry.calories) : '',
    minutes: cardio && (entry.minutes ?? 0) > 0 ? String(entry.minutes) : '',
    cardio,
    unit: entry.unit,
    transcript,
    confidence: 1,
  }
}

type MicPhase = 'idle' | 'listening' | 'transcribing'

type CaptureHandle = {
  stop: () => Promise<{
    blob: Blob
    mime: string
    size: number
    peak: number
    chunkCount: number
    durationMs: number
  }>
  cancel: () => void
  getPeakLevel: () => number
}

const AUTO_PARSE_MS = 800
/** Max gap between pointerdown and its own trailing click (iOS can delay it). */
const POINTER_CLICK_WINDOW_MS = 1000

export function VoiceLogPanel({
  store,
  onLogged,
  emphasize,
  deepLinkUtterance = null,
  deepLinkAutolog = false,
  onDeepLinkConsumed,
}: Props) {
  const [phase, setPhaseState] = useState<MicPhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [micGrantNote, setMicGrantNote] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  /** Last capture debug (blob size / mime / peak) for on-device reports. */
  const [micDebug, setMicDebug] = useState<string | null>(null)
  const [showType, setShowType] = useState(false)
  /** Optional shared secret when the transcription server requires one. */
  const [serverKey, setServerKey] = useState(() => getTranscribeKey())
  // Guided mode UI removed — always freeform (full utterance). Parser still
  // supports lockedEquipment if ever re-enabled; keep helpers for that.
  const [voiceMode, setVoiceMode] = useState<VoiceLogMode>('freeform')
  const [guidedEquipment, setGuidedEquipment] = useState<string>('')

  const captureRef = useRef<CaptureHandle | null>(null)
  /** True while getUserMedia / graph setup is in flight (blocks double-tap race). */
  const startingRef = useRef(false)
  /**
   * Suppress the trailing click of the SAME press that started recording on
   * pointerdown. Holds the pointerdown timestamp (0 = none). Time-bounded so a
   * lost click (pointercancel / scroll) can never swallow a later stop tap.
   */
  const startedByPointerRef = useRef(0)
  /** Mirrors `phase` synchronously (event handlers must not read stale state). */
  const phaseRef = useRef<MicPhase>('idle')
  /** Incremented per recording attempt; a stale async start is discarded. */
  const recordGenRef = useRef(0)
  const panelRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const autoParseTimer = useRef<number | null>(null)
  const levelRaf = useRef<number | null>(null)
  const levelTarget = useRef(0)

  const setPhase = useCallback((next: MicPhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const equipmentNames = useMemo(
    () => store.equipmentSorted.map((e) => e.name),
    [store.equipmentSorted],
  )

  const equipmentAliases = useMemo(() => {
    const lib = new Set(equipmentNames.map((n) => n.toLowerCase()))
    const map: Record<string, string> = {}
    for (const entry of EXERCISE_CATALOG) {
      if (!lib.has(entry.name.toLowerCase())) continue
      map[entry.name.toLowerCase()] = entry.name
      for (const a of entry.aliases ?? []) {
        const k = a.toLowerCase().trim()
        if (k && !map[k]) map[k] = entry.name
      }
    }
    return map
  }, [equipmentNames])

  const guidedKind: 'strength' | 'cardio' | undefined = guidedEquipment
    ? isCardioEquipmentName(guidedEquipment)
      ? 'cardio'
      : 'strength'
    : undefined



  const buildParseOpts = useCallback(() => {
    const base = {
      equipmentNames,
      equipmentAliases,
      preferredUnit: store.preferredUnit,
    }
    if (voiceMode === 'guided' && guidedEquipment.trim()) {
      return {
        ...base,
        lockedEquipment: guidedEquipment.trim(),
        lockedKind: guidedKind,
      }
    }
    return base
  }, [
    equipmentAliases,
    equipmentNames,
    guidedEquipment,
    guidedKind,
    store.preferredUnit,
    voiceMode,
  ])



  useEffect(() => {
    if (emphasize && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [emphasize])


  // One-shot: clear guided defaults from older builds so freeform is restored.
  useEffect(() => {
    try {
      localStorage.setItem(VOICE_MODE_KEY, 'freeform')
      localStorage.removeItem(GUIDED_EQUIP_KEY)
    } catch {
      /* ignore */
    }
    setVoiceMode('freeform')
    setGuidedEquipment('')
  }, [])

  // Permissions API + localStorage only — never probe getUserMedia on mount.
  useEffect(() => {
    void queryMicPermission().then((state) => {
      if (state === 'granted' || isMicPermissionGranted()) {
        setMicGrantNote(
          'Mic was allowed before. If Safari asks again: aA → Website Settings → Microphone → Allow. Keep using this same tunnel URL.',
        )
      }
    })
  }, [])

  // Smooth the level meter
  useEffect(() => {
    if (phase !== 'listening') {
      setLevel(0)
      levelTarget.current = 0
      if (levelRaf.current != null) {
        cancelAnimationFrame(levelRaf.current)
        levelRaf.current = null
      }
      return
    }
    let current = 0
    const tick = () => {
      current += (levelTarget.current - current) * 0.35
      setLevel(current)
      levelRaf.current = requestAnimationFrame(tick)
    }
    levelRaf.current = requestAnimationFrame(tick)
    return () => {
      if (levelRaf.current != null) cancelAnimationFrame(levelRaf.current)
      levelRaf.current = null
    }
  }, [phase])

  const clearAutoParse = useCallback(() => {
    if (autoParseTimer.current != null) {
      window.clearTimeout(autoParseTimer.current)
      autoParseTimer.current = null
    }
  }, [])

  const applyTranscript = useCallback(
    (text: string, engineNote?: string | null) => {
      const raw = text.trim()
      if (!raw) {
        setTranscript('')
        return
      }

      // Client safety net (typed entry / deep link / anything bypassing server cleanup)
      const cleaned = correctGymTranscript(raw) || raw
      const trimmed = cleaned.trim()
      setTranscript(trimmed)

      // "again" / "same" → prefill from the most recent set
      if (isRepeatUtterance(trimmed)) {
        const last = store.mostRecentSet
        if (last) {
          setConfirm(confirmFromSetEntry(last, trimmed))
          setError(null)
          setStatusNote(`Repeating last set: ${last.equipmentName}`)
          setShowType(true)
          return
        }
        // No history yet → fall through to normal parsing
      }

      const parsed = parseSetUtterance(trimmed, buildParseOpts())

      if (!parsed) {
        const empty = emptyConfirm(trimmed, store.preferredUnit)
        if (voiceMode === 'guided' && guidedEquipment.trim()) {
          empty.equipmentName = guidedEquipment.trim()
          empty.cardio = guidedKind === 'cardio'
        }
        setConfirm(empty)
        setError(`Heard: "${trimmed}" — edit the fields and save.`)
        setStatusNote(engineNote ?? null)
        setShowType(true)
        return
      }

      const cardio = parsedIsCardio(parsed)
      const weak = cardio
        ? !parsed.equipmentName ||
          (!(parsed.miles ?? 0) && !(parsed.flights ?? 0) && !(parsed.calories ?? 0) && !(parsed.minutes ?? 0)) ||
          parsed.confidence < 0.55
        : !parsed.equipmentName ||
          !(parsed.weight > 0) ||
          !(parsed.reps > 0) ||
          parsed.confidence < 0.55

      const next = confirmFromParsed(parsed, trimmed, store.preferredUnit)

      if (weak) {
        setError(`Heard: "${trimmed}" — edit the fields and save.`)
        setStatusNote(engineNote ?? null)
        setShowType(true)
        setConfirm(next)
        return
      }

      const quick =
        store.quickVoiceLog &&
        parsed.confidence >= 0.8 &&
        parsed.matchedLibrary &&
        (cardio
          ? (parsed.miles ?? 0) > 0 ||
            (parsed.flights ?? 0) > 0 ||
            (parsed.calories ?? 0) > 0 ||
            (parsed.minutes ?? 0) > 0
          : parsed.weight > 0 && parsed.reps > 0)

      if (quick) {
        try {
          store.logSet(
            cardio
              ? {
                  equipmentName: parsed.equipmentName,
                  kind: 'cardio',
                  miles: parsed.miles,
                  flights: parsed.flights,
                  calories: parsed.calories,
                  minutes: parsed.minutes,
                  unit: parsed.unit,
                  notes: `Voice: ${trimmed}`,
                }
              : {
                  equipmentName: parsed.equipmentName,
                  weight: parsed.weight,
                  unit: parsed.unit,
                  reps: parsed.reps,
                  setCount: parsed.setCount,
                  notes: `Voice: ${trimmed}`,
                },
          )
          setFlash('Logged')
          speakQuiet('Logged')
          window.setTimeout(() => setFlash(null), 1200)
          setConfirm(null)
          onLogged?.()
        } catch (err) {
          setConfirm(next)
          setError(err instanceof Error ? err.message : 'Could not log set')
        }
        return
      }

      // Success path: still show Heard so cleaned equipment is obvious
      setError(null)
      const detail = cardio
        ? [
            parsed.equipmentName,
            parsed.flights != null && parsed.flights > 0
              ? `${parsed.flights} flights`
              : parsed.miles != null && parsed.miles > 0
                ? `${parsed.miles} mi`
                : null,
            parsed.calories != null && parsed.calories > 0
              ? `${parsed.calories} cal`
              : null,
            parsed.minutes != null && parsed.minutes > 0
              ? `${parsed.minutes} min`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : parsed.equipmentName
      const heard = `Heard: "${trimmed}" → ${detail}`
      setStatusNote(engineNote ? `${engineNote} · ${heard}` : heard)
      setConfirm(next)
    },
    [buildParseOpts, guidedEquipment, guidedKind, onLogged, store, voiceMode],
  )


  const applyDeepLink = useCallback(
    (text: string, autolog: boolean) => {
      const trimmed = text.trim()
      if (!trimmed) {
        onDeepLinkConsumed?.()
        return
      }
      setError(null)
      setFlash(null)
      const cleaned = correctGymTranscript(trimmed) || trimmed
      const heard = cleaned.trim()
      setTranscript(heard)
      setShowType(true)

      // "again" via Siri → repeat the most recent set
      if (isRepeatUtterance(heard)) {
        const last = store.mostRecentSet
        if (last) {
          const cardio = entryKind(last) === 'cardio'
          if (autolog) {
            try {
              store.logSet(
                cardio
                  ? {
                      equipmentName: last.equipmentName,
                      kind: 'cardio',
                      miles: last.miles,
                      flights: last.flights,
                      calories: last.calories,
                      minutes: last.minutes,
                      unit: last.unit,
                      notes: `Siri: ${heard}`,
                    }
                  : {
                      equipmentName: last.equipmentName,
                      weight: last.weight,
                      unit: last.unit,
                      reps: last.reps,
                      setCount: 1,
                      notes: `Siri: ${heard}`,
                    },
              )
              setConfirm(null)
              setFlash('Logged via Siri')
              speakQuiet('Logged')
              window.setTimeout(() => setFlash(null), 1800)
              onLogged?.()
            } catch (err) {
              setConfirm(confirmFromSetEntry(last, heard))
              setError(err instanceof Error ? err.message : 'Could not log set')
            }
          } else {
            setConfirm(confirmFromSetEntry(last, heard))
            setStatusNote(`Repeating last set: ${last.equipmentName}`)
          }
          onDeepLinkConsumed?.()
          return
        }
        // No history yet → fall through to normal parsing
      }

      const parsed = parseSetUtterance(heard, {
        equipmentNames,
        equipmentAliases,
        preferredUnit: store.preferredUnit,
      })

      const cardio = parsed ? parsedIsCardio(parsed) : false
      const strong =
        parsed &&
        parsed.equipmentName &&
        parsed.confidence >= 0.55 &&
        (cardio
          ? (parsed.miles ?? 0) > 0 ||
            (parsed.flights ?? 0) > 0 ||
            (parsed.calories ?? 0) > 0 ||
            (parsed.minutes ?? 0) > 0
          : parsed.weight > 0 && parsed.reps > 0)

      if (autolog && strong && parsed) {
        try {
          store.logSet(
            cardio
              ? {
                  equipmentName: parsed.equipmentName,
                  kind: 'cardio',
                  miles: parsed.miles,
                  flights: parsed.flights,
                  calories: parsed.calories,
                  minutes: parsed.minutes,
                  unit: parsed.unit,
                  notes: `Siri: ${heard}`,
                }
              : {
                  equipmentName: parsed.equipmentName,
                  weight: parsed.weight,
                  unit: parsed.unit,
                  reps: parsed.reps,
                  setCount: parsed.setCount,
                  notes: `Siri: ${heard}`,
                },
          )
          setConfirm(null)
          setFlash('Logged via Siri')
          speakQuiet('Logged')
          window.setTimeout(() => setFlash(null), 1800)
          onLogged?.()
        } catch (err) {
          setConfirm(confirmFromParsed(parsed, heard, store.preferredUnit))
          setError(err instanceof Error ? err.message : 'Could not log set')
        }
        onDeepLinkConsumed?.()
        return
      }

      // Weak / no autolog → confirm card for editing
      if (!parsed) {
        setConfirm(emptyConfirm(heard, store.preferredUnit))
        setError(`Heard: "${heard}" — edit the fields and save.`)
      } else {
        setConfirm(confirmFromParsed(parsed, heard, store.preferredUnit))
        if (strong) {
          setError(null)
          const detail = cardio
            ? [
                parsed.equipmentName,
                parsed.flights
                  ? `${parsed.flights} flights`
                  : parsed.miles
                    ? `${parsed.miles} mi`
                    : null,
                parsed.calories ? `${parsed.calories} cal` : null,
                parsed.minutes ? `${parsed.minutes} min` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : parsed.equipmentName
          setStatusNote(`Heard: "${heard}" → ${detail}`)
        } else {
          setError(`Heard: "${heard}" — edit the fields and save.`)
        }
      }
      onDeepLinkConsumed?.()
    },
    [equipmentAliases, equipmentNames, onDeepLinkConsumed, onLogged, store],
  )

  useEffect(() => {
    if (!deepLinkUtterance) return
    applyDeepLink(deepLinkUtterance, deepLinkAutolog)
  }, [deepLinkUtterance, deepLinkAutolog, applyDeepLink])

  const scheduleAutoParse = useCallback(
    (value: string) => {
      clearAutoParse()
      if (!value.trim()) return
      autoParseTimer.current = window.setTimeout(() => {
        applyTranscript(value)
      }, AUTO_PARSE_MS)
    },
    [applyTranscript, clearAutoParse],
  )

  useEffect(() => () => clearAutoParse(), [clearAutoParse])

  const startRecording = useCallback(async () => {
    if (startingRef.current || captureRef.current) return
    if (phaseRef.current === 'transcribing') return
    const gen = ++recordGenRef.current
    // Sync: claim the user-gesture for AudioContext before any await.
    try {
      primeCaptureAudioContext()
    } catch {
      /* isMicSupported check below */
    }
    startingRef.current = true
    setError(null)
    setFlash(null)
    setConfirm(null)
    setStatusNote(null)
    setMicDebug(null)
    levelTarget.current = 0

    if (!isSecureContextOk()) {
      startingRef.current = false
      startedByPointerRef.current = 0
      setError('Microphone needs HTTPS (or localhost).')
      return
    }
    if (!isMediaRecorderSupported() || !isMicSupported()) {
      startingRef.current = false
      startedByPointerRef.current = 0
      setError(
        'MediaRecorder audio capture is not supported in this browser. On iPhone use Safari 14.3+ (or update iOS), then hard-refresh.',
      )
      return
    }

    try {
      const alreadyGranted = isMicPermissionGranted()
      // Show Listening immediately so meter UI mounts; levels from AnalyserNode.
      setPhase('listening')
      const capture = await startMediaCapture((lvl) => {
        levelTarget.current = lvl
      })
      if (gen !== recordGenRef.current || !startingRef.current) {
        // Cancelled (stop tapped / unmounted / superseded) while awaiting
        // getUserMedia — release this recording's mic + meter immediately.
        capture.cancel()
        if (gen === recordGenRef.current) setPhase('idle')
        return
      }
      captureRef.current = capture

      if (!alreadyGranted && isMicPermissionGranted()) {
        setMicGrantNote(
          'Mic allowed for this site. If Safari still asks next time: tap aA → Website Settings → Microphone → Allow. Always use the same tunnel URL (a new URL is a new origin and resets permission).',
        )
      }

      setStatusNote(null)
    } catch (err) {
      if (gen !== recordGenRef.current) return
      captureRef.current?.cancel()
      captureRef.current = null
      setPhase('idle')
      startedByPointerRef.current = 0
      const message =
        err instanceof Error ? err.message : 'Could not start microphone'
      setError(message)
      setShowType(true)
    } finally {
      if (gen === recordGenRef.current) startingRef.current = false
    }
  }, [setPhase])

  const stopRecording = useCallback(async () => {
    const capture = captureRef.current
    captureRef.current = null
    if (!capture) {
      // Stop tapped while getUserMedia was still pending: invalidate that
      // start so it releases its stream as soon as it resolves.
      recordGenRef.current++
      startingRef.current = false
      setPhase('idle')
      return
    }

    try {
      setPhase('transcribing')
      setStatusNote(null)
      levelTarget.current = 0

      const result = await capture.stop()
      const base = `blob=${result.size}B mime=${result.mime || '?'} peak=${result.peak.toFixed(3)} chunks=${result.chunkCount} ${result.durationMs}ms`
      setMicDebug(`${base} server=…`)

      let whisperText = ''
      try {
        const r = await transcribeAudioBlobDetailed(result.blob, {
          peak: result.peak,
          durationMs: result.durationMs,
        })
        whisperText = r.text
        setMicDebug(`${base} server=${r.status} text="${r.text}"`)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not transcribe audio'
        const status = (err as { status?: number })?.status
        setMicDebug(`${base} server=${status ?? '?'} text=""`)
        setPhase('idle')
        setError(`${message} Tap the mic to try again, or type below.`)
        setShowType(true)
        return
      }
      setPhase('idle')

      applyTranscript(whisperText, 'Used Whisper')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not transcribe audio'
      const peak = capture.getPeakLevel()
      const dbg = `meterPeak=${peak.toFixed(3)}`
      setMicDebug(dbg)
      setStatusNote(null)
      setPhase('idle')
      setError(`${message} (${dbg}) Tap the mic to try again.`)
      setShowType(true)
    } finally {
      // Belt and braces: whatever happened above, this recording's mic tracks
      // and meter are released (no-op if already released by onstop).
      capture.cancel()
      if (phaseRef.current === 'transcribing') setPhase('idle')
    }
  }, [applyTranscript, setPhase])

  useEffect(() => {
    return () => {
      recordGenRef.current++
      startingRef.current = false
      captureRef.current?.cancel()
      captureRef.current = null
    }
  }, [])

  function toggleMic() {
    // The click that trails the pointerdown which just STARTED recording must
    // not stop it. (Before this fix the pointerdown re-rendered phase to
    // 'listening', so the trailing click immediately stopped/cancelled the
    // brand-new recording before any audio was captured.)
    const pointerStartedAt = startedByPointerRef.current
    startedByPointerRef.current = 0
    if (pointerStartedAt && Date.now() - pointerStartedAt < POINTER_CLICK_WINDOW_MS) {
      return
    }
    const current = phaseRef.current
    if (current === 'listening') {
      void stopRecording()
      return
    }
    if (current === 'transcribing' || startingRef.current) return
    void startRecording()
  }

  /** Start on pointerdown so getUserMedia keeps the user gesture on iOS. */
  function onMicPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const current = phaseRef.current
    if (current === 'listening' || current === 'transcribing' || startingRef.current) return
    startedByPointerRef.current = Date.now()
    e.preventDefault()
    // Sync prime in the gesture turn (before startRecording's first await).
    try {
      primeCaptureAudioContext()
    } catch {
      /* startRecording will surface support errors */
    }
    void startRecording()
  }

  function onTranscriptChange(value: string) {
    setTranscript(value)
    setError(null)
    scheduleAutoParse(value)
  }

  function saveConfirm() {
    if (!confirm) return
    if (!confirm.equipmentName.trim()) {
      setError('Add an equipment name, then save.')
      return
    }
    const cardio =
      confirm.cardio || isCardioEquipmentName(confirm.equipmentName)
    try {
      if (cardio) {
        const miles =
          !confirm.distanceAsFlights && confirm.miles !== ''
            ? Number(confirm.miles)
            : undefined
        const flights =
          confirm.distanceAsFlights && confirm.flights !== ''
            ? Math.round(Number(confirm.flights))
            : undefined
        const calories =
          confirm.calories === '' ? undefined : Number(confirm.calories)
        const minutes =
          confirm.minutes === '' ? undefined : Number(confirm.minutes)
        if (
          !(typeof miles === 'number' && miles > 0) &&
          !(typeof flights === 'number' && flights > 0) &&
          !(typeof calories === 'number' && calories > 0) &&
          !(typeof minutes === 'number' && minutes > 0)
        ) {
          setError('Add miles/flights, calories, or minutes, then save.')
          return
        }
        store.logSet({
          equipmentName: confirm.equipmentName,
          kind: 'cardio',
          miles,
          flights,
          calories:
            calories !== undefined && Number.isFinite(calories)
              ? Math.round(calories)
              : undefined,
          minutes,
          unit: confirm.unit,
          notes: confirm.transcript ? `Voice: ${confirm.transcript}` : undefined,
        })
      } else {
        if (!(Number(confirm.weight) >= 0) || confirm.weight === '') {
          setError('Enter a weight, then save.')
          return
        }
        if (!(Number(confirm.reps) > 0) || !Number.isInteger(Number(confirm.reps))) {
          setError('Enter reps (a whole number), then save.')
          return
        }
        if (
          !(Number(confirm.setCount) >= 1) ||
          !Number.isInteger(Number(confirm.setCount)) ||
          Number(confirm.setCount) > 30
        ) {
          setError('Enter sets (1–30), then save.')
          return
        }
        store.logSet({
          equipmentName: confirm.equipmentName,
          weight: Number(confirm.weight),
          unit: confirm.unit,
          reps: Number(confirm.reps),
          setCount: Number(confirm.setCount),
          notes: confirm.transcript ? `Voice: ${confirm.transcript}` : undefined,
        })
        store.setPreferredUnit(confirm.unit)
      }
      setConfirm(null)
      setTranscript('')
      setFlash('Logged')
      speakQuiet('Logged')
      window.setTimeout(() => setFlash(null), 1200)
      onLogged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const busy = phase === 'transcribing'
  const listening = phase === 'listening'
  const meterWidth = `${Math.round(Math.min(1, level) * 100)}%`

  return (
    <section
      ref={panelRef}
      className={
        emphasize ? 'voice-panel card voice-emphasize' : 'voice-panel card'
      }
      aria-label="Voice log"
      id="voice-log"
    >
      <div className="voice-header">
        <div>
          <h2>Voice log</h2>
          <p className="muted">
            Tap the mic and say the full set, e.g. “calf press 90 for 15 for 3
            sets”. Say “again” to repeat your last set. Speak 3+ seconds, then
            tap stop.
          </p>
        </div>
        <label className="voice-quick">
          <input
            type="checkbox"
            checked={store.quickVoiceLog}
            onChange={(e) => store.setQuickVoiceLog(e.target.checked)}
          />
          <span>Quick voice log</span>
        </label>
      </div>

      <p className="muted voice-mode-indicator">
        Say the full set (equipment + numbers), then tap mic again to stop.
      </p>

      <div className="voice-mic-wrap">
        <button
          type="button"
          className={listening ? 'voice-mic listening' : 'voice-mic'}
          onClick={toggleMic}
          onPointerDown={onMicPointerDown}
          disabled={busy}
          aria-pressed={listening}
          aria-label={listening ? 'Stop recording' : 'Start recording'}
        >
          <span className="voice-mic-ring" aria-hidden />
          <span className="voice-mic-icon" aria-hidden>
            {listening ? '■' : busy ? '…' : '🎤'}
          </span>
        </button>
        <p className="voice-status" aria-live="polite">
          {phase === 'transcribing'
            ? 'Transcribing…'
            : listening
              ? 'Listening…'
              : flash
                ? flash
                : 'Tap mic to record'}
        </p>
        {listening ? (
          <div
            className="voice-level"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            <div className="voice-level-fill" style={{ width: meterWidth }} />
          </div>
        ) : null}
        {micDebug ? (
          <p className="muted voice-mic-debug" role="status">
            Mic debug: {micDebug}
          </p>
        ) : null}
        <details className="muted voice-server-key">
          <summary>Server key</summary>
          <label className="field">
            <span>Transcription key (only if your server sets one)</span>
            <input
              type="password"
              className="input"
              value={serverKey}
              autoComplete="off"
              onChange={(e) => {
                const v = e.target.value
                setServerKey(v)
                setTranscribeKey(v.trim())
              }}
              placeholder="Leave empty unless configured"
            />
          </label>
        </details>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {!error && statusNote && confirm ? (
        <p className="muted voice-heard">{statusNote}</p>
      ) : null}
      {micGrantNote ? (
        <p className="muted voice-mic-grant-note" role="status">
          {micGrantNote}{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMicGrantNote(null)}
          >
            Got it
          </button>
        </p>
      ) : null}

      <div className="voice-type-toggle">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setShowType((v) => {
              const next = !v
              if (next) {
                window.setTimeout(() => textareaRef.current?.focus(), 50)
              }
              return next
            })
          }}
          aria-expanded={showType}
        >
          {showType ? 'Hide typing' : 'Type instead'}
        </button>
      </div>

      {showType ? (
        <div className="voice-type-panel">
          <label className="field">
            <span>Transcript</span>
            <textarea
              ref={textareaRef}
              className="input voice-transcript"
              rows={3}
              value={transcript}
              onChange={(e) => onTranscriptChange(e.target.value)}
              placeholder="bench press one eighty five for eight"
              enterKeyHint="done"
            />
          </label>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                clearAutoParse()
                applyTranscript(transcript)
              }}
              disabled={!transcript.trim()}
            >
              Parse
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                clearAutoParse()
                setTranscript('')
                setConfirm(null)
                setError(null)
                setStatusNote(null)
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : transcript && !confirm ? (
        <p className="muted voice-last-transcript">Last: “{transcript}”</p>
      ) : null}

      {confirm ? (
        <div className="voice-confirm">
          <h3>{confirm.cardio || isCardioEquipmentName(confirm.equipmentName) ? 'Confirm cardio' : 'Confirm set'}</h3>
          <p className="muted voice-raw">Heard: “{confirm.transcript}”</p>
          <div className="form">
            <label className="field">
              <span>Equipment</span>
              <input
                className="input"
                value={confirm.equipmentName}
                onChange={(e) => {
                  const name = e.target.value
                  setConfirm({
                    ...confirm,
                    equipmentName: name,
                    cardio:
                      confirm.cardio || isCardioEquipmentName(name),
                  })
                }}
              />
            </label>
            {confirm.cardio || isCardioEquipmentName(confirm.equipmentName) ? (
              <div className="row-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <label className="field">
                  <span>miles / flights</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={
                      confirm.distanceAsFlights ? confirm.flights : confirm.miles
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      if (confirm.distanceAsFlights) {
                        setConfirm({
                          ...confirm,
                          flights: v,
                          miles: '',
                          cardio: true,
                        })
                      } else {
                        setConfirm({
                          ...confirm,
                          miles: v,
                          flights: '',
                          cardio: true,
                        })
                      }
                    }}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Calories</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={confirm.calories}
                    onChange={(e) =>
                      setConfirm({ ...confirm, calories: e.target.value, cardio: true })
                    }
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Minutes</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={confirm.minutes}
                    onChange={(e) =>
                      setConfirm({ ...confirm, minutes: e.target.value, cardio: true })
                    }
                    placeholder="0"
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="row-2">
                  <label className="field">
                    <span>Weight</span>
                    <div className="input-with-toggle">
                      <input
                        className="input"
                        inputMode="decimal"
                        value={confirm.weight}
                        onChange={(e) =>
                          setConfirm({ ...confirm, weight: e.target.value })
                        }
                      />
                      <div className="unit-toggle" role="group" aria-label="Unit">
                        <button
                          type="button"
                          className={confirm.unit === 'lb' ? 'active' : ''}
                          onClick={() => setConfirm({ ...confirm, unit: 'lb' })}
                        >
                          lb
                        </button>
                        <button
                          type="button"
                          className={confirm.unit === 'kg' ? 'active' : ''}
                          onClick={() => setConfirm({ ...confirm, unit: 'kg' })}
                        >
                          kg
                        </button>
                      </div>
                    </div>
                  </label>
                  <label className="field">
                    <span>Reps</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={confirm.reps}
                      onChange={(e) =>
                        setConfirm({ ...confirm, reps: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Sets</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={confirm.setCount}
                    onChange={(e) =>
                      setConfirm({ ...confirm, setCount: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirm(null)
                  setStatusNote(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveConfirm}
              >
                {confirm.cardio || isCardioEquipmentName(confirm.equipmentName)
                  ? 'Save cardio'
                  : 'Save set'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
