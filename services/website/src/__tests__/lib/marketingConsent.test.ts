/**
 * Tests for consent helpers (src/lib/marketing/consent.ts).
 *
 * Covers: markReleaseSigned's FOUR outcomes (signed / already-signed /
 * not-found / unavailable) and that it ledgers the transition; releasesAllSigned
 * is default-deny and requires every attached release signed.
 *
 * The fake below deliberately models `update(...).eq(...).select(...)` returning
 * ROWS rather than just `{error}`. The previous fake returned `{error: null}`
 * from `.eq()` and had no `.select()` at all, so it could not have seen a
 * zero-row update — which is the exact shape of the bug rule 10 is about. A mock
 * that cannot fail the way production fails is a comment asserting correctness.
 */

jest.mock('@/lib/signwell', () => ({
  fetchSignedPdfUrl: jest.fn().mockResolvedValue('https://signwell.example/signed.pdf'),
  createEmbeddedDocument: jest.fn(),
}))

import { markReleaseSigned, releasesAllSigned } from '@/lib/marketing/consent'

function makeSupabase(opts: {
  release?: any
  releaseList?: any[]
  lookupError?: any
  updateError?: any
  /** Rows the UPDATE ... RETURNING hands back. Default: one row. */
  updatedRows?: any[]
}) {
  const updates: any[] = []
  const ledgerInserts: any[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'eq', 'in'].forEach(m => (c[m] = jest.fn(() => c)))
    c.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: opts.lookupError ? null : opts.release ?? null, error: opts.lookupError ?? null })
    )
    // releasesAllSigned awaits the query after .in(); make the chain thenable.
    if (table === 'consent_releases' && opts.releaseList) {
      const p = Promise.resolve({ data: opts.releaseList, error: null })
      c.then = p.then.bind(p)
      c.catch = p.catch.bind(p)
    }
    c.update = jest.fn((patch: any) => {
      updates.push(patch)
      const result = {
        data: opts.updateError ? null : opts.updatedRows ?? [{ id: 'r1' }],
        error: opts.updateError ?? null,
      }
      const u: any = {}
      u.eq = jest.fn(() => u)
      u.select = jest.fn(() => Promise.resolve(result))
      return u
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
    expect(await markReleaseSigned(supabase, 'doc-1')).toEqual({ kind: 'signed' })
    expect(updates[0]).toMatchObject({ status: 'signed', signed_pdf_url: 'https://signwell.example/signed.pdf' })
    expect(ledgerInserts[0]).toMatchObject({ action: 'transition', to_status: 'signed' })
  })

  it('is idempotent — an already-signed release is a no-op', async () => {
    const { supabase, updates } = makeSupabase({ release: { id: 'r1', status: 'signed' } })
    expect(await markReleaseSigned(supabase, 'doc-1')).toEqual({ kind: 'already-signed' })
    expect(updates).toHaveLength(0)
  })

  it('reports not-found when no release matches the document id', async () => {
    const { supabase } = makeSupabase({ release: null })
    expect(await markReleaseSigned(supabase, 'doc-x')).toEqual({ kind: 'not-found' })
  })

  // Rule 12. These two used to be indistinguishable from 'not-found', so the
  // webhook answered 200 to a database outage and SignWell never redelivered.
  it('distinguishes a failed LOOKUP from "no such release"', async () => {
    const { supabase } = makeSupabase({ lookupError: { message: 'statement timeout' } })
    const result = await markReleaseSigned(supabase, 'doc-1')
    expect(result.kind).toBe('unavailable')
    expect(result).toMatchObject({ error: 'statement timeout' })
  })

  it('distinguishes a failed UPDATE from "no such release"', async () => {
    const { supabase } = makeSupabase({
      release: { id: 'r1', status: 'sent' },
      updateError: { message: 'deadlock detected' },
    })
    const result = await markReleaseSigned(supabase, 'doc-1')
    expect(result.kind).toBe('unavailable')
    expect(result).toMatchObject({ error: 'deadlock detected' })
  })

  // Rule 10: the update succeeded and changed nothing. That is not a success.
  it('treats a zero-row update as unavailable, not signed', async () => {
    const { supabase, ledgerInserts } = makeSupabase({
      release: { id: 'r1', status: 'sent' },
      updatedRows: [],
    })
    const result = await markReleaseSigned(supabase, 'doc-1')
    expect(result.kind).toBe('unavailable')
    // And it must NOT have ledgered a transition that did not happen.
    expect(ledgerInserts).toHaveLength(0)
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
