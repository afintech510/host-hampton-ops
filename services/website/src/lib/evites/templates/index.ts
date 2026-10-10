/**
 * Template registry (spec §2, §6). `templateFor` never throws and never returns
 * undefined: an unknown slug (a stale row, a hand-edited value) draws as `plain`,
 * which is a finished invitation, rather than failing a render.
 */

import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import type { TemplateLayout } from '@/lib/evites/templates/types'

export const TEMPLATES: Readonly<Record<TemplateLayout['slug'], TemplateLayout>> = {
  glow: GLOW_TEMPLATE,
  plain: PLAIN_TEMPLATE,
}

export const TEMPLATE_SLUGS = Object.keys(TEMPLATES) as TemplateLayout['slug'][]

export function templateFor(slug: string | null | undefined): TemplateLayout {
  return slug === 'glow' ? GLOW_TEMPLATE : PLAIN_TEMPLATE
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
