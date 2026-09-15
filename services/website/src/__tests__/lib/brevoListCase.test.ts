/**
 * Brevo's list add/remove endpoints match `emails: []` CASE-SENSITIVELY against
 * addresses it stores lowercased.
 *
 * Measured against the live API on 2026-09-15 while backfilling the marketing
 * list: `Nitai.Finkelstein@gmail.com`, `Michaela.J.Manning@gmail.com` and
 * `haleyBelmonte94@gmail.com` each came back
 * 400 `"Contact already in list and/or does not exist"`. A `GET /contacts/{email}`
 * proved BOTH halves of that message false — all three existed, none was
 * blacklisted, `listIds` was `[]`. Retried lowercased: 201, all three.
 *
 * `removeFromList` is the direction that matters: a removal matching nothing
 * leaves a person ON the marketing list while telling the caller it worked.
 */

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

import { addToList, removeFromList } from '@/lib/brevo'

function okOnce() {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 201, text: async () => '{}' })
}
/** The `emails` array actually put on the wire by the last call. */
function sentEmails(): string[] {
  const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  return JSON.parse(init.body).emails
}

describe('Brevo list membership is case-folded before it goes on the wire', () => {
  const OLD = process.env.BREVO_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.BREVO_API_KEY = 'test-key'
  })
  afterAll(() => { process.env.BREVO_API_KEY = OLD })

  // The three real addresses, not invented ones.
  const REAL_MIXED_CASE = [
    'Nitai.Finkelstein@gmail.com',
    'Michaela.J.Manning@gmail.com',
    'haleyBelmonte94@gmail.com',
  ]

  it.each(REAL_MIXED_CASE)('addToList lowercases %s', async (email) => {
    okOnce()
    await expect(addToList(email, 3)).resolves.toBe(true)
    expect(sentEmails()).toEqual([email.toLowerCase()])
  })

  it.each(REAL_MIXED_CASE)('removeFromList lowercases %s', async (email) => {
    okOnce()
    await expect(removeFromList(email, 3)).resolves.toBe(true)
    // The removal must reach the row Brevo actually stores, or the contact
    // stays on the list and the caller is told the removal succeeded.
    expect(sentEmails()).toEqual([email.toLowerCase()])
  })

  it('trims surrounding whitespace too', async () => {
    okOnce()
    await addToList('  Haley@Example.COM \n', 3)
    expect(sentEmails()).toEqual(['haley@example.com'])
  })

  it('leaves an already-lowercase address exactly as it is', async () => {
    okOnce()
    await addToList('plain@gmail.com', 3)
    expect(sentEmails()).toEqual(['plain@gmail.com'])
  })

  it('still reports a Brevo refusal as null rather than swallowing it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400,
      text: async () => '{"code":"invalid_parameter","message":"Contact already in list and/or does not exist"}',
    })
    // That message was false on both halves once already — the caller must be
    // able to see the failure, not receive a cheerful `true`.
    await expect(addToList('someone@gmail.com', 3)).resolves.toBeNull()
  })

  it('targets the list id it was given', async () => {
    okOnce()
    await addToList('someone@gmail.com', 3)
    const [url] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
    expect(String(url)).toContain('/contacts/lists/3/contacts/add')
  })
})
