/**
 * Turning a picture somebody gave us into the picture we publish.
 *
 * ONE function, used by every importer (Instagram download, phone-album upload):
 * apply the EXIF orientation, shrink to at most 1200px, encode WebP, and keep
 * NO metadata. sharp drops EXIF/XMP/ICC unless asked to keep them, and
 * `webpChunks` exists so a test (and an importer) can prove the output carries
 * no `EXIF`, `XMP ` or `ICCP` chunk. Album photos were taken at clients' homes;
 * their GPS must never reach the public bucket.
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_EDGE_PX = 1200

export interface ConvertedImage { bytes: Uint8Array; w: number; h: number }

/** Never throws for a bad image; returns null. */
export async function convertImageBuffer(buf: Buffer): Promise<ConvertedImage | null> {
  try {
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null
    const sharp = (await import('sharp')).default
    // rotate() applies EXIF orientation; sharp drops all metadata (incl. GPS) unless asked to keep it.
    const out = await sharp(buf).rotate().resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
    const bytes = new Uint8Array(out.data)
    // Belt and braces: refuse our own output if it somehow carries metadata.
    if (webpChunks(bytes).some(c => METADATA_CHUNKS.includes(c))) return null
    return { bytes, w: out.info.width, h: out.info.height }
  } catch {
    return null
  }
}

export const METADATA_CHUNKS = ['EXIF', 'XMP ', 'ICCP']

/** The FourCC of every RIFF chunk in a WebP file. Empty for anything that is not a WebP. */
export function webpChunks(b: Uint8Array): string[] {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (b.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return []
  const out: string[] = []
  let o = 12
  while (o + 8 <= b.length) {
    out.push(tag(o))
    const size = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] * 2 ** 24)
    o += 8 + size + (size % 2)
  }
  return out
}
