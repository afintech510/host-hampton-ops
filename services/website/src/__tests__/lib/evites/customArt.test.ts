import sharp from 'sharp'
import { CUSTOM_ART_OBJECT, customArtPath, customArtUrl, customTemplate, templateForFacts } from '@/lib/evites/customArt'
import { inviteFacts } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { renderEvite } from '@/lib/evites/render'
import { galleryTemplates, isGallerySlug, isKnownTemplateSlug, TEMPLATE_SLUGS, templateFor } from '@/lib/evites/templates'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import { makeFakeEviteDb } from '../../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, tablesFor, THEME_ROWS } from '../../helpers/eviteFixtures'

/**
 * A host's own invitation (migration 073, `evites.custom_art`): per party, read from Storage,
 * unreachable from the gallery, and invisible to every invitation that does not have one.
 */

jest.setTimeout(90_000)

const KEY = 'abfcb56ce0898e60db2a02b8427c914d'
const ART = 'custom-0123abcd.jpg'

const factsFor = (evite: Record<string, unknown> = {}) =>
  inviteFacts(bookingRow() as never, evitesRow(evite) as never, LINE_ITEM_ROWS, THEME_ROWS, 'live')

describe('customArtPath - only a well-formed name in a well-formed folder', () => {
  it('joins the image key and the object name', () => {
    expect(customArtPath({ image_key: KEY, custom_art: ART })).toBe(`${KEY}/${ART}`)
  })

  it.each([
    ['no custom art', { image_key: KEY, custom_art: null }],
    ['no image key', { image_key: null, custom_art: ART }],
    ['a path in the name', { image_key: KEY, custom_art: `../${ART}` }],
    ['a rendered object, not custom art', { image_key: KEY, custom_art: 'invite-v2-a1d9.jpg' }],
    ['a png', { image_key: KEY, custom_art: 'custom-0123abcd.png' }],
    ['a short key', { image_key: 'abc', custom_art: ART }],
    ['a key with a slash', { image_key: `${KEY.slice(0, 31)}/`, custom_art: ART }],
  ])('null for %s', (_label, row) => {
    expect(customArtPath(row)).toBeNull()
  })

  it('the pattern is the one migration 073 CHECKs', () => {
    expect(CUSTOM_ART_OBJECT.source).toBe('^custom-[0-9a-f]{8,32}\\.jpg$')
  })

  it('the public URL is in the evites bucket, and absent without a Supabase URL', () => {
    expect(customArtUrl(`${KEY}/${ART}`, 'https://x.supabase.co/')).toBe(`https://x.supabase.co/storage/v1/object/public/evites/${KEY}/${ART}`)
    expect(customArtUrl(`${KEY}/${ART}`, undefined)).toBeNull()
  })
})

describe('custom is never a gallery design', () => {
  it('is not registered, so no picker, admin override or templateFor reaches it', () => {
    expect(isKnownTemplateSlug('custom')).toBe(false)
    expect(isGallerySlug('custom')).toBe(false)
    expect(TEMPLATE_SLUGS).not.toContain('custom')
    expect(galleryTemplates().map((t) => t.slug)).not.toContain('custom')
    expect(templateFor('custom')).toBe(PLAIN_TEMPLATE)
  })

  it('a custom template draws the picture and nothing on it', () => {
    const t = customTemplate('k/custom-0123abcd.jpg')
    expect(t.slug).toBe('custom')
    expect(t.slots).toEqual([])
    expect(t.layers).toEqual([])
    expect(t.label).toBeUndefined()
    expect(t.background).toEqual({ web: 'k/custom-0123abcd.jpg', raster: 'k/custom-0123abcd.jpg' })
    // The share card must not need art read from public/: it draws a gradient beside the portrait.
    expect(t.ogCard.backdrop).toBeTruthy()
  })
})

describe('inviteFacts with custom art', () => {
  it('outranks the host pick, the admin override and the theme', () => {
    const f = factsFor({ image_key: KEY, custom_art: ART, template_choice: 'unicorn', theme_word: 'SWIFTIE', template_slug: 'stitch' })
    expect(f.templateSlug).toBe('custom')
    expect(f.customArt).toBe(`${KEY}/${ART}`)
    expect(templateForFacts(f).slug).toBe('custom')
    expect(templateForFacts(f, 'https://x.supabase.co').background.web).toBe(`https://x.supabase.co/storage/v1/object/public/evites/${KEY}/${ART}`)
  })

  it('without it, nothing changes: same design, null customArt', () => {
    const f = factsFor({ image_key: KEY, template_choice: 'unicorn' })
    expect(f.customArt).toBeNull()
    expect(f.templateSlug).toBe('unicorn')
    expect(templateForFacts(f).slug).toBe('unicorn')
  })

  it('a malformed value is ignored, never drawn', () => {
    const f = factsFor({ image_key: KEY, custom_art: '../../etc.jpg' })
    expect(f.customArt).toBeNull()
    expect(f.templateSlug).not.toBe('custom')
  })

  it('the words a guest reads around the picture still come from the party', () => {
    const f = factsFor({ image_key: KEY, custom_art: ART, host_contact_name: 'Kristin', host_contact_phone: '631-555-0100' })
    expect(f.title).toMatch(/^Mia's /)
    expect(f.hostContactLine).toContain('Ask Kristin')
  })
})

describe('the render hash', () => {
  it('is UNCHANGED for an invitation without custom art (adding the key must not re-render every invitation)', () => {
    const f = factsFor()
    const { customArt: _omit, ...withoutKey } = f
    expect(renderInputsHash(f)).toBe(renderInputsHash({ ...withoutKey, customArt: undefined } as never))
  })

  it('moves when custom art is set, and again when it is replaced', () => {
    const plain = renderInputsHash(factsFor({ image_key: KEY }))
    const a = renderInputsHash(factsFor({ image_key: KEY, custom_art: ART }))
    const b = renderInputsHash(factsFor({ image_key: KEY, custom_art: 'custom-ffff0000.jpg' }))
    expect(new Set([plain, a, b]).size).toBe(3)
  })
})

describe('renderEvite with custom art', () => {
  type G = typeof globalThis & { fetch?: unknown }
  const g = globalThis as G
  const realFetch = g.fetch
  const savedPages = process.env.EVITES_PAGES
  let fetchSpy: jest.Mock

  beforeEach(() => {
    process.env.EVITES_PAGES = 'on'
    fetchSpy = jest.fn(() => {
      throw new Error('NETWORK CALL BLOCKED')
    })
    g.fetch = fetchSpy
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled()
    g.fetch = realFetch
    jest.restoreAllMocks()
    if (savedPages === undefined) delete process.env.EVITES_PAGES
    else process.env.EVITES_PAGES = savedPages
  })

  /** A solid magenta picture, deliberately the WRONG size, so the render has to fit it. */
  const art = () => sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#e0218a' } }).jpeg().toBuffer()

  it('draws the stored picture as the whole invitation, from Storage and nowhere else', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor({ evite: { image_key: KEY, custom_art: ART } }) })
    db.uploaded.set(`evites/${KEY}/${ART}`, await art())
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
    if (out.kind !== 'rendered') return

    const invite = db.uploaded.get(`evites/${KEY}/${out.inviteObject}`) as Buffer
    const meta = await sharp(invite).metadata()
    expect([meta.width, meta.height]).toEqual([1085, 1530])
    // The centre is the art's magenta: no template text was drawn over it.
    const { data } = await sharp(invite).extract({ left: 500, top: 700, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    expect(Math.abs(data[0] - 0xe0)).toBeLessThan(12)
    expect(Math.abs(data[1] - 0x21)).toBeLessThan(12)
    expect(Math.abs(data[2] - 0x8a)).toBeLessThan(12)
    expect(out.ogBytes).toBeLessThan(300_000)
  })

  it('a missing object FAILS the render (the old picture stays); it never falls back to another design', async () => {
    const db = makeFakeEviteDb({
      tables: tablesFor({ evite: { image_key: KEY, custom_art: ART, invite_object: 'invite-v1-aaaa.jpg', og_object: 'og-v1-aaaa.jpg', render_version: 1 } }),
    })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW, force: true })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/^custom-art-unreadable/)
    expect(db.uploads).toHaveLength(0)
    const row = db.tables.evites[0] as Record<string, unknown>
    expect(row.invite_object).toBe('invite-v1-aaaa.jpg')
    expect(row.render_claim).toBeNull()
  })
})
