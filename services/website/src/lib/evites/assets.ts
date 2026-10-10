/**
 * Everything Satori is given, read from disk once and kept (spec §5, §6):
 * the fonts, the template's images as `data:` URIs, and the OG background.
 *
 * Satori is called with NO asset loader, so it can never fetch anything; this is
 * the only way a font or an image reaches it. Files live under
 * `process.cwd()/public/evites/...` (the same place `glyphs.ts` reads fonts from;
 * `services/website/Dockerfile` copies `public/` into the runtime image).
 *
 * A missing file THROWS: it is a deploy defect, not a runtime condition, and
 * `renderEvite` turns it into `render_error = 'render-failed: ...'` while the
 * previous objects keep being served.
 */

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { FONT_FILES, FONT_KEYS, fontDir } from '@/lib/evites/glyphs'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/evites/layout'
import { templateAssetPaths } from '@/lib/evites/templates'
import type { InviteAssets, TemplateLayout } from '@/lib/evites/templates/types'

export interface SatoriFont {
  name: string
  data: Buffer
  weight: 400 | 600
  style: 'normal'
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

/** Read a `/evites/...` public path from disk. Anything else (or a `..`) is refused. */
export function readPublicFile(publicPath: string): Buffer {
  if (!/^\/evites\/[A-Za-z0-9_./-]+$/.test(publicPath) || publicPath.includes('..')) {
    throw new Error(`evites/assets: refusing path "${publicPath}"`)
  }
  return fs.readFileSync(path.join(process.cwd(), 'public', publicPath))
}

const uriCache = new Map<string, string>()

export function publicDataUri(publicPath: string): string {
  const hit = uriCache.get(publicPath)
  if (hit) return hit
  const mime = MIME[path.extname(publicPath).toLowerCase()]
  if (!mime) throw new Error(`evites/assets: no mime type for "${publicPath}"`)
  const uri = `data:${mime};base64,${readPublicFile(publicPath).toString('base64')}`
  uriCache.set(publicPath, uri)
  return uri
}

/** The data URIs a satori-mode `InviteCanvas` needs: the 1x raster background and every image the template draws. */
export function loadTemplateAssets(template: TemplateLayout): InviteAssets {
  const out: InviteAssets = {}
  for (const p of templateAssetPaths(template)) {
    if (p === template.background.web) continue // the page's webp; Satori never draws it
    out[p] = publicDataUri(p)
  }
  return out
}

let fontsMemo: SatoriFont[] | null = null

/** The five bundled `.woff` files in the shape Satori wants. */
export function satoriFonts(): SatoriFont[] {
  if (fontsMemo) return fontsMemo
  fontsMemo = FONT_KEYS.map((key) => {
    const spec = FONT_FILES[key]
    return { name: spec.family, data: fs.readFileSync(path.join(fontDir(), spec.file)), weight: spec.weight, style: 'normal' as const }
  })
  return fontsMemo
}

const ogBgCache = new Map<string, Promise<string>>()

/** The template's raster background cover-cropped to 1200x630, as a data URI. Computed once per template. */
export function ogBackgroundUri(template: TemplateLayout): Promise<string> {
  const key = template.background.raster
  let p = ogBgCache.get(key)
  if (!p) {
    p = sharp(readPublicFile(key))
      .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()
      .then((buf) => `data:image/jpeg;base64,${buf.toString('base64')}`)
    p.catch(() => ogBgCache.delete(key))
    ogBgCache.set(key, p)
  }
  return p
}
