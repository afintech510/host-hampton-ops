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
 *
 * The Sleep Under template (Canva "Pastel Pink and Blue Slumber Party") added the
 * sticker-lettering fields: `text.stroke` (an outline, `-webkit-text-stroke`,
 * which Satori draws too), `text.shadow` (one hard offset shadow), `text.titleCase`
 * ("SLEEP UNDER" -> "Sleep Under", for a script face that must not be set in
 * capitals), and the `ogCard` colour fields for a LIGHT card.
 */

import type { InviteFacts } from '@/lib/evites/facts'
import type { FontKey, FontWeight } from '@/lib/evites/glyphs'

export type { FontKey, FontWeight }

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

/**
 * Where a slot sits horizontally. Absent = the whole canvas width, centred (every Glow slot).
 * `left`/`width` are the box in canvas px; `align` places the text (or a row's children) in it.
 * `rotateDeg` turns the whole box about its centre (Minecraft's sideways "NOV").
 */
export interface SlotBox {
  left: number
  width: number
  align?: 'left' | 'center' | 'right'
  rotateDeg?: number
}

export interface TextSlot {
  id: string
  type: 'text'
  top: number
  box?: SlotBox
  font: FontKey
  size: number
  minSize?: number
  maxWidth?: number
  /** Explicit and numeric: CSS `normal` is not portable between Chrome and Satori. */
  lineHeight: number
  letterSpacingEm?: number
  uppercase?: boolean
  /** Every word capitalised and the rest lower-cased ("SLEEP UNDER" -> "Sleep Under"). Ignored with `uppercase`. */
  titleCase?: boolean
  color?: string
  fill?: { gradient: string[]; angleDeg: number }
  glow?: Glow
  /** An outline drawn over the glyph edge (`-webkit-text-stroke`), in px at the slot's nominal size. */
  stroke?: { width: number; color: string }
  /** One hard drop shadow, offset in px at the slot's nominal size. Combined with `glow` if both are set. */
  shadow?: { x: number; y: number; color: string }
  bind?: keyof InviteFacts
  staticText?: string
  showWhen?: ShowWhen
}

export interface ImageSlot {
  id: string
  type: 'image'
  top: number
  box?: SlotBox
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
  box?: SlotBox
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
  /** Set the title in capitals (Glow) or as typed (a script face). Absent = capitals. */
  titleUppercase?: boolean
  /** Hard offset shadow and outline for the title, as in the invitation's own lettering. */
  titleShadow?: { x: number; y: number; color: string }
  titleStroke?: { width: number; color: string }
  /** Body text and host-line colours. Absent = Glow's cream and pink, which only read on a dark card. */
  textColor?: string
  hostColor?: string
  /** A CSS gradient drawn INSTEAD of the cropped invitation art (a light design's art is mostly white). */
  backdrop?: string
  /** The halo behind the portrait. Absent = Glow's violet. */
  portraitShadow?: string
}

/**
 * Every invitation design. The first three are hand-built; the rest are Adam's Canva invitations
 * (2026-10-11), one file each under `templates/`, registered in `templates/index.ts`.
 */
export type TemplateSlug =
  | 'glow'
  | 'plain'
  | 'sleepunder'
  | 'stitch'
  | 'barbie-disco'
  | 'unicorn'
  | 'mermaid'
  | 'minecraft'
  | 'saddle-up'
  | 'hello-kitty'
  | 'pink-pony'
  | 'two-sweet'
  | 'construction'
  | 'slime-pastel'
  | 'slime-teal'
  | 'slime-neon'
  | 'squish'
  | 'vroom'
  | 'lets-glow'
  | 'neon-party'
  | 'paw-patrol'
  /**
   * A host's OWN finished invitation (migration 073, `evites.custom_art`). Never registered in
   * `TEMPLATES`, so no picker, admin override or `templateFor` can reach it: it is built per party by
   * `customTemplate()` in `lib/evites/customArt.ts` around art that lives in Storage, never in this
   * repository (a public one, and the art is a real child's photo).
   */
  | 'custom'

/** Every slug with a template in the registry: all of them except the per-party `custom`. */
export type RegisteredTemplateSlug = Exclude<TemplateSlug, 'custom'>

export interface TemplateLayout {
  slug: TemplateSlug
  /** The design's name in the host's gallery ("Watercolor Unicorn"). */
  label?: string
  /** The Canva design it was built from, and the text-free working copy its art was exported from. */
  source?: { canvaDesignId: string; canvaArtCopyId: string }
  canvas: { width: 1085; height: 1530 }
  /** `web`: the page's webp. `raster`: the 1x JPEG Satori embeds. Both public paths (a `custom` template's are Storage). */
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
export const FONT_STYLE: Record<FontKey, { family: string; weight: FontWeight }> = {
  monoton: { family: 'Monoton', weight: 400 },
  bungee: { family: 'Bungee Outline', weight: 400 },
  neon: { family: 'Neonderthaw', weight: 400 },
  poppins400: { family: 'Poppins', weight: 400 },
  poppins600: { family: 'Poppins', weight: 600 },
  lobster: { family: 'Lobster', weight: 400 },
  greatvibes: { family: 'Great Vibes', weight: 400 },
  kaushan: { family: 'Kaushan Script', weight: 400 },
  yellowtail: { family: 'Yellowtail', weight: 400 },
  dancing700: { family: 'Dancing Script', weight: 700 },
  fredoka600: { family: 'Fredoka', weight: 600 },
  fredoka700: { family: 'Fredoka', weight: 700 },
  luckiest: { family: 'Luckiest Guy', weight: 400 },
  silkscreen700: { family: 'Silkscreen', weight: 700 },
  montserrat500: { family: 'Montserrat', weight: 500 },
  montserrat800: { family: 'Montserrat', weight: 800 },
  playfair400: { family: 'Playfair Display', weight: 400 },
  playfair700: { family: 'Playfair Display', weight: 700 },
  stardos700: { family: 'Stardos Stencil', weight: 700 },
}

/** Font sizes in px by slot id; a row's image child is keyed by its id too and holds its WIDTH in px. */
export type InviteSizes = Record<string, number>

/** `public` path -> `data:` URI. Required in satori mode, ignored in web mode. */
export type InviteAssets = Record<string, string>
