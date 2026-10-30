import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { inviteFacts } from '@/lib/evites/facts'
import { FONT_FILES, FONT_KEYS, fontDir } from '@/lib/evites/glyphs'
import { TEMPLATES, TEMPLATE_SLUGS, galleryTemplates, isGallerySlug, sampleImageOf, templateAssetPaths, templateFor } from '@/lib/evites/templates'
import { showWhenOk } from '@/lib/evites/templates/slotText'
import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import { SLEEPUNDER_TEMPLATE } from '@/lib/evites/templates/sleepunder'
import { FONT_STYLE, type Slot, type TemplateLayout, type TextSlot } from '@/lib/evites/templates/types'
import { bookingRow, evitesRow, THEME_ROWS } from '../../helpers/eviteFixtures'

/** A real `inviteFacts()` output: the set of keys a `bind` / `showWhen` may name is whatever it really returns. */
const SAMPLE_FACTS = inviteFacts(bookingRow() as never, evitesRow() as never, [], THEME_ROWS, 'live')
const FACT_KEYS = new Set(Object.keys(SAMPLE_FACTS))

/** Every text slot, including a row's children. */
function textSlots(t: TemplateLayout): TextSlot[] {
  const out: TextSlot[] = []
  for (const s of t.slots) {
    if (s.type === 'text') out.push(s)
    if (s.type === 'row') for (const c of s.children) if (c.type === 'text') out.push(c)
  }
  return out
}

/**
 * How much each template draws, as floors: a template that silently lost slots or art fails here.
 * Sleep Under has no layers and no image slots (its art is all background), so its floors are lower.
 */
const FLOORS: Record<string, { ids: number; texts: number; images: number; declared: number }> = {
  glow: { ids: 12, texts: 9, images: 4, declared: 2 },
  plain: { ids: 12, texts: 9, images: 4, declared: 2 },
}
/** The Canva set (2026-10-11): art is all background, and the smallest design has seven text slots. */
const CANVA_FLOOR = { ids: 7, texts: 7, images: 2, declared: 0 }
const floorOf = (slug: string) => FLOORS[slug] ?? CANVA_FLOOR

/** The Canva-built designs: every gallery template but the hand-built Glow. */
const CANVA_SLUGS = TEMPLATE_SLUGS.filter((s) => s !== 'glow' && s !== 'plain')

/** Every slot and row child, flat. */
function allSlots(t: TemplateLayout): Slot[] {
  const out: Slot[] = []
  for (const s of t.slots) {
    out.push(s)
    if (s.type === 'row') out.push(...s.children)
  }
  return out
}

describe('evites templates - schema', () => {
  it('the registry holds glow, plain, sleepunder and the 18 Canva designs, and falls back to plain for anything else', () => {
    expect(TEMPLATE_SLUGS).toHaveLength(21)
    for (const slug of ['glow', 'plain', 'sleepunder', 'stitch', 'minecraft', 'slime-neon', 'vroom', 'paw-patrol']) expect(TEMPLATE_SLUGS).toContain(slug)
    for (const slug of TEMPLATE_SLUGS) expect(TEMPLATES[slug].slug).toBe(slug)
    expect(templateFor('glow')).toBe(GLOW_TEMPLATE)
    expect(templateFor('plain')).toBe(PLAIN_TEMPLATE)
    expect(templateFor('sleepunder')).toBe(SLEEPUNDER_TEMPLATE)
    expect(templateFor('swiftie')).toBe(PLAIN_TEMPLATE)
    expect(templateFor('constructor')).toBe(PLAIN_TEMPLATE)
    expect(templateFor(null)).toBe(PLAIN_TEMPLATE)
    expect(templateFor(undefined)).toBe(PLAIN_TEMPLATE)
  })

  it.each(TEMPLATE_SLUGS)('%s: slot, layer and row-child ids are unique', (slug) => {
    const t = TEMPLATES[slug]
    const ids = [...t.layers.map((l) => l.id), ...allSlots(t).map((s) => s.id)]
    expect(ids.length).toBeGreaterThanOrEqual(floorOf(slug).ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(TEMPLATE_SLUGS)('%s: every font key is a bundled font and its .woff is on disk', (slug) => {
    const slots = textSlots(TEMPLATES[slug])
    expect(slots.length).toBeGreaterThanOrEqual(floorOf(slug).texts)
    for (const s of slots) {
      expect(FONT_KEYS).toContain(s.font)
      expect(fs.existsSync(path.join(fontDir(), FONT_FILES[s.font].file))).toBe(true)
    }
    expect(FONT_KEYS as readonly string[]).toContain(TEMPLATES[slug].ogCard.titleFont)
  })

  it('FONT_STYLE (client-safe) agrees with glyphs FONT_FILES (server) for every key', () => {
    expect(Object.keys(FONT_STYLE).sort()).toEqual([...FONT_KEYS].sort())
    for (const k of FONT_KEYS) {
      expect(FONT_STYLE[k].family).toBe(FONT_FILES[k].family)
      expect(FONT_STYLE[k].weight).toBe(FONT_FILES[k].weight)
    }
  })

  it.each(TEMPLATE_SLUGS)('%s: every image exists in public/ and its declared aspect is the file\'s', async (slug) => {
    const t = TEMPLATES[slug]
    const paths = templateAssetPaths(t)
    expect(paths.length).toBeGreaterThanOrEqual(floorOf(slug).images)
    for (const p of paths) expect(fs.existsSync(path.join(process.cwd(), 'public', p))).toBe(true)

    const declared = new Map<string, number>()
    for (const l of t.layers) if (l.type === 'image') declared.set(l.src, l.aspect)
    for (const s of allSlots(t)) if (s.type === 'image') declared.set(s.src, s.aspect)
    expect(declared.size).toBeGreaterThanOrEqual(floorOf(slug).declared)
    for (const [src, aspect] of Array.from(declared)) {
      const m = await sharp(path.join(process.cwd(), 'public', src)).metadata()
      expect((m.width as number) / (m.height as number)).toBeCloseTo(aspect, 2)
    }

    // The two backgrounds are the 1x canvas.
    for (const p of [t.background.web, t.background.raster]) {
      const m = await sharp(path.join(process.cwd(), 'public', p)).metadata()
      expect([m.width, m.height]).toEqual([t.canvas.width, t.canvas.height])
    }
    expect(t.background.raster).toMatch(/\.jpg$/)
  })

  it.each(TEMPLATE_SLUGS)('%s: every bind and showWhen names a real InviteFacts key; every text slot says something', (slug) => {
    const t = TEMPLATES[slug]
    expect(FACT_KEYS.size).toBeGreaterThan(15)
    for (const s of textSlots(t)) {
      expect(Boolean(s.bind) !== (s.staticText !== undefined)).toBe(true) // exactly one of the two
      if (s.bind) expect(FACT_KEYS).toContain(s.bind)
    }
    for (const s of allSlots(t)) {
      if (!('showWhen' in s) || !s.showWhen) continue
      const key = s.showWhen.startsWith('!') ? s.showWhen.slice(1) : s.showWhen
      expect(FACT_KEYS).toContain(key)
    }
  })

  it.each(TEMPLATE_SLUGS)('%s: every text slot has a numeric lineHeight and shrinking slots have a floor', (slug) => {
    for (const s of textSlots(TEMPLATES[slug])) {
      expect(typeof s.lineHeight).toBe('number')
      expect(s.lineHeight).toBeGreaterThan(0)
      if (s.maxWidth !== undefined) expect(s.minSize).toBeLessThanOrEqual(s.size)
      if (s.fill) expect(s.fill.gradient.length).toBeGreaterThanOrEqual(2)
    }
  })

  it.each(['glow', 'plain'] as const)('%s: every glow is a list of {color, radius} stops (spec v1.1)', (slug) => {
    const t = TEMPLATES[slug]
    const glows = [
      ...textSlots(t).flatMap((s) => (s.glow ? [s.glow] : [])),
      ...t.layers.flatMap((l) => (l.type === 'shape' && l.glow ? [l.glow] : [])),
      t.ogCard.glow,
    ]
    expect(glows.length).toBeGreaterThanOrEqual(8)
    for (const g of glows) {
      expect(g.stops.length).toBeGreaterThanOrEqual(2)
      for (const st of g.stops) {
        expect(st.color).toMatch(/^#[0-9a-f]{6}$/i)
        expect(st.radius).toBeGreaterThan(0)
      }
    }
    // GLOW's two-colour halo is the case the old shape could not express.
    const word = textSlots(t).find((s) => s.id === 'theme_word') as TextSlot
    expect(word.glow?.stops.map((s) => s.color)).toEqual(['#ff3df2', '#8a3dff'])
  })

  it('sleepunder: sticker lettering in Lobster, outlines and shadows are hex, and the OG card is a light one', () => {
    const t = SLEEPUNDER_TEMPLATE
    const byId = (id: string) => textSlots(t).find((s) => s.id === id) as TextSlot
    for (const id of ['theme_word', 'theme_sub', 'honoree', 'age', 'birthday_word']) {
      const s = byId(id)
      expect(s.font).toBe('lobster')
      expect(s.uppercase).toBeFalsy()
      expect(s.stroke?.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.stroke?.width).toBeGreaterThan(0)
      expect(s.shadow?.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(byId('theme_word').titleCase).toBe(true)
    expect(byId('theme_sub').titleCase).toBe(true)
    expect(byId('honoree').bind).toBe('honoreePossessive')
    expect(byId('age').showWhen).toBe('ageOrdinal')
    // Canva's tops x 2.277, then moved for Lobster's descenders (see the header of sleepunder.ts).
    expect(['invited_line', 'theme_word', 'theme_sub', 'celebrate_line', 'birthday_word', 'date_time'].map((id) => byId(id).top)).toEqual([
      243, 262, 445, 680, 888, 1030,
    ])
    expect(t.ogCard).toMatchObject({ titleFont: 'lobster', titleUppercase: false, portraitHeight: 560, radius: 14, titleSize: 74, ctaText: 'Tap to RSVP' })
    expect(t.ogCard.backdrop).toMatch(/^linear-gradient\(/)
    expect(t.ogCard.textColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(t.canvas).toEqual({ width: 1085, height: 1530 })
  })

  it('the gallery is every template but plain, each with a label, its Canva source and a sample thumbnail', async () => {
    const gallery = galleryTemplates().map((t) => t.slug)
    expect(gallery).toEqual(TEMPLATE_SLUGS.filter((s) => s !== 'plain'))
    expect(isGallerySlug('plain')).toBe(false)
    expect(isGallerySlug('constructor')).toBe(false)
    for (const t of galleryTemplates()) {
      expect(t.label).toMatch(/\S/)
      const m = await sharp(path.join(process.cwd(), 'public', sampleImageOf(t.slug))).metadata()
      expect([m.width, m.height]).toEqual([362, 510])
    }
    expect(new Set(galleryTemplates().map((t) => t.label)).size).toBe(gallery.length) // no two designs share a name
    for (const slug of CANVA_SLUGS) {
      expect(TEMPLATES[slug].source?.canvaDesignId).toMatch(/^D[A-Za-z0-9_-]{10}$/)
      expect(TEMPLATES[slug].source?.canvaArtCopyId).toMatch(/^D[A-Za-z0-9_-]{10}$/)
    }
  })

  it.each(CANVA_SLUGS)('%s: the per-party facts are BOUND (a name, the place, the host line), never typed in', (slug) => {
    const binds = new Set(textSlots(TEMPLATES[slug]).map((s) => s.bind).filter(Boolean))
    expect(['honoreeDisplay', 'honoreeName', 'honoreePossessive'].some((b) => binds.has(b as never))).toBe(true)
    expect(binds.has('placeLine')).toBe(true)
    expect(binds.has('hostContactLine')).toBe(true)
    // No design keeps a sample customer's words: Adam's originals named real children and mothers.
    const statics = textSlots(TEMPLATES[slug]).map((s) => s.staticText ?? '').join(' | ')
    expect(statics).not.toMatch(/Scarlett|Aaliyah|Annabel|Madeylyn|Sven|Aubrey|Hensley|Sophia|Lorna|Archie|Cooper|Sadie|Hannah|Layla|Luke|Chiara|Cora|RSVP to|\d{3}[-) ]\d{3}-\d{4}/i)
  })

  it.each(TEMPLATE_SLUGS)('%s: a party with no date yet still says "Pick your date", and no date piece is left showing', (slug) => {
    const preview = inviteFacts(bookingRow() as never, evitesRow() as never, [], THEME_ROWS, 'preview')
    const shown: string[] = []
    const visit = (s: TextSlot, rowOk: boolean) => {
      if (!rowOk || !showWhenOk(s.showWhen, preview) || !s.bind) return
      const v = preview[s.bind]
      if (typeof v === 'string' && v !== '') shown.push(s.bind)
    }
    for (const s of TEMPLATES[slug].slots) {
      if (s.type === 'text') visit(s, true)
      if (s.type === 'row') for (const c of s.children) if (c.type === 'text') visit(c, showWhenOk(s.showWhen, preview))
    }
    expect(shown).toContain('dateLine')
    for (const piece of ['weekdayText', 'monthText', 'dayText', 'timeText']) expect(shown).not.toContain(piece)
  })

  it('plain is glow minus the icon_strip slot, and nothing else', () => {
    expect(GLOW_TEMPLATE.slots.map((s) => s.id)).toContain('icon_strip')
    expect(PLAIN_TEMPLATE.slots.map((s) => s.id)).not.toContain('icon_strip')
    expect(PLAIN_TEMPLATE.slots.map((s) => s.id)).toEqual(GLOW_TEMPLATE.slots.map((s) => s.id).filter((id) => id !== 'icon_strip'))
    expect(PLAIN_TEMPLATE.layers).toEqual(GLOW_TEMPLATE.layers)
    expect(PLAIN_TEMPLATE.ogCard).toEqual(GLOW_TEMPLATE.ogCard)
    expect(PLAIN_TEMPLATE.background).toEqual(GLOW_TEMPLATE.background)
  })

  it('the Glow numbers are the spike\'s (tops and sizes the mock was checked with)', () => {
    const byId = (id: string) => allSlots(GLOW_TEMPLATE).find((s) => s.id === id) as Slot & Record<string, unknown>
    expect([byId('invited_line').top, byId('theme_word').top, byId('theme_sub').top, byId('icon_strip').top]).toEqual([118, 201, 470, 700])
    expect([byId('honoree_row').top, byId('age_row').top, byId('date_time').top, byId('location').top, byId('host_contact').top]).toEqual([
      835, 1035, 1292, 1345, 1388,
    ])
    expect(byId('theme_word').size).toBe(250)
    expect(byId('honoree').size).toBe(165)
    expect(byId('honoree_row').boxHeight).toBe(165)
    expect(byId('star').showWhen).toBe('!hasName')
    expect(GLOW_TEMPLATE.ogCard).toMatchObject({ portraitHeight: 560, radius: 14, titleSize: 74, ctaText: 'Tap to RSVP' })
    expect(GLOW_TEMPLATE.canvas).toEqual({ width: 1085, height: 1530 })
  })
})
