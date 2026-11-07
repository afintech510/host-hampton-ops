/**
 * Crew texts carry /s/ short links (Adam, 2026-11-07): every segment is billed, and a party link is
 * 60 characters. The stored text, the email and the in-app copy keep the full address; only what
 * Quo is handed is shortened, and a link that could not be shortened goes out whole.
 */
import fs from 'fs'
import path from 'path'
import { shortenCrewLinks, CREW_SHORT_LINK_TTL_MS } from '@/lib/crew/smsLinks'
import { smsSegmentInfo } from '@/lib/smsSegments'
import { templates } from '@/lib/crew/templates'
import { isAllowedTarget } from '@/lib/shortLink'

const NOW = new Date('2026-11-07T15:00:00Z')
const PARTY_URL = 'https://www.hosthampton.com/crew/parties/3d698615-e3e7-4d37-ae2f-6e815c11e3ba'

/** A Supabase stand-in that records every short_links insert, or fails them on request. */
function fakeDb(mode: 'ok' | 'error' | 'throw' = 'ok') {
  const inserted: Record<string, any>[] = []
  const sb = {
    from(table: string) {
      return {
        insert: async (row: Record<string, any>) => {
          if (table !== 'short_links') throw new Error(`unexpected table ${table}`)
          if (mode === 'throw') throw new Error('boom')
          if (mode === 'error') return { error: { message: 'down' } }
          inserted.push(row)
          return { error: null }
        },
      }
    },
  } as any
  return { sb, inserted }
}

const ENV = { ...process.env }
beforeEach(() => { process.env = { ...ENV, REVIEW_LINK_SIGNING_SECRET: 'test-secret-for-short-links', NEXT_PUBLIC_SITE_URL: 'https://www.hosthampton.com' } })
afterAll(() => { process.env = ENV })

describe('shortenCrewLinks', () => {
  it('turns our own link into a short /s/ link that is a third shorter, and stores where it points', async () => {
    const { sb, inserted } = fakeDb()
    const out = await shortenCrewLinks(sb, `Details: ${PARTY_URL}`, NOW)
    const short = out.replace('Details: ', '')
    expect(short).toMatch(/^https:\/\/hosthampton\.com\/s\/[A-Za-z0-9_-]{22}$/)
    expect(short.length).toBeLessThan(PARTY_URL.length / 1.5)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ target: PARTY_URL, kind: 'crew' })
    // Only the HASH of the code is stored: the table cannot rebuild a working link.
    expect(JSON.stringify(inserted[0])).not.toContain(short.split('/s/')[1])
    expect(new Date(inserted[0].expires_at).getTime() - NOW.getTime()).toBe(CREW_SHORT_LINK_TTL_MS)
  })

  it('keeps the sentence\'s own punctuation out of the link', async () => {
    const { sb, inserted } = fakeDb()
    const out = await shortenCrewLinks(sb, `See ${PARTY_URL}.`, NOW)
    expect(out).toMatch(/^See https:\/\/hosthampton\.com\/s\/[A-Za-z0-9_-]{22}\.$/)
    expect(inserted[0].target).toBe(PARTY_URL)
  })

  it('shortens every distinct link in a text once each, a calendar link as well as the party link', async () => {
    const { sb, inserted } = fakeDb()
    const cal = 'https://www.hosthampton.com/crew/cal/abc.def_ghi-123'
    const out = await shortenCrewLinks(sb, `You're on it. Details: ${PARTY_URL} Add to your calendar: ${cal} Again: ${PARTY_URL}`, NOW)
    expect(inserted.map(r => r.target).sort()).toEqual([cal, PARTY_URL].sort())
    expect(out).not.toContain('/crew/parties/')
    expect(out).not.toContain('/crew/cal/')
    expect(out.match(/\/s\//g)).toHaveLength(3)
  })

  it('leaves alone what is not ours: another site, a bare domain, a /s/ link that already is one, and text with no link', async () => {
    const { sb, inserted } = fakeDb()
    const text = 'Go to https://example.com/x or hosthampton.com/crew/login or https://hosthampton.com/s/AAAAAAAAAAAAAAAAAAAAAA now'
    expect(await shortenCrewLinks(sb, text, NOW)).toBe(text)
    expect(await shortenCrewLinks(sb, 'Nothing to click here.', NOW)).toBe('Nothing to click here.')
    expect(inserted).toHaveLength(0)
  })

  it('a link that cannot be shortened goes out WHOLE: a failed insert, a throw, or no secret never loses the link', async () => {
    for (const mode of ['error', 'throw'] as const) {
      const { sb } = fakeDb(mode)
      expect(await shortenCrewLinks(sb, `Details: ${PARTY_URL}`, NOW)).toBe(`Details: ${PARTY_URL}`)
    }
    delete process.env.REVIEW_LINK_SIGNING_SECRET
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    const { sb, inserted } = fakeDb()
    expect(await shortenCrewLinks(sb, `Details: ${PARTY_URL}`, NOW)).toBe(`Details: ${PARTY_URL}`)
    expect(inserted).toHaveLength(0)
  })

  it('only ever points at our own host (the /s/ route re-screens it as well)', () => {
    expect(isAllowedTarget(PARTY_URL)).toBe(true)
    expect(isAllowedTarget('https://www.hosthampton.com.evil.test/crew')).toBe(false)
  })
})

describe('what it saves on a real text', () => {
  it('the assignment text, with a party link and a calendar link, is ONE segment once both are short (it was two)', async () => {
    const cal = `https://www.hosthampton.com/crew/cal/${'x'.repeat(90)}`
    const ref = { theme: 'Glow Party', dayLabel: 'Sat Nov 14', timeLabel: '12-3 PM', shiftLabel: '11:30 AM-3:30 PM', url: PARTY_URL, calUrl: cal } as any
    const full = templates.assignedByManager(ref).sms
    const { sb } = fakeDb()
    const short = await shortenCrewLinks(sb, full, NOW)
    expect(smsSegmentInfo(full).segments).toBe(2)
    expect(smsSegmentInfo(short).segments).toBe(1)
    expect(short.length).toBeLessThan(full.length - 100)
  })
})

describe('where it is applied', () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8')

  it('every crew text to a member and to the manager is shortened at send time, and the stored copy keeps the full link', () => {
    const notify = read('lib', 'crew', 'notify.ts')
    expect(notify).toMatch(/const shortened = await shortenCrewLinks\(ctx\.sb, text, ctx\.now\)/)
    expect(notify).toMatch(/senders\.sms\(phone, await shortenCrewLinks\(ctx\.sb, body, ctx\.now\)\)/)
    // The in-app and email copies are written from `rendered`, which is never touched.
    expect(notify).not.toMatch(/rendered\.sms = /)
  })

  it('the short-link table accepts the crew kind', () => {
    expect(read('lib', 'shortLink.ts')).toMatch(/ShortLinkKind = 'review' \| 'slack' \| 'portal' \| 'crew'/)
  })
})
