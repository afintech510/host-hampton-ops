import {
  defaultOgImageUrl,
  inviteMetadata,
  invitePageModel,
  longDateText,
  OG_CARD,
  ogImageUrl,
  PREVIEW_NOTE,
  ribbonFor,
  unavailableMetadata,
} from '@/lib/evites/pageModel'
import { inviteFacts } from '@/lib/evites/facts'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from '../../helpers/eviteFixtures'

const KEY = 'a'.repeat(32)
const SUPA = 'https://proj.supabase.co'

const factsFor = (state: Parameters<typeof inviteFacts>[4], evite: Record<string, unknown> = {}, booking: Record<string, unknown> = {}) =>
  inviteFacts(bookingRow(booking) as never, evitesRow(evite) as never, LINE_ITEM_ROWS, THEME_ROWS, state)

describe('ribbons (spec §4 copy per state)', () => {
  it('live has none; the other three say exactly what the spec says', () => {
    expect(ribbonFor('live')).toBeNull()
    expect(ribbonFor('preview')).toEqual({ text: 'Preview', note: 'RSVPs open once the party is booked', tone: 'preview' })
    expect(ribbonFor('needs_time')).toEqual({ text: 'Time coming soon', note: null, tone: 'soon' })
    expect(ribbonFor('closed')?.text).toBe('This party has happened \u{1F389}')
    expect(PREVIEW_NOTE).toBe('RSVPs open once the party is booked')
  })

  it('RSVP is offered only when live', () => {
    for (const s of ['preview', 'needs_time', 'closed'] as const) expect(invitePageModel(s, factsFor(s)).showRsvp).toBe(false)
    expect(invitePageModel('live', factsFor('live')).showRsvp).toBe(true)
  })
})

describe('the page model', () => {
  it('carries the facts as text, the host notes, and the formatted deadline', () => {
    const f = factsFor('live', { host_note: 'Wear something that glows!', gift_note: 'No gifts please', rsvp_deadline: '2026-11-08' })
    const m = invitePageModel('live', f)
    expect(m.details.dateLine).toBe('Saturday, November 14 · 2–4 PM')
    expect(m.details.placeLine).toContain('Host Hampton')
    expect(m.details.hostContactLine).toContain('Ask Allie')
    expect(m.hostNote).toBe('Wear something that glows!')
    expect(m.giftNote).toBe('No gifts please')
    expect(m.rsvpByText).toBe('Sunday, November 8')
  })

  it('has nothing in it that could be an RSVP count (D15)', () => {
    const m = invitePageModel('live', factsFor('live'))
    expect(Object.keys(m).sort()).toEqual(['details', 'giftNote', 'hostNote', 'ribbon', 'rsvpByText', 'showRsvp', 'state'])
    expect(JSON.stringify(m)).not.toMatch(/count|going|attending|replied|responded/i)
  })

  it('a preview reads "Pick your date"; a closed party shows no RSVP-by line', () => {
    expect(invitePageModel('preview', factsFor('preview')).details.dateLine).toBe('Pick your date')
    expect(invitePageModel('closed', factsFor('closed', { rsvp_deadline: '2026-11-08' })).rsvpByText).toBeNull()
  })

  it('formats a deadline in Eastern time, never via the UTC box clock', () => {
    expect(longDateText('2026-11-01')).toBe('Sunday, November 1') // DST ends this day
    expect(longDateText('2026-03-08')).toBe('Sunday, March 8') // DST starts this day
    expect(longDateText('garbage')).toBeNull()
  })
})

describe('the share card URL (spec §5 "OG metadata")', () => {
  it('points at the stored object under the independent key', () => {
    expect(ogImageUrl({ image_key: KEY, og_object: 'og-v3-9f2c.jpg' }, SUPA)).toBe(`${SUPA}/storage/v1/object/public/evites/${KEY}/og-v3-9f2c.jpg`)
    expect(ogImageUrl({ image_key: KEY, og_object: 'og-v3-9f2c.jpg' }, `${SUPA}/`)).toBe(`${SUPA}/storage/v1/object/public/evites/${KEY}/og-v3-9f2c.jpg`)
  })

  it('falls back to the static card, absolute against the CANONICAL origin, before a render exists', () => {
    expect(defaultOgImageUrl()).toBe(`${CANONICAL_ORIGIN}/images/og-default.png`)
    expect(ogImageUrl({ image_key: null, og_object: null }, SUPA)).toBe(defaultOgImageUrl())
    expect(ogImageUrl({ image_key: KEY, og_object: null }, SUPA)).toBe(defaultOgImageUrl())
    expect(ogImageUrl({ image_key: KEY, og_object: 'og-v3-9f2c.jpg' }, undefined)).toBe(defaultOgImageUrl())
  })

  it('refuses names the renderer never writes', () => {
    expect(ogImageUrl({ image_key: 'short', og_object: 'og-v3-9f2c.jpg' }, SUPA)).toBe(defaultOgImageUrl())
    expect(ogImageUrl({ image_key: KEY, og_object: '../../x.jpg' }, SUPA)).toBe(defaultOgImageUrl())
    expect(ogImageUrl({ image_key: KEY, og_object: 'og-v3-9f2c.jpg?x=1' }, SUPA)).toBe(defaultOgImageUrl())
  })

  it('the static default file exists', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    expect(fs.existsSync(path.join(process.cwd(), 'public', 'images', 'og-default.png'))).toBe(true)
  })
})

describe('inviteMetadata', () => {
  const facts = factsFor('live')
  const md = inviteMetadata('mia-glow-7kq2', { image_key: KEY, og_object: 'og-v3-9f2c.jpg' }, facts, SUPA)
  const og = md.openGraph as NonNullable<typeof md.openGraph>
  const image = (og.images as Array<Record<string, unknown>>)[0]

  it('says noindex, nofollow', () => {
    expect(md.robots).toMatchObject({ index: false, follow: false })
  })

  it('the OG image carries width, height and type, and they match what the renderer writes', () => {
    expect(OG_CARD).toEqual({ width: 1200, height: 630, type: 'image/jpeg' })
    expect(image).toMatchObject({ url: `${SUPA}/storage/v1/object/public/evites/${KEY}/og-v3-9f2c.jpg`, width: 1200, height: 630, type: 'image/jpeg' })
    expect((og.images as unknown[]).length).toBe(1)
  })

  it('title and description come from the facts; the title is absolute (no site suffix)', () => {
    expect(md.title).toEqual({ absolute: facts.title })
    expect(md.description).toBe(facts.description)
    expect(og.title).toBe(facts.title)
    expect(og.description).toBe(facts.description)
    expect(og.url).toBe(`${CANONICAL_ORIGIN}/i/mia-glow-7kq2`)
  })

  it('twitter is the large card and states its own image (it replaces the root layout object)', () => {
    expect(md.twitter).toMatchObject({ card: 'summary_large_image', images: [image.url] })
  })

  it('before a render exists the card is the static default, described honestly as a png', () => {
    const noRender = inviteMetadata('mia-glow-7kq2', { image_key: null, og_object: null }, facts, SUPA)
    const img = ((noRender.openGraph as { images: Array<Record<string, unknown>> }).images)[0]
    expect(img).toMatchObject({ url: defaultOgImageUrl(), width: 1200, height: 630, type: 'image/png' })
  })

  it('is a pure function of the data: nothing in it depends on who is asking', () => {
    expect(inviteMetadata('mia-glow-7kq2', { image_key: KEY, og_object: 'og-v3-9f2c.jpg' }, facts, SUPA)).toEqual(md)
  })

  it('the unavailable head is one fixed value', () => {
    expect(unavailableMetadata()).toEqual(unavailableMetadata())
    expect(unavailableMetadata().robots).toMatchObject({ index: false })
    expect(JSON.stringify(unavailableMetadata())).not.toMatch(/mia|glow/i)
  })
})
