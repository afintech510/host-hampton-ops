/**
 * Tests for the marketing transition function (src/lib/marketing/graph.ts).
 * Covers: legal/illegal transitions, one ledger row per transition, and the
 * admin-actor gate (ALWAYS_ASK targets require actor.isAdmin).
 */

import {
  advance,
  isLegalTransition,
  isGatedTransition,
  IllegalTransitionError,
  TransitionNotAuthorizedError,
} from '@/lib/marketing/graph'

/**
 * Minimal per-table Supabase mock. from(table) returns a chain; select/eq/
 * single|maybeSingle resolve to `rows[table]`; update/eq resolves {error};
 * insert captures args. Records ledger inserts for assertions.
 */
function makeSupabase(rows: Record<string, any>) {
  const ledgerInserts: any[] = []
  const updates: Record<string, any[]> = {}

  function chain(table: string): any {
    const c: any = {}
    const passthrough = ['select', 'eq', 'neq', 'in', 'not', 'order', 'limit']
    for (const m of passthrough) c[m] = jest.fn(() => c)
    c.single = jest.fn(() => Promise.resolve({ data: rows[table] ?? null, error: rows[table] ? null : { message: 'not found' } }))
    c.maybeSingle = jest.fn(() => Promise.resolve({ data: rows[table] ?? null, error: null }))
    c.update = jest.fn((patch: any) => {
      updates[table] = updates[table] || []
      updates[table].push(patch)
      const u: any = { eq: jest.fn(() => Promise.resolve({ error: rows[`${table}__updateError`] ?? null })) }
      return u
    })
    c.insert = jest.fn((payload: any) => {
      if (table === 'marketing_ledger') ledgerInserts.push(payload)
      return Promise.resolve({ error: null })
    })
    return c
  }

  return {
    supabase: { from: jest.fn((table: string) => chain(table)) } as any,
    ledgerInserts,
    updates,
  }
}

describe('graph transition tables', () => {
  it('marks legal and illegal transitions', () => {
    expect(isLegalTransition('website_content', 'draft', 'pending_review')).toBe(true)
    expect(isLegalTransition('website_content', 'draft', 'published')).toBe(false)
    expect(isLegalTransition('marketing_task', 'pending_review', 'approved')).toBe(true)
    expect(isLegalTransition('marketing_task', 'done', 'approved')).toBe(false)
  })

  it('flags gated (admin-only) targets', () => {
    expect(isGatedTransition('website_content', 'published')).toBe(true)
    expect(isGatedTransition('website_content', 'approved')).toBe(true)
    expect(isGatedTransition('website_content', 'pending_review')).toBe(false)
    expect(isGatedTransition('marketing_task', 'approved')).toBe(true)
  })
})

describe('advance()', () => {
  it('performs a legal non-gated transition and writes exactly one ledger row', async () => {
    const { supabase, ledgerInserts, updates } = makeSupabase({ website_content: { status: 'draft' } })

    const res = await advance({
      entity: 'website_content',
      id: 'c1',
      to: 'pending_review',
      actor: { id: 'cron' },
      supabase,
    })

    expect(res).toEqual({ from: 'draft', to: 'pending_review' })
    expect(updates.website_content?.[0]).toMatchObject({ status: 'pending_review' })
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0]).toMatchObject({
      entity_type: 'website_content',
      action: 'transition',
      from_status: 'draft',
      to_status: 'pending_review',
      actor: 'cron',
    })
  })

  it('throws IllegalTransitionError and writes NO ledger row for an illegal edge', async () => {
    const { supabase, ledgerInserts } = makeSupabase({ website_content: { status: 'draft' } })

    await expect(
      advance({ entity: 'website_content', id: 'c1', to: 'published', actor: { id: 'admin', isAdmin: true }, supabase })
    ).rejects.toBeInstanceOf(IllegalTransitionError)

    expect(ledgerInserts).toHaveLength(0)
  })

  it('refuses a gated transition when the actor is not an admin', async () => {
    const { supabase, ledgerInserts } = makeSupabase({ website_content: { status: 'approved' } })

    await expect(
      advance({ entity: 'website_content', id: 'c1', to: 'published', actor: { id: 'cron' }, supabase })
    ).rejects.toBeInstanceOf(TransitionNotAuthorizedError)

    expect(ledgerInserts).toHaveLength(0)
  })

  it('allows a gated transition for an admin actor', async () => {
    const { supabase, ledgerInserts } = makeSupabase({ website_content: { status: 'approved' } })

    const res = await advance({
      entity: 'website_content',
      id: 'c1',
      to: 'published',
      actor: { id: 'admin', isAdmin: true },
      supabase,
    })

    expect(res.to).toBe('published')
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0].to_status).toBe('published')
  })

  it('is an idempotent no-op when already at the target status', async () => {
    const { supabase, ledgerInserts } = makeSupabase({ marketing_tasks: { status: 'approved' } })

    const res = await advance({ entity: 'marketing_task', id: 't1', to: 'approved', actor: { id: 'admin', isAdmin: true }, supabase })

    expect(res).toEqual({ from: 'approved', to: 'approved' })
    expect(ledgerInserts).toHaveLength(0)
  })

  it('surfaces a DB veto (e.g. consent-gate trigger) and writes no ledger row', async () => {
    const { supabase, ledgerInserts } = makeSupabase({
      website_content: { status: 'approved' },
      website_content__updateError: { message: 'Consent gate: content references child media' },
    })

    await expect(
      advance({ entity: 'website_content', id: 'c1', to: 'published', actor: { id: 'admin', isAdmin: true }, supabase })
    ).rejects.toThrow(/Consent gate/)

    expect(ledgerInserts).toHaveLength(0)
  })

  it('throws on a stale expected-from guard', async () => {
    const { supabase } = makeSupabase({ marketing_tasks: { status: 'draft' } })

    await expect(
      advance({ entity: 'marketing_task', id: 't1', to: 'pending_review', from: 'approved', actor: { id: 'admin', isAdmin: true }, supabase })
    ).rejects.toThrow(/stale transition/)
  })
})
