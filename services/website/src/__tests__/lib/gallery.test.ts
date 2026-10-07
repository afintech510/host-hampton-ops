/**
 * The gallery manifest against the files on disk.
 *
 * - every listed photo exists, at the pixel size the manifest claims (the
 *   masonry grid reserves space from w/h, so a wrong size is a layout jump);
 * - no photo is listed twice, and every homepage pick is in the manifest;
 * - NO WebP under /images/gallery carries an EXIF chunk. iPhone originals hold
 *   GPS, and some of these were taken at customers' homes — a converter that
 *   kept metadata would publish where they live.
 */
import fs from 'fs'
import path from 'path'
import { GALLERY_PHOTOS, GALLERY_HOME_PICKS, GALLERY_CATEGORIES } from '@/lib/gallery'

const PUBLIC = path.join(process.cwd(), 'public')
const GALLERY_DIR = path.join(PUBLIC, 'images', 'gallery')

interface WebpInfo { w: number; h: number; chunks: string[] }

function readWebp(file: string): WebpInfo {
  const b = fs.readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${file} is not a WebP`)
  }
  const chunks: string[] = []
  let w = 0, h = 0
  let off = 12
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    const d = off + 8
    chunks.push(id)
    if (id === 'VP8X') {
      w = 1 + b.readUIntLE(d + 4, 3)
      h = 1 + b.readUIntLE(d + 7, 3)
    } else if (id === 'VP8 ' && !w) {
      w = b.readUInt16LE(d + 6) & 0x3fff
      h = b.readUInt16LE(d + 8) & 0x3fff
    } else if (id === 'VP8L' && !w) {
      const bits = b.readUInt32LE(d + 1)
      w = (bits & 0x3fff) + 1
      h = ((bits >> 14) & 0x3fff) + 1
    }
    off = d + size + (size & 1)
  }
  return { w, h, chunks }
}

describe('gallery manifest', () => {
  it('lists photos in every category', () => {
    expect(GALLERY_PHOTOS.length).toBeGreaterThanOrEqual(40)
    for (const c of GALLERY_CATEGORIES) {
      expect(GALLERY_PHOTOS.filter(p => p.category === c.id).length).toBeGreaterThan(0)
    }
  })

  it('every photo exists at the size the manifest claims', () => {
    for (const p of GALLERY_PHOTOS) {
      const file = path.join(PUBLIC, p.src)
      expect(fs.existsSync(file)).toBe(true)
      const { w, h } = readWebp(file)
      expect({ src: p.src, w, h }).toEqual({ src: p.src, w: p.w, h: p.h })
    }
  })

  it('has no duplicates, and alt text on every photo', () => {
    const srcs = GALLERY_PHOTOS.map(p => p.src)
    expect(new Set(srcs).size).toBe(srcs.length)
    for (const p of GALLERY_PHOTOS) expect(p.alt.trim().length).toBeGreaterThan(10)
  })

  it('every homepage pick is a gallery photo', () => {
    expect(GALLERY_HOME_PICKS.length).toBe(8)
    for (const src of GALLERY_HOME_PICKS) expect(GALLERY_PHOTOS.some(p => p.src === src)).toBe(true)
  })

  it('no gallery WebP carries EXIF (GPS) metadata', () => {
    const files = fs.readdirSync(GALLERY_DIR).filter(f => f.endsWith('.webp'))
    expect(files.length).toBeGreaterThanOrEqual(GALLERY_PHOTOS.length)
    const withExif = files.filter(f => readWebp(path.join(GALLERY_DIR, f)).chunks.includes('EXIF'))
    expect(withExif).toEqual([])
  })
})
