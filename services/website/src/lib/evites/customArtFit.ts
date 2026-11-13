/**
 * Fit a host's own finished invitation to the 1085x1530 canvas WITHOUT cropping it (migration 073).
 * Pure on buffers: the same fit `scripts/evite-custom-art.mjs` does, for the admin upload route.
 *
 *   sniffImageType(buf)   'jpeg' | 'png' | 'webp' by MAGIC BYTES, else null (a file name or a declared type is never trusted)
 *   fitCustomArt(buf)     the whole picture centred over a blurred, enlarged copy of itself, as a JPEG buffer
 *   CUSTOM_ART_MAX_BYTES  10 MB
 *
 * A host's invitation has text to the edges; cropping would cut it, so it is contain-fitted and the
 * strips either side are filled with a blurred copy.
 */

import sharp from 'sharp'

export const CUSTOM_ART_W = 1085
export const CUSTOM_ART_H = 1530
export const CUSTOM_ART_MAX_BYTES = 10 * 1024 * 1024

export type ArtImageType = 'jpeg' | 'png' | 'webp'

export function sniffImageType(buf: Uint8Array): ArtImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'png'
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return 'webp'
  }
  return null
}

/** The whole picture, never cropped: contain-fit over a blurred cover-fit of itself. Throws if sharp cannot read it. */
export async function fitCustomArt(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) throw new Error('unreadable image')
  const scale = Math.min(CUSTOM_ART_W / meta.width, CUSTOM_ART_H / meta.height)
  const fw = Math.max(1, Math.round(meta.width * scale))
  const fh = Math.max(1, Math.round(meta.height * scale))
  const fg = await sharp(input).resize(fw, fh, { kernel: 'lanczos3' }).toBuffer()
  const bg = await sharp(input).resize(CUSTOM_ART_W, CUSTOM_ART_H, { fit: 'cover' }).blur(18).modulate({ brightness: 1.04 }).toBuffer()
  return sharp(bg)
    .composite([{ input: fg, left: Math.round((CUSTOM_ART_W - fw) / 2), top: Math.round((CUSTOM_ART_H - fh) / 2) }])
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}
