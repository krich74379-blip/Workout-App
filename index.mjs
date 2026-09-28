/**
 * Static + Whisper ASR server for Workout Log PWA.
 * Serves dist/ and POST /api/transcribe (WAV/webm/mp4/m4a → ffmpeg → Whisper).
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'
import { correctGymTranscript, isHallucination } from './gymTranscript.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 5173)
const HOST = process.env.HOST || '0.0.0.0'
const MODEL_ID = 'Xenova/whisper-medium.en'
// Upgrade from small.en: medium.en is stronger on gym vocab; box has ~15GiB RAM / 8 CPUs.
// base.en would be a downgrade vs small; keep gymTranscript cleanup.
const TARGET_SR = 16000
const MAX_BODY = 12 * 1024 * 1024 // 12 MB
const DEEPGRAM_API_KEY = (process.env.DEEPGRAM_API_KEY || '').trim()

/** Optional Deepgram nova — no-op when DEEPGRAM_API_KEY unset. */
async function transcribeDeepgram(wavBuf) {
  if (!DEEPGRAM_API_KEY) return null
  try {
    const url =
      'https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&punctuate=false'
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBuf,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[deepgram] HTTP ${res.status}: ${errText.slice(0, 200)}`)
      return null
    }
    const data = await res.json()
    const raw = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
    return text || null
  } catch (err) {
    console.warn('[deepgram] failed:', err?.message || err)
    return null
  }
}


/** Short gym vocab bias — long prompts make Whisper hallucinate on short clips. */
const WHISPER_INITIAL_PROMPT =
  'Gym set log: calf press ninety pounds fifteen reps three sets. bench press, squat, deadlift, leg curl, pounds, reps, sets.'

env.allowLocalModels = false
env.useBrowserCache = false
env.cacheDir = path.join(ROOT, '.cache', 'transformers')

let asrPromise = null
const ORT_THREADS = Math.max(1, Number(process.env.ASR_THREADS || 1))
const ASR_BEAMS = Math.max(1, Number(process.env.ASR_BEAMS || 1))
const ASR_RETRY = process.env.ASR_RETRY === '1' // off by default: not needed once decoding is deterministic
// Deterministic greedy/beam decoding. (temperature omitted: with do_sample=false
// it is unused; no temperature-fallback exists in transformers.js.)
const ASR_OPTS = {
  do_sample: false,
  num_beams: ASR_BEAMS,
  chunk_length_s: 30,
  return_timestamps: false,
}
console.log(`[asr] opts=${JSON.stringify(ASR_OPTS)} retry=${ASR_RETRY} threads=${ORT_THREADS}`)
let asrLoaded = false

function getAsr() {
  if (!asrPromise) {
    console.log(`[asr] Loading ${MODEL_ID}…`)
    const started = Date.now()
    asrPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'cpu',
      // Multi-threaded ORT CPU kernels made the quantized model produce different
      // text for byte-identical PCM (verified). One intra-op thread = deterministic.
      session_options: {
        intraOpNumThreads: ORT_THREADS,
        interOpNumThreads: 1,
        executionMode: 'sequential',
      },
    })
      .then((asr) => {
        asrLoaded = true
        console.log(`[asr] Ready in ${((Date.now() - started) / 1000).toFixed(1)}s`)
        return asr
      })
      .catch((err) => {
        asrPromise = null
        throw err
      })
  }
  return asrPromise
}

/** Prefetch model in background after listen. */
function warmAsr() {
  getAsr().catch((err) => {
    console.error('[asr] Warm-up failed:', err?.message || err)
  })
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
  }
  return map[ext] || 'application/octet-stream'
}


/** Security / capability headers for Safari PWA mic + install. */
function appHeaders(extra = {}) {
  return {
    'Permissions-Policy': 'microphone=(self)',
    'Feature-Policy': "microphone 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extra,
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, appHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  }))
  res.end(body)
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Parse a minimal PCM WAV (16-bit or 32-bit float, mono or stereo).
 * Returns Float32Array mono + sampleRate.
 */
function decodeWav(buf) {
  if (buf.length < 44) throw new Error('WAV too short')
  const riff = buf.toString('ascii', 0, 4)
  const wave = buf.toString('ascii', 8, 12)
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }

  let offset = 12
  let fmt = null
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(start)
      const numChannels = buf.readUInt16LE(start + 2)
      const sampleRate = buf.readUInt32LE(start + 4)
      const bitsPerSample = buf.readUInt16LE(start + 14)
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample }
    } else if (id === 'data') {
      dataOffset = start
      dataSize = size
      break
    }
    offset = start + size + (size % 2)
  }

  if (!fmt || dataOffset < 0) throw new Error('Invalid WAV (missing fmt/data)')

  const { audioFormat, numChannels, sampleRate, bitsPerSample } = fmt
  const frameBytes = (bitsPerSample / 8) * numChannels
  const frames = Math.floor(dataSize / frameBytes)
  const mono = new Float32Array(frames)

  if (audioFormat === 1 && bitsPerSample === 16) {
    for (let i = 0; i < frames; i++) {
      const o = dataOffset + i * frameBytes
      let sum = 0
      for (let c = 0; c < numChannels; c++) {
        sum += buf.readInt16LE(o + c * 2) / 32768
      }
      mono[i] = sum / numChannels
    }
  } else if ((audioFormat === 3 || audioFormat === 1) && bitsPerSample === 32) {
    // IEEE float (3) or treat 32-bit as float if format 3
    for (let i = 0; i < frames; i++) {
      const o = dataOffset + i * frameBytes
      let sum = 0
      for (let c = 0; c < numChannels; c++) {
        sum += buf.readFloatLE(o + c * 4)
      }
      mono[i] = sum / numChannels
    }
  } else {
    throw new Error(
      `Unsupported WAV format (format=${audioFormat}, bits=${bitsPerSample})`,
    )
  }

  return { samples: mono, sampleRate }
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = src - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

function measurePeak(samples) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  return peak
}

function normalizeIfQuiet(samples) {
  const peak = measurePeak(samples)
  if (peak < 0.0005) return { samples, peak, silent: true }
  if (peak < 0.25) {
    const scale = 0.9 / peak
    const out = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      out[i] = Math.max(-1, Math.min(1, samples[i] * scale))
    }
    return { samples: out, peak, silent: false }
  }
  return { samples, peak, silent: false }
}


/** List top-level ISO BMFF boxes (type@offset:size) for logging / sniffing. */
function topLevelBoxes(buf, max = 12) {
  const out = []
  let off = 0
  while (off + 8 <= buf.length && out.length < max) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (!/^[\x20-\x7e]{4}$/.test(type)) break
    let hdr = 8
    if (size === 1 && off + 16 <= buf.length) {
      size = Number(buf.readBigUInt64BE(off + 8))
      hdr = 16
    } else if (size === 0) {
      size = buf.length - off
    }
    out.push(`${type}@${off}:${size}`)
    if (size < hdr) break
    off += size
  }
  return out
}

/**
 * Sniff container from magic bytes.
 * Returns 'mp4' | 'mp4-fragment' | 'adts' | 'webm' | 'ogg' | 'wav' | null
 */
function sniffAudioKind(buf) {
  if (!buf || buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav'
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'webm'
  }
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  const box = buf.toString('latin1', 4, 8)
  if (box === 'ftyp') return 'mp4'
  if (box === 'moof' || box === 'styp' || box === 'mdat' || box === 'sidx' || box === 'moov' || box === 'free' || box === 'wide') {
    // moov-first without ftyp is still decodable as mp4; the rest are fragments without init
    return box === 'moov' || box === 'free' || box === 'wide' ? 'mp4' : 'mp4-fragment'
  }
  // ADTS AAC: 12-bit sync 0xFFF, layer bits 00
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'adts'
  return null
}

function extForKind(kind) {
  if (kind === 'wav') return 'wav'
  if (kind === 'webm') return 'webm'
  if (kind === 'mp4' || kind === 'mp4-fragment') return 'm4a'
  if (kind === 'adts') return 'aac'
  if (kind === 'ogg') return 'ogg'
  return 'bin'
}

/** Keep the last N raw uploads on disk for debugging. */
const UPLOAD_DIR = '/tmp/workout-uploads'
const UPLOAD_KEEP = 10
function saveUpload(buf, ext) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(UPLOAD_DIR, `${stamp}-${buf.length}.${ext}`)
    fs.writeFileSync(file, buf)
    const files = fs
      .readdirSync(UPLOAD_DIR)
      .map((f) => ({ f, t: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(UPLOAD_KEEP)) {
      try { fs.rmSync(path.join(UPLOAD_DIR, f)) } catch { /* ignore */ }
    }
    return file
  } catch (err) {
    console.warn('[upload] save failed:', err?.message || err)
    return null
  }
}

/**
 * Run ffmpeg on a file path with extra input args; resolve decoded 16k mono PCM.
 */
function runFfmpegDecode(inPath, outPath, inputArgs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      ...inputArgs,
      '-i', inPath,
      '-vn',
      '-ac', '1',
      '-ar', String(TARGET_SR),
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      outPath,
    ]
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
    child.on('close', (code) => {
      try {
        if (!fs.existsSync(outPath)) {
          reject(new Error(`code ${code}: ${stderr.trim().split('\n').slice(-2).join(' | ') || 'no output'}`))
          return
        }
        const decoded = decodeWav(fs.readFileSync(outPath))
        if (!decoded.samples.length) {
          reject(new Error(`code ${code}: 0 samples${stderr.trim() ? ` (${stderr.trim().split('\n').slice(-1)[0]})` : ''}`))
          return
        }
        resolve(decoded)
      } catch (err) {
        reject(new Error(`code ${code}: ${err?.message || err}; ${stderr.trim().slice(-200)}`))
      } finally {
        try { fs.rmSync(outPath, { force: true }) } catch { /* ignore */ }
      }
    })
  })
}

const DECODE_CHAIN = [
  { name: 'auto', args: [] },
  { name: 'mp4', args: ['-f', 'mp4'] },
  { name: 'mov', args: ['-f', 'mov'] },
  { name: 'tolerant', args: ['-fflags', '+genpts+discardcorrupt', '-probesize', '50M', '-analyzeduration', '50M'] },
  { name: 'aac', args: ['-f', 'aac'] },
]

/**
 * Decode any ffmpeg-supported audio to 16 kHz mono Float32 PCM via CLI,
 * trying a chain of demuxer options. Success = actually got samples.
 * Resolves { samples, sampleRate, decoder }.
 */
async function ffmpegToPcm16k(inputBuf, inputExt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-asr-'))
  const inPath = path.join(dir, `in.${inputExt || 'bin'}`)
  const outPath = path.join(dir, 'out.wav')
  const failures = []
  try {
    fs.writeFileSync(inPath, inputBuf)
    for (const step of DECODE_CHAIN) {
      try {
        const decoded = await runFfmpegDecode(inPath, outPath, step.args)
        return { ...decoded, decoder: step.name, failures }
      } catch (err) {
        failures.push(`${step.name}: ${err?.message || err}`)
      }
    }
    throw Object.assign(
      new Error(`ffmpeg could not decode audio (${failures.join(' || ')})`),
      { status: 415, failures },
    )
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/**
 * Parse multipart/form-data enough to pull the first file part named audio|file|blob.
 * Returns { buf, filename, contentType } or null.
 */
function extractMultipartAudio(buf, contentTypeHeader) {
  const ct = contentTypeHeader || ''
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct)
  if (!m) return null
  const boundary = (m[1] || m[2] || '').trim()
  if (!boundary) return null
  const sep = Buffer.from(`--${boundary}`)
  let start = buf.indexOf(sep)
  if (start < 0) return null
  start += sep.length
  // skip leading CRLF after first boundary
  if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2

  while (start < buf.length) {
    // End boundary?
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break
    const headerEnd = buf.indexOf('\r\n\r\n', start)
    if (headerEnd < 0) break
    const headerText = buf.toString('utf8', start, headerEnd)
    const bodyStart = headerEnd + 4
    const nextSep = buf.indexOf(sep, bodyStart)
    if (nextSep < 0) break
    // body ends at CRLF before boundary
    let bodyEnd = nextSep - 2
    if (bodyEnd < bodyStart) bodyEnd = nextSep
    const nameMatch = /name="([^"]+)"/i.exec(headerText)
    const fileMatch = /filename="([^"]*)"/i.exec(headerText)
    const partCt = /Content-Type:\s*([^\r\n]+)/i.exec(headerText)
    const fieldName = (nameMatch?.[1] || '').toLowerCase()
    const isFile =
      fileMatch ||
      fieldName === 'audio' ||
      fieldName === 'file' ||
      fieldName === 'blob' ||
      fieldName === 'recording'
    if (isFile) {
      return {
        buf: buf.subarray(bodyStart, bodyEnd),
        filename: fileMatch?.[1] || '',
        contentType: (partCt?.[1] || '').trim(),
      }
    }
    start = nextSep + sep.length
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2
  }
  return null
}

function kindFromMimeOrName(ct, filename) {
  const s = `${ct || ''} ${filename || ''}`.toLowerCase()
  if (s.includes('wav') || s.includes('wave')) return 'wav'
  if (s.includes('webm')) return 'webm'
  if (s.includes('mp4') || s.includes('m4a') || s.includes('aac') || s.includes('mpeg')) return 'mp4'
  if (s.includes('ogg') || s.includes('opus')) return 'ogg'
  return null
}

function isMeaningful(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return false
  if (isHallucination(cleaned)) return false
  // Reject tiny filler / blank ASR crumbs (tone → "the", silence tags, etc.)
  const alnum = cleaned.replace(/[^\p{L}\p{N}]+/gu, '')
  if (alnum.length < 4) return false
  // Prefer real gym content: a digit, or at least two words
  if (/\d/.test(cleaned)) return true
  const words = cleaned.split(/\s+/).filter(Boolean)
  return words.length >= 2 || alnum.length >= 6
}

async function handleTranscribe(req, res) {
  try {
    const body = await readBody(req)
    if (!body.length) {
      sendJson(res, 400, { error: 'Empty body — send audio (wav/webm/mp4/m4a).' })
      return
    }

    let samples
    let sampleRate
    const ctHeader = req.headers['content-type'] || ''
    const ct = ctHeader.toLowerCase()

    let audioBuf = body
    let partCt = ''
    let partName = ''

    if (ct.includes('multipart/form-data')) {
      const part = extractMultipartAudio(body, ctHeader)
      if (!part || !part.buf?.length) {
        sendJson(res, 400, { error: 'multipart body missing audio file field.' })
        return
      }
      audioBuf = part.buf
      partCt = part.contentType || ''
      partName = part.filename || ''
    }

    const sniffed = sniffAudioKind(audioBuf)
    const hinted = kindFromMimeOrName(partCt || ct, partName)

    if (
      sniffed === 'wav' ||
      hinted === 'wav' ||
      (!sniffed && !hinted && audioBuf.toString('ascii', 0, 4) === 'RIFF')
    ) {
      ;({ samples, sampleRate } = decodeWav(audioBuf))
    } else if (
      ct.includes('application/octet-stream') &&
      !sniffed &&
      !hinted &&
      audioBuf.length % 4 === 0 &&
      audioBuf.length >= TARGET_SR
    ) {
      // Legacy raw Float32 LE PCM @ 16 kHz
      samples = new Float32Array(
        audioBuf.buffer,
        audioBuf.byteOffset,
        audioBuf.length / 4,
      )
      sampleRate = TARGET_SR
    } else {
      // webm / mp4 / m4a / ogg / unknown → ffmpeg
      const kind = sniffed || hinted || 'bin'
      const ext = extForKind(kind)
      try {
        ;({ samples, sampleRate } = await ffmpegToPcm16k(audioBuf, ext))
      } catch (err) {
        console.error('[transcribe] ffmpeg decode failed:', err?.message || err)
        sendJson(res, err?.status || 415, {
          // One line for the user; full ffmpeg detail is in the server log above.
          error: `Couldn’t decode the recording (${kind}, ${audioBuf.length} bytes) — it may be incomplete. Please record again.`,
        })
        return
      }
    }

    let audio = resampleLinear(samples, sampleRate, TARGET_SR)
    const prepared = normalizeIfQuiet(audio)
    const clientPeakHdr = Number(req.headers['x-client-meter-peak'] || '')
    const clientDurHdr = Number(req.headers['x-client-duration-ms'] || '')
    const clientMeterHeard =
      Number.isFinite(clientPeakHdr) && clientPeakHdr >= 0.02

    if (prepared.silent) {
      // Honest: if the phone meter moved, this is decode/gain — not "mic silence"
      if (clientMeterHeard) {
        console.log(
          `[transcribe] decoded-near-silent but client meter peak=${clientPeakHdr} bytes=${audioBuf.length}`,
        )
        sendJson(res, 422, {
          error:
            'Audio uploaded but decoded nearly silent — speak closer for 3+ seconds (full set: equipment + numbers). Not a mic-permission issue.',
        })
        return
      }
      sendJson(res, 422, {
        error:
          'Mic recorded silence — check the level meter moves when you speak, then try again.',
      })
      return
    }
    audio = prepared.samples

    const durSec = audio.length / TARGET_SR
    if (audio.length < TARGET_SR * 0.25) {
      sendJson(res, 422, {
        error: 'Recording too short — hold the mic 3+ seconds and say the full set.',
      })
      return
    }
    // Short clips with speech often yield junk ("you") — nudge UX before ASR
    if (durSec < 1.2 && clientMeterHeard) {
      console.log(
        `[transcribe] short clip dur=${durSec.toFixed(2)}s clientPeak=${clientPeakHdr} — still attempting ASR`,
      )
    }

    const asr = await getAsr()
    // Only pass sampling_rate — language/task options can blank English model outputs.
    const pcm = Float32Array.from(audio)
    // NOTE: no `language` — whisper-medium.en is English-only; language/task
    // tokens are for multilingual checkpoints. No initial_prompt support in transformers.js.
    const result = await asr(pcm, ASR_OPTS)
    const toText = (r) =>
      typeof r === 'string' ? r : String(r?.text ?? '').replace(/\s+/g, ' ').trim()
    let rawText = toText(result)
    // Whisper (quantized ONNX, CPU) is non-deterministic here: identical audio
    // sometimes yields ""/"and"/"(I'm not sure what I said here)". A gym log
    // should contain a number, so retry up to 2x (silence-padded) when it doesn't.
    const needsRetry = (t) => isHallucination(t) || !/\d/.test(correctGymTranscript(t) || t)
    for (const padSec of ASR_RETRY ? [0.5, 0.25] : []) {
      if (!needsRetry(rawText)) break
      const pad = Math.round(TARGET_SR * padSec)
      const padded = new Float32Array(pcm.length + pad * 2)
      padded.set(pcm, pad)
      const retry = toText(await asr(padded, ASR_OPTS))
      console.log(`[transcribe] retry(pad=${padSec}s) raw="${rawText}" -> "${retry}"`)
      if (!needsRetry(retry) || (isHallucination(rawText) && !isHallucination(retry))) rawText = retry
    }
    if (isHallucination(rawText)) {
      console.log(
        `[transcribe] rejected hallucination raw="${rawText}" peak=${prepared.peak.toFixed(3)} dur=${(pcm.length / TARGET_SR).toFixed(2)}s`,
      )
      sendJson(res, 422, {
        error:
          'Couldn’t parse a clear set — speak equipment + weight + reps for 3+ seconds (not silence; try again closer).',
      })
      return
    }

    // Whisper sometimes renders "forty pounds" as "£40"
    rawText = rawText.replace(/£\s?(\d+(?:\.\d+)?)/g, '$1 lbs')
    const corrected = correctGymTranscript(rawText)

    // Optional Deepgram parallel (skipped when DEEPGRAM_API_KEY unset)
    let deepgramText = null
    if (DEEPGRAM_API_KEY && audioBuf.toString('ascii', 0, 4) === 'RIFF') {
      deepgramText = await transcribeDeepgram(audioBuf)
      if (deepgramText) deepgramText = correctGymTranscript(deepgramText) || deepgramText
    }

    console.log(
      `[transcribe] model=${MODEL_ID} raw="${rawText}" corrected="${corrected}" deepgram="${deepgramText || ''}" peak=${prepared.peak.toFixed(3)} clientPeak=${Number.isFinite(clientPeakHdr) ? clientPeakHdr.toFixed(3) : '-'} dur=${(pcm.length / TARGET_SR).toFixed(2)}s bytes=${audioBuf.length}`,
    )

    if (!corrected || !isMeaningful(corrected)) {
      // If Whisper blank but Deepgram heard something, still return Deepgram
      if (deepgramText && isMeaningful(deepgramText)) {
        sendJson(res, 200, {
          text: deepgramText,
          whisper: corrected || '',
          deepgram: deepgramText,
          model: MODEL_ID,
        })
        return
      }
      const shortHint =
        (pcm.length / TARGET_SR) < 2 ||
        (Number.isFinite(clientDurHdr) && clientDurHdr < 2000)
      sendJson(res, 422, {
        error: shortHint
          ? `Heard only a fragment (“${(rawText || '').slice(0, 40) || '…'}”) — speak the full set for 3+ seconds, then stop.`
          : 'Couldn’t parse a clear set — speak equipment + weight + reps closer to the mic (avoid background chatter).',
      })
      return
    }

    sendJson(res, 200, {
      text: corrected,
      whisper: corrected,
      deepgram: deepgramText,
      model: MODEL_ID,
    })
  } catch (err) {
    console.error('[transcribe]', err)
    const status = err?.status || 500
    sendJson(res, status, {
      error: err?.message || 'Transcription failed',
    })
  }
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0])
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = path.join(root, cleaned)
  if (!full.startsWith(root)) return null
  return full
}

function serveStatic(req, res, urlPath) {
  let filePath = safeJoin(DIST, urlPath === '/' ? '/index.html' : urlPath)
  if (!filePath) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not found — run npm run build first')
    return
  }

  const data = fs.readFileSync(filePath)
  const base = path.basename(filePath)
  const noCache =
    base.endsWith('.html') || base === 'sw.js' || base.startsWith('workbox-') ||
    base === 'registerSW.js' || base.endsWith('.webmanifest')
  const hashedAsset = filePath.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, appHeaders({
    'Content-Type': mimeFor(filePath),
    'Content-Length': data.length,
    'Cache-Control': noCache
      ? 'no-cache, no-store, must-revalidate'
      : hashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
  }))
  res.end(data)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, appHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }))
    res.end()
    return
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      asrReady: asrLoaded,
      asrLoading: asrPromise != null && !asrLoaded,
      model: MODEL_ID,
      deepgramConfigured: Boolean(DEEPGRAM_API_KEY),
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/transcribe') {
    await handleTranscribe(req, res)
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname)
    return
  }

  sendJson(res, 405, { error: 'Method not allowed' })
})

if (!fs.existsSync(DIST)) {
  console.error(`[serve] Missing ${DIST} — run: npm run build`)
  process.exit(1)
}

server.listen(PORT, HOST, () => {
  console.log(`[serve] http://${HOST}:${PORT}  (dist + /api/transcribe)`)
  warmAsr()
})
