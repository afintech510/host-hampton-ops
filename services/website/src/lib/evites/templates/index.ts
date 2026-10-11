/**
 * Template registry (spec §2, §6). `templateFor` never throws and never returns
 * undefined: an unknown slug (a stale row, a hand-edited value) draws as `plain`,
 * which is a finished invitation, rather than failing a render.
 */

import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import { SLEEPUNDER_TEMPLATE } from '@/lib/evites/templates/sleepunder'
import type { FontKey, TemplateLayout, TemplateSlug } from '@/lib/evites/templates/types'

export const TEMPLATES: Readonly<Record<TemplateSlug, TemplateLayout>> = {
  glow: GLOW_TEMPLATE,
  plain: PLAIN_TEMPLATE,
  sleepunder: SLEEPUNDER_TEMPLATE,
}

export const TEMPLATE_SLUGS = Object.keys(TEMPLATES) as TemplateSlug[]

export function isKnownTemplateSlug(slug: unknown): slug is TemplateSlug {
  return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(TEMPLATES, slug)
}

export function templateFor(slug: string | null | undefined): TemplateLayout {
  return isKnownTemplateSlug(slug) ? TEMPLATES[slug] : PLAIN_TEMPLATE
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
