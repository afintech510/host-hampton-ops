/**
 * The template layout schema (spec §6).
 *
 * CLIENT-SAFE: this file and the templates import only TYPES from the server
 * modules (`glyphs.ts` reads the filesystem, `facts.ts` pulls in half the app).
 * `components/evites/InviteCanvas.tsx` is rendered in the browser as well as in
 * Satori, so nothing it imports may touch `fs`.
 *
 * Generalised from `handoff/templates/glow.layout.json`. Three optional fields
 * are additions to the §6 sketch, each needed by something the spike proved:
 *   - `row.align`      'center' (honoree + star) | 'baseline' (7TH + Birthday!)
 *   - `row.boxHeight`  the nominal height of a row whose children are centred in
 *                      it, so a shrunken name stays vertically centred (B5)
 *   - `row.showWhen`   the age row disappears with no age
 */

import type { InviteFacts } from '@/lib/evites/facts'
import type { FontKey } from '@/lib/evites/glyphs'

export type { FontKey }

/** One shadow stop. A one-colour glow repeats the colour (spec §6 v1.1, B3). */
export interface GlowStop {
  color: string
  radius: number
}
export interface Glow {
  stops: GlowStop[]
}

export type ShowWhen = keyof InviteFacts | `!${string}`

export interface ShapeLayer {
  id: string
  type: 'shape'
  left: number
  top: number
  width: number
  height: number
  /** CSS border-radius, e.g. '4px' or '32px 0 0 32px'. */
  radius: string
  /** A colour or a CSS gradient. */
  fill?: string
  border?: { width: number; color: string; sides: ('t' | 'r' | 'b' | 'l')[] }
  glow?: Glow
}

export interface ImageLayer {
  id: string
  type: 'image'
  /** Public path, e.g. '/evites/glow/squiggle.png'. */
  src: string
  left: number
  top: number
  height: number
  /** width / height of the artwork. */
  aspect: number
  rotateDeg?: number
}

export type Layer = ShapeLayer | ImageLayer

export interface TextSlot {
  id: string
  type: 'text'
  top: number
  font: FontKey
  size: number
  minSize?: number
  maxWidth?: number
  /** Explicit and numeric: CSS `normal` is not portable between Chrome and Satori. */
  lineHeight: number
  letterSpacingEm?: number
  uppercase?: boolean
  color?: string
  fill?: { gradient: string[]; angleDeg: number }
  glow?: Glow
  bind?: keyof InviteFacts
  staticText?: string
  showWhen?: ShowWhen
}

export interface ImageSlot {
  id: string
  type: 'image'
  top: number
  src: string
  /** Nominal width in px; its height follows `aspect`. */
  width: number
  /** width / height of the artwork. */
  aspect: number
  showWhen?: ShowWhen
}

export interface RowSlot {
  id: string
  type: 'row'
  top: number
  gap: number
  maxWidth: number
  align: 'center' | 'baseline'
  boxHeight?: number
  showWhen?: ShowWhen
  children: Array<TextSlot | ImageSlot>
}

export type Slot = TextSlot | ImageSlot | RowSlot

export interface OgCardSpec {
  portraitHeight: 560
  radius: 14
  titleFont: FontKey
  titleSize: 74
  titleColor: string
  glow: Glow
  ctaText: 'Tap to RSVP'
  ctaBg: string
  ctaColor: string
}

export interface TemplateLayout {
  slug: 'glow' | 'plain'
  canvas: { width: 1085; height: 1530 }
  /** `web`: the page's webp. `raster`: the 1x JPEG Satori embeds. Both public paths. */
  background: { web: string; raster: string }
  /** The colour behind (and flattened under) the art. */
  backgroundColor: string
  layers: Layer[]
  slots: Slot[]
  ogCard: OgCardSpec
}

/**
 * CSS family and weight for each font key. The families are the `@font-face` names
 * the page declares and the `name` Satori is given. `glyphs.ts` `FONT_FILES` holds
 * the same pairs next to the files; a test pins that the two agree, because this
 * module must not import it at runtime (that one reads the disk).
 */
export const FONT_STYLE: Record<FontKey, { family: string; weight: 400 | 600 }> = {
  monoton: { family: 'Monoton', weight: 400 },
  bungee: { family: 'Bungee Outline', weight: 400 },
  neon: { family: 'Neonderthaw', weight: 400 },
  poppins400: { family: 'Poppins', weight: 400 },
  poppins600: { family: 'Poppins', weight: 600 },
}

/** Font sizes in px by slot id; a row's image child is keyed by its id too and holds its WIDTH in px. */
export type InviteSizes = Record<string, number>

/** `public` path -> `data:` URI. Required in satori mode, ignored in web mode. */
export type InviteAssets = Record<string, string>
