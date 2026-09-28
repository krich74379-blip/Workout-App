/**
 * Client-side gym transcript cleanup — same logic as the Whisper server path.
 * Shared canonical implementation: shared/gymTranscript.mjs
 */
import {
  correctGymTranscript as correct,
  isHallucination as hallu,
  normalizeDigitRuns as norm,
} from '../../shared/gymTranscript.mjs'

export const correctGymTranscript: (raw: string) => string = correct
export const isHallucination: (text: string) => boolean = hallu
export const normalizeDigitRuns: (text: string) => string = norm
