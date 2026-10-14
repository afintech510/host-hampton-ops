/**
 * Template registry (spec §2, §6). `templateFor` never throws and never returns
 * undefined: an unknown slug (a stale row, a hand-edited value) draws as `plain`,
 * which is a finished invitation, rather than failing a render.
 */

import { BARBIE_DISCO_TEMPLATE } from '@/lib/evites/templates/barbie-disco'
import { CONSTRUCTION_TEMPLATE } from '@/lib/evites/templates/construction'
import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { HELLO_KITTY_TEMPLATE } from '@/lib/evites/templates/hello-kitty'
import { LETS_GLOW_TEMPLATE } from '@/lib/evites/templates/lets-glow'
import { MERMAID_TEMPLATE } from '@/lib/evites/templates/mermaid'
import { MINECRAFT_TEMPLATE } from '@/lib/evites/templates/minecraft'
import { NEON_PARTY_TEMPLATE } from '@/lib/evites/templates/neon-party'
import { PINK_PONY_TEMPLATE } from '@/lib/evites/templates/pink-pony'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import { SADDLE_UP_TEMPLATE } from '@/lib/evites/templates/saddle-up'
import { SLEEPUNDER_TEMPLATE } from '@/lib/evites/templates/sleepunder'
import { SLIME_NEON_TEMPLATE } from '@/lib/evites/templates/slime-neon'
import { SLIME_PASTEL_TEMPLATE } from '@/lib/evites/templates/slime-pastel'
import { SLIME_TEAL_TEMPLATE } from '@/lib/evites/templates/slime-teal'
import { SQUISH_TEMPLATE } from '@/lib/evites/templates/squish'
import { STITCH_TEMPLATE } from '@/lib/evites/templates/stitch'
import { TWO_SWEET_TEMPLATE } from '@/lib/evites/templates/two-sweet'
import { UNICORN_TEMPLATE } from '@/lib/evites/templates/unicorn'
import { VROOM_TEMPLATE } from '@/lib/evites/templates/vroom'
import type { FontKey, RegisteredTemplateSlug, TemplateLayout, TemplateSlug } from '@/lib/evites/templates/types'

/**
 * Every design, in GALLERY order (the host sees them in this order): glow and neon, slime,
 * sleepovers and glam, animals, characters, little ones. `plain` is last and never shown.
 * A host's own invitation (`custom`) is deliberately absent: see `lib/evites/customArt.ts`.
 */
export const TEMPLATES: Readonly<Record<RegisteredTemplateSlug, TemplateLayout>> = {
  glow: GLOW_TEMPLATE,
  'lets-glow': LETS_GLOW_TEMPLATE,
  'neon-party': NEON_PARTY_TEMPLATE,
  'slime-neon': SLIME_NEON_TEMPLATE,
  'slime-pastel': SLIME_PASTEL_TEMPLATE,
  'slime-teal': SLIME_TEAL_TEMPLATE,
  sleepunder: SLEEPUNDER_TEMPLATE,
  'barbie-disco': BARBIE_DISCO_TEMPLATE,
  'hello-kitty': HELLO_KITTY_TEMPLATE,
  'pink-pony': PINK_PONY_TEMPLATE,
  'saddle-up': SADDLE_UP_TEMPLATE,
  unicorn: UNICORN_TEMPLATE,
  mermaid: MERMAID_TEMPLATE,
  stitch: STITCH_TEMPLATE,
  squish: SQUISH_TEMPLATE,
  'two-sweet': TWO_SWEET_TEMPLATE,
  minecraft: MINECRAFT_TEMPLATE,
  construction: CONSTRUCTION_TEMPLATE,
  vroom: VROOM_TEMPLATE,
  plain: PLAIN_TEMPLATE,
}

export const TEMPLATE_SLUGS = Object.keys(TEMPLATES) as RegisteredTemplateSlug[]

export function isKnownTemplateSlug(slug: unknown): slug is RegisteredTemplateSlug {
  return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(TEMPLATES, slug)
}

export function templateFor(slug: string | null | undefined): TemplateLayout {
  return isKnownTemplateSlug(slug) ? TEMPLATES[slug] : PLAIN_TEMPLATE
}

/**
 * The host's gallery (migration 070): every registered template that has a gallery `label`, in
 * registry order. `plain` is the fallback for a theme with no art, never something to pick.
 */
export function galleryTemplates(): TemplateLayout[] {
  return TEMPLATE_SLUGS.flatMap((slug) => {
    const t = TEMPLATES[slug]
    return t && t.slug !== 'plain' && t.label ? [t] : []
  })
}

export function isGallerySlug(slug: unknown): slug is RegisteredTemplateSlug {
  return isKnownTemplateSlug(slug) && galleryTemplates().some((t) => t.slug === slug)
}

/** The gallery thumbnail: a small sample render ("Mia's 7th") committed beside the template's art. */
export function sampleImageOf(slug: TemplateSlug): string {
  return `/evites/${slug}/sample.jpg`
}

/**
 * The font of the first text slot (row children included) bound to one of `binds`, else `fallback`.
 * `inviteFacts` screens each image-bound string for the font its template really draws it in.
 */
export function fontForBind(t: TemplateLayout, binds: readonly string[], fallback: FontKey): FontKey {
  for (const bind of binds) {
    for (const s of t.slots) {
      if (s.type === 'text' && s.bind === bind) return s.font
      if (s.type === 'row') for (const c of s.children) if (c.type === 'text' && c.bind === bind) return c.font
    }
  }
  return fallback
}

/** Every public asset path a template draws (background, layers, slots, row children). */
export function templateAssetPaths(t: TemplateLayout): string[] {
  const out = new Set<string>([t.background.web, t.background.raster])
  for (const l of t.layers) if (l.type === 'image') out.add(l.src)
  for (const s of t.slots) {
    if (s.type === 'image') out.add(s.src)
    if (s.type === 'row') for (const c of s.children) if (c.type === 'image') out.add(c.src)
  }
  return Array.from(out)
}
