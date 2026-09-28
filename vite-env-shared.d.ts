declare module '*gymTranscript.mjs' {
  export function correctGymTranscript(raw: string): string
  export function isHallucination(text: string): boolean
  export function normalizeDigitRuns(text: string): string
}
