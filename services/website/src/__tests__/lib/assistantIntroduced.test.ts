/**
 * Customer messages introduce us ONCE.
 *
 * "It's Allie from Host Hampton" and the sign-off belong in the first message a
 * person gets; once the thread has said them, every later message just says what it
 * has to say. These pin the three halves: how the thread is judged (`threadHasIntroduced`),
 * what the standard wording becomes when it has, and that a link card for the manager
 * is carried out at once (the link is on the card; it is not kept in the saved chat).
 */
import fs from 'fs'
import path from 'path'

const mockThread = jest.fn()
jest.mock('@/lib/quo', () => ({ fetchQuoThread: (...a: unknown[]) => mockThread(...a) }))

import { TENANT } from '@/tenant'
import { threadHasIntroduced } from '@/lib/assistant/threadIntro'
import { defaultSmsBody, defaultEmailBody } from '@/lib/clientLinks'
import { photosSmsText, photosEmailText, photosEmailHtml } from '@/lib/photoSets'

const NAME = TENANT.people.customerSignoff

type Rows = { data: unknown[] | null; error: unknown }
function fakeDb(tables: Record<string, Rows>) {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'limit']) q[m] = () => q
    q.then = (resolve: (v: Rows) => unknown) => resolve(tables[table] ?? { data: [], error: null })
    return q
  }
  return { from: (t: string) => chain(t) } as never
}
const B = { id: 'bbbbbbbb-0000-4000-8000-0000000000d1', contact_phone: '6315550123' }
const nothing: Rows = { data: [], error: null }

beforeEach(() => mockThread.mockReset().mockResolvedValue({ kind: 'ok', messages: [] }))

describe('threadHasIntroduced', () => {
  it('is true when a recorded outgoing message already named her', async () => {
    const db = fakeDb({ ingested_messages: { data: [{ body: `Hi! It's ${NAME} from the studio` }], error: null } })
    expect(await threadHasIntroduced(db, B)).toBe(true)
  })

  it('is true when a booking-agent reply that was SENT named her, and false for an unsent draft', async () => {
    const sent = fakeDb({ inquiry_drafts: { data: [{ sms_draft: `${NAME} here`, email_draft: null, sent_at: '2026-11-01T00:00:00Z' }], error: null } })
    expect(await threadHasIntroduced(sent, B)).toBe(true)
    const unsent = fakeDb({ inquiry_drafts: { data: [{ sms_draft: `${NAME} here`, email_draft: null, sent_at: null }], error: null } })
    expect(await threadHasIntroduced(unsent, B)).toBe(false)
  })

  it('is true after a dashboard link or photo send, which carried the standard intro', async () => {
    for (const change_summary of ['Links sent to customer: invoice', 'Photos sent to customer (3)', 'Portal link texted', 'Photo album sent']) {
      expect(await threadHasIntroduced(fakeDb({ booking_modifications: { data: [{ change_summary }], error: null } }), B)).toBe(true)
    }
    const other = fakeDb({ booking_modifications: { data: [{ change_summary: 'Guest count sent to 12' }], error: null } })
    expect(await threadHasIntroduced(other, B)).toBe(false)
  })

  it('is true when a text sent by hand in the Quo thread named her; an incoming text naming her does not count', async () => {
    mockThread.mockResolvedValue({ kind: 'ok', messages: [{ direction: 'out', text: `It's ${NAME}!` }] })
    expect(await threadHasIntroduced(fakeDb({}), B)).toBe(true)
    mockThread.mockResolvedValue({ kind: 'ok', messages: [{ direction: 'in', text: `Hi ${NAME}!` }] })
    expect(await threadHasIntroduced(fakeDb({}), B)).toBe(false)
  })

  it('is false when everything was read and said nothing, and null when something could not be read', async () => {
    expect(await threadHasIntroduced(fakeDb({}), B)).toBe(false)
    expect(await threadHasIntroduced(fakeDb({ ingested_messages: { data: null, error: { message: 'x' } } }), B)).toBeNull()
    mockThread.mockResolvedValue({ kind: 'unavailable' })
    expect(await threadHasIntroduced(fakeDb({}), B)).toBeNull()
  })

  it('does not ask Quo at all for a booking with no phone', async () => {
    await threadHasIntroduced(fakeDb({ ingested_messages: nothing }), { ...B, contact_phone: null })
    expect(mockThread).not.toHaveBeenCalled()
  })
})

describe('the standard wording once the thread has introduced her', () => {
  const booking = { contact_name: 'Pat Example', child_name: 'Sam', booking_ref: 'HH-PTY-INT01' } as never

  it('first message keeps the intro and sign-off', () => {
    const sms = defaultSmsBody(booking, ['planner'])
    expect(sms).toContain(`It's ${NAME} from Host Hampton`)
    expect(defaultEmailBody(booking, ['planner'])).toContain(`${NAME}\nHost Hampton`)
  })

  it('a later message has no intro, no sign-off and no business name', () => {
    const sms = defaultSmsBody(booking, ['planner'], { introduced: true })
    const email = defaultEmailBody(booking, ['planner'], { introduced: true })
    for (const text of [sms, email]) {
      expect(text).not.toContain(NAME)
      expect(text).not.toContain('Host Hampton')
    }
    expect(sms).toMatch(/^Hi Pat!/)
  })

  it('photo messages follow the same rule', () => {
    const photos = [{ url: 'https://example.com/a.jpg', alt: 'a' }] as never
    for (const text of [
      photosSmsText('Pat', 'https://example.com/p', 1, true),
      photosEmailText('Pat', photos, 'https://example.com/p', true),
      photosEmailHtml('Pat', photos, 'https://example.com/p', true),
    ]) {
      expect(text).not.toContain(NAME)
      expect(text).not.toContain('Host Hampton')
    }
    expect(photosSmsText('Pat', 'https://example.com/p', 1, false)).toContain(NAME)
    expect(photosEmailText('Pat', photos, 'https://example.com/p', false)).toContain(NAME)
  })
})

describe('a link card for the manager is carried out at once', () => {
  const root = path.resolve(__dirname, '../..')
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

  it('the chat route claims and executes party_link cards, and only those', () => {
    const src = read('app/api/admin/assistant/route.ts')
    expect(src).toMatch(/card\.kind !== 'party_link'\) continue/)
    expect(src).toContain('claimProposal(supabase, verified.proposal)')
    expect(src).toContain('executeProposal(req, verified.proposal)')
    expect(src.match(/executeProposal\(/g)).toHaveLength(1)
  })

  it('the link goes back to the browser and is not written into the saved thread', () => {
    const src = read('app/api/admin/assistant/route.ts')
    const save = src.indexOf('writeThread(supabase')
    const respond = src.indexOf('linksFor.has(c.id)')
    expect(save).toBeGreaterThan(-1)
    expect(respond).toBeGreaterThan(save)
    // the saved lines take `cards` (no links); only the response copies add them
    expect(src.slice(0, save)).not.toMatch(/card\.links\s*=/)
  })

  it('the tool tells the model the link is on the card and not to write it or ask for Confirm', () => {
    const src = read('lib/assistant/tools.ts')
    expect(src).toContain("status: 'link_shown_on_card'")
    expect(src).toMatch(/Do NOT write the link yourself/)
  })
})
