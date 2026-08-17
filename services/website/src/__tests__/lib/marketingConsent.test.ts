/**
 * Tests for consent helpers (src/lib/marketing/consent.ts).
 * Covers: markReleaseSigned flips status + is idempotent; releasesAllSigned
 * gate helper is default-deny and requires every attached release signed.
 */

jest.mock('@/lib/signwell', () => ({
  fetchSignedPdfUrl: jest.fn().mockResolvedValue('https://signwell.example/signed.pdf'),
  createEmbeddedDocument: jest.fn(),
}))

import { markReleaseSigned, releasesAllSigned } from '@/lib/marketing/consent'

function makeSupabase(opts: { release?: any; releaseList?: any[]; updateError?: any }) {
  const updates: any[] = []
  const ledgerInserts: any[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'eq', 'in'].forEach(m => (c[m] = jest.fn(() => c)))
    c.maybeSingle = jest.fn(() => Promise.resolve({ data: opts.release ?? null, error: null }))
    // releasesAllSigned awaits the query after .in(); make the chain thenable.
    if (table === 'consent_releases' && opts.releaseList) {
      const p = Promise.resolve({ data: opts.releaseList, error: null })
      c.then = p.then.bind(p)
      c.catch = p.catch.bind(p)
    }
    c.update = jest.fn((patch: any) => {
      updates.push(patch)
      return { eq: jest.fn(() => Promise.resolve({ error: opts.updateError ?? null })) }
    })
    c.insert = jest.fn((payload: any) => {
      if (table === 'marketing_ledger') ledgerInserts.push(payload)
      return Promise.resolve({ error: null })
    })
    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, updates, ledgerInserts }
}

describe('markReleaseSigned', () => {
  it('flips a sent release to signed and ledgers the transition', async () => {
    const { supabase, updates, ledgerInserts } = makeSupabase({ release: { id: 'r1', status: 'sent' } })
    const changed = await markReleaseSigned(supabase, 'doc-1')
    expect(changed).toBe(true)
    expect(updates[0]).toMatchObject({ status: 'signed', signed_pdf_url: 'https://signwell.example/signed.pdf' })
    expect(ledgerInserts[0]).toMatchObject({ action: 'transition', to_status: 'signed' })
  })

  it('is idempotent — an already-signed release is a no-op', async () => {
    const { supabase, updates } = makeSupabase({ release: { id: 'r1', status: 'signed' } })
    const changed = await markReleaseSigned(supabase, 'doc-1')
    expect(changed).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('returns false when no release matches the document id', async () => {
    const { supabase } = makeSupabase({ release: null })
    expect(await markReleaseSigned(supabase, 'doc-x')).toBe(false)
  })
})

describe('releasesAllSigned (gate helper)', () => {
  it('is default-deny for an empty/absent list', async () => {
    const { supabase } = makeSupabase({})
    expect(await releasesAllSigned(supabase, [])).toBe(false)
    expect(await releasesAllSigned(supabase, null)).toBe(false)
  })

  it('is true only when every attached release is signed', async () => {
    const both = makeSupabase({ releaseList: [{ id: 'a', status: 'signed' }, { id: 'b', status: 'signed' }] })
    expect(await releasesAllSigned(both.supabase, ['a', 'b'])).toBe(true)

    const one = makeSupabase({ releaseList: [{ id: 'a', status: 'signed' }, { id: 'b', status: 'sent' }] })
    expect(await releasesAllSigned(one.supabase, ['a', 'b'])).toBe(false)
  })

  it('is false when an attached id is missing from the DB', async () => {
    const { supabase } = makeSupabase({ releaseList: [{ id: 'a', status: 'signed' }] })
    expect(await releasesAllSigned(supabase, ['a', 'b'])).toBe(false)
  })
})
