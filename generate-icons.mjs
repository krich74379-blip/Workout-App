import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(out, { recursive: true })

function svgFor(size, { rounded = true, pad = 0.14 } = {}) {
  const r = rounded ? Math.round(size * 0.22) : 0
  const s = size * (1 - pad * 2)
  const ox = (size - s) / 2
  const oy = (size - s) / 2
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#0b0f14"/>
  <g transform="translate(${ox},${oy}) scale(${s / 100})">
    <circle cx="50" cy="50" r="36" fill="none" stroke="#3ddc97" stroke-opacity="0.18" stroke-width="3"/>
    <rect x="28" y="46" width="44" height="8" rx="4" fill="#e8edf2"/>
    <rect x="18" y="36" width="10" height="28" rx="3" fill="#3ddc97"/>
    <rect x="8" y="40" width="8" height="20" rx="2.5" fill="#22996a"/>
    <rect x="2" y="38" width="5" height="24" rx="2" fill="#3ddc97"/>
    <rect x="72" y="36" width="10" height="28" rx="3" fill="#3ddc97"/>
    <rect x="84" y="40" width="8" height="20" rx="2.5" fill="#22996a"/>
    <rect x="93" y="38" width="5" height="24" rx="2" fill="#3ddc97"/>
  </g>
</svg>`
}

async function writePng(name, size, opts) {
  const buf = await sharp(Buffer.from(svgFor(size, opts))).png().toBuffer()
  writeFileSync(join(out, name), buf)
  console.log('wrote', name)
}

await writePng('icon-192.png', 192, { rounded: true, pad: 0.12 })
await writePng('icon-512.png', 512, { rounded: true, pad: 0.12 })
await writePng('apple-touch-icon.png', 180, { rounded: true, pad: 0.12 })
await writePng('icon-maskable-512.png', 512, { rounded: false, pad: 0.22 })
await writePng('favicon-48.png', 48, { rounded: true, pad: 0.1 })
