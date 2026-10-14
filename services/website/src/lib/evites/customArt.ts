/**
 * A host's OWN invitation (migration 073): `evites.custom_art`.
 *
 * Some hosts arrive with a finished invitation of their own (2026-10-14, Brylee's, a portrait of
 * the child on a unicorn). It is drawn as-is: the whole picture is the background of a template with
 * NO text slots, and everything else the system does (the page, RSVPs, reminders, the share card)
 * carries on around it. The guest-facing words outside the picture still come from the facts, so set
 * the evite's host contact to match whatever the picture says.
 *
 * Where the art lives, and why there:
 *   - Supabase Storage, bucket `evites`, at `<image_key>/<custom_art>`: the SAME folder as the
 *     party's rendered invitation, so it is exactly as public as the invitation already is (anyone
 *     with the `/i/<slug>` link) and no more. `image_key` is 32 random hex and never in the repo.
 *   - NEVER `public/evites/`. This repository is public, the art is a real child's face, and a design
 *     in `public/` would also be one registry line from the look-book.
 *
 * It is per party by construction: `custom` is not in `TEMPLATES`, so no gallery, picker, admin
 * `template_slug` override or `templateFor()` can reach it. Only a row whose own `custom_art` names
 * an object in its own `image_key` folder draws it.
 *
 * The art must already be 1085x1530 (`scripts/evite-custom-art.mjs` fits and uploads it).
 */

import { templateFor } from '@/lib/evites/templates'
import type { TemplateLayout } from '@/lib/evites/templates/types'

/** What `evites.custom_art` may hold (the migration 073 CHECK is the same pattern). */
export const CUSTOM_ART_OBJECT = /^custom-[0-9a-f]{8,32}\.jpg$/
const IMAGE_KEY = /^[0-9a-f]{32}$/

/** `<image_key>/<custom_art>` inside the `evites` bucket, or null when the row has no usable custom art. */
export function customArtPath(evite: { image_key?: string | null; custom_art?: string | null }): string | null {
  const key = evite.image_key
  const name = evite.custom_art
  if (typeof key !== 'string' || typeof name !== 'string') return null
  if (!IMAGE_KEY.test(key) || !CUSTOM_ART_OBJECT.test(name)) return null
  return `${key}/${name}`
}

/** The public Storage URL of a `customArtPath`, or null without a Supabase URL. */
export function customArtUrl(path: string, supabaseUrl: string | undefined): string | null {
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  return base ? `${base}/storage/v1/object/public/evites/${path}` : null
}

const PINK = '#e0218a'

/**
 * The template for one party's own art: the picture, nothing on top of it. `src` is what both
 * `background` fields hold: the Storage URL for the web canvas, and the key the renderer files the
 * downloaded bytes under in its `assets` map (Satori never sees a URL, only that data URI).
 */
export function customTemplate(src: string): TemplateLayout {
  return {
    slug: 'custom',
    canvas: { width: 1085, height: 1530 },
    background: { web: src, raster: src },
    backgroundColor: '#fde7f1',
    layers: [],
    slots: [],
    ogCard: {
      portraitHeight: 560,
      radius: 14,
      titleFont: 'lobster',
      titleSize: 74,
      titleColor: PINK,
      glow: { stops: [{ color: '#ffffff', radius: 6 }, { color: '#ffe3ef', radius: 14 }] },
      ctaText: 'Tap to RSVP',
      ctaBg: PINK,
      ctaColor: '#ffffff',
      titleUppercase: false,
      textColor: '#4a2340',
      hostColor: '#b0126a',
      // A gradient rather than the art itself: the card must stay under 300 KB, and the portrait beside it IS the art.
      backdrop: 'linear-gradient(135deg, #ffe3ef 0%, #fff4f8 55%, #f3e3ff 100%)',
      portraitShadow: '0 10px 30px #8a3a6a55',
    },
  }
}

/**
 * The template a set of facts is drawn with: the party's own art when it has some, else the registry.
 * `src` for the custom case is the public URL when `supabaseUrl` is given, else the bare Storage path
 * (the renderer's asset key).
 */
export function templateForFacts(facts: { templateSlug: string; customArt: string | null }, supabaseUrl?: string): TemplateLayout {
  if (facts.customArt) return customTemplate(customArtUrl(facts.customArt, supabaseUrl) ?? facts.customArt)
  return templateFor(facts.templateSlug)
}
