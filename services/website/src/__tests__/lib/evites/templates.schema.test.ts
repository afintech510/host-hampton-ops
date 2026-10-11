import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { inviteFacts } from '@/lib/evites/facts'
import { FONT_FILES, FONT_KEYS, fontDir } from '@/lib/evites/glyphs'
import { TEMPLATES, TEMPLATE_SLUGS, templateAssetPaths, templateFor } from '@/lib/evites/templates'
import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
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
  it('the registry holds exactly glow and plain, and falls back to plain for anything else', () => {
    expect([...TEMPLATE_SLUGS].sort()).toEqual(['glow', 'plain'])
    for (const slug of TEMPLATE_SLUGS) expect(TEMPLATES[slug].slug).toBe(slug)
    expect(templateFor('glow')).toBe(GLOW_TEMPLATE)
    expect(templateFor('plain')).toBe(PLAIN_TEMPLATE)
    expect(templateFor('swiftie')).toBe(PLAIN_TEMPLATE)
    expect(templateFor(null)).toBe(PLAIN_TEMPLATE)
    expect(templateFor(undefined)).toBe(PLAIN_TEMPLATE)
  })

  it.each(TEMPLATE_SLUGS)('%s: slot, layer and row-child ids are unique', (slug) => {
    const t = TEMPLATES[slug]
    const ids = [...t.layers.map((l) => l.id), ...allSlots(t).map((s) => s.id)]
    expect(ids.length).toBeGreaterThanOrEqual(12)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(TEMPLATE_SLUGS)('%s: every font key is a bundled font and its .woff is on disk', (slug) => {
    const slots = textSlots(TEMPLATES[slug])
    expect(slots.length).toBeGreaterThanOrEqual(9)
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
    expect(paths.length).toBeGreaterThanOrEqual(4)
    for (const p of paths) expect(fs.existsSync(path.join(process.cwd(), 'public', p))).toBe(true)

    const declared = new Map<string, number>()
    for (const l of t.layers) if (l.type === 'image') declared.set(l.src, l.aspect)
    for (const s of allSlots(t)) if (s.type === 'image') declared.set(s.src, s.aspect)
    expect(declared.size).toBeGreaterThanOrEqual(2)
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

  it.each(TEMPLATE_SLUGS)('%s: every glow is a list of {color, radius} stops (spec v1.1)', (slug) => {
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
