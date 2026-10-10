import { makeSendDb } from '../../helpers/sendFixtures'
import { emailSuppressed } from '@/lib/evites/suppression'

/** `emailSuppressed` (spec §9.2): suppressed | clear | unavailable. */

const contact = (id: string, email: string, createdAt = '2026-01-01T00:00:00Z', over: Record<string, unknown> = {}) => ({
  id,
  email,
  email_opt_in: false,
  status: 'lead',
  created_at: createdAt,
  ...over,
})
const interaction = (contactId: string, type: string, metadata: Record<string, unknown> = {}) => ({ id: `i-${contactId}-${type}-${JSON.stringify(metadata)}`, contact_id: contactId, type, metadata, created_at: '2026-02-01T00:00:00Z' })

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('emailSuppressed', () => {
  it('an address nobody has ever used is clear', async () => {
    const db = makeSendDb()
    expect(await emailSuppressed(db.supabase, 'new@example.com')).toBe('clear')
  })

  it('a known contact with no unsubscribe or hard bounce is clear (email_opt_in=false is "never asked", not "no")', async () => {
    const db = makeSendDb({ contacts: [contact('c1', 'pat@example.com', undefined, { email_opt_in: false, status: 'lead' })], interactions: [interaction('c1', 'email_sent'), interaction('c1', 'email_opened')] })
    expect(await emailSuppressed(db.supabase, 'pat@example.com')).toBe('clear')
  })

  it('an email_unsubscribed interaction suppresses', async () => {
    const db = makeSendDb({ contacts: [contact('c1', 'pat@example.com')], interactions: [interaction('c1', 'email_unsubscribed', { source: 'unsubscribe_link' })] })
    expect(await emailSuppressed(db.supabase, 'pat@example.com')).toBe('suppressed')
  })

  it('a HARD bounce suppresses; a SOFT bounce does not', async () => {
    const hard = makeSendDb({ contacts: [contact('c1', 'pat@example.com')], interactions: [interaction('c1', 'email_bounced', { bounce_type: 'hard' })] })
    expect(await emailSuppressed(hard.supabase, 'pat@example.com')).toBe('suppressed')
    const soft = makeSendDb({ contacts: [contact('c1', 'pat@example.com')], interactions: [interaction('c1', 'email_bounced', { bounce_type: 'soft' }), interaction('c1', 'email_bounced', { bounce_type: 'soft' })] })
    expect(await emailSuppressed(soft.supabase, 'pat@example.com')).toBe('clear')
  })

  it('matches case-insensitively, and an unsubscribe on ANY of the duplicated contact rows counts', async () => {
    const db = makeSendDb({
      contacts: [contact('c1', 'pat@example.com', '2026-01-01T00:00:00Z'), contact('c2', 'Pat@Example.com', '2026-03-01T00:00:00Z')],
      interactions: [interaction('c2', 'email_unsubscribed')],
    })
    expect(await emailSuppressed(db.supabase, 'PAT@example.COM')).toBe('suppressed')
  })

  it("somebody else's unsubscribe does not suppress this address", async () => {
    const db = makeSendDb({
      contacts: [contact('c1', 'pat@example.com'), contact('c9', 'other@example.com')],
      interactions: [interaction('c9', 'email_unsubscribed'), interaction('c9', 'email_bounced', { bounce_type: 'hard' })],
    })
    expect(await emailSuppressed(db.supabase, 'pat@example.com')).toBe('clear')
  })

  it('a failed contact lookup is `unavailable`, never clear', async () => {
    const db = makeSendDb({ contacts: [contact('c1', 'pat@example.com')] })
    db.errors.push({ table: 'contacts', op: 'select', message: 'down' })
    expect(await emailSuppressed(db.supabase, 'pat@example.com')).toBe('unavailable')
  })

  it('a failed interactions read is `unavailable`, never clear (either read)', async () => {
    const first = makeSendDb({ contacts: [contact('c1', 'pat@example.com')] })
    first.errors.push({ table: 'contact_interactions', op: 'select', times: 1, message: 'down' })
    expect(await emailSuppressed(first.supabase, 'pat@example.com')).toBe('unavailable')

    const second = makeSendDb({ contacts: [contact('c1', 'pat@example.com')] })
    // let the unsubscribe read succeed and fail the bounce read
    let reads = 0
    second.errors.push({ table: 'contact_interactions', op: 'select', message: 'down', when: () => ++reads === 2 })
    expect(await emailSuppressed(second.supabase, 'pat@example.com')).toBe('unavailable')
  })
})
