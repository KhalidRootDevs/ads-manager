/**
 * Placeholder files for the demo creatives' assets, so local previews load real images.
 * They live under one fixed upload id in the local storage driver: `<UPLOAD_DIR>/<DEMO_UPLOAD_ID>/<file>`,
 * served by the API at `${CDN_BASE_URL}/<DEMO_UPLOAD_ID>/<file>`.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"

export const DEMO_UPLOAD_ID = "upl_00000000000000000000000000"

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Solid-colour PNG with a subtle diagonal gradient (RGB, 8-bit). */
export function placeholderPng(width: number, height: number, hex: string): Buffer {
  const w = Math.max(1, Math.min(2000, Math.round(width)))
  const h = Math.max(1, Math.min(2000, Math.round(height)))
  const r0 = parseInt(hex.slice(1, 3), 16), g0 = parseInt(hex.slice(3, 5), 16), b0 = parseInt(hex.slice(5, 7), 16)
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1)
    raw[o] = 0
    for (let x = 0; x < w; x++) {
      const t = 0.82 + 0.18 * ((x / w + y / h) / 2)
      raw[o + 1 + x * 3] = Math.min(255, r0 * t)
      raw[o + 2 + x * 3] = Math.min(255, g0 * t)
      raw[o + 3 + x * 3] = Math.min(255, b0 * t)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

export interface AssetLike {
  kind: string
  name: string
  mime: string
  width: number | null
  height: number | null
}

/** Write PNG placeholders for every image/icon asset (videos are skipped). Returns the number of files written. */
export function writeDemoAssets(uploadDir: string, creatives: { assets: AssetLike[]; options: { brandColor: string } }[]): number {
  const dir = join(uploadDir, DEMO_UPLOAD_ID)
  mkdirSync(dir, { recursive: true })
  let n = 0
  for (const c of creatives) {
    for (const a of c.assets) {
      if (a.mime !== "image/png" && a.mime !== "image/jpeg" && a.mime !== "image/gif" && a.mime !== "image/webp") continue
      const scale = Math.min(1, 1200 / Math.max(a.width ?? 320, a.height ?? 320))
      writeFileSync(join(dir, a.name), placeholderPng((a.width ?? 320) * scale, (a.height ?? 320) * scale, c.options.brandColor))
      n++
    }
  }
  return n
}
