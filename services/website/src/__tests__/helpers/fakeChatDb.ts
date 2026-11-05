import { randomUUID } from 'crypto'
import { FakeSupabase } from '../lib/fakeSupabase'

/**
 * An in-memory Supabase for the Host Assistant tests: the shared fake plus the
 * column defaults the real `chat_sessions` table (migration 085) fills in, so the
 * code under test sees the same row shape it gets in production.
 */
export class ChatDb extends FakeSupabase {
  constructor() {
    super({})
    this.store.marketing_budget = [
      { id: 'budget-1', month: new Date().toISOString().slice(0, 7), llm_usd_spent: 0, llm_usd_cap: 1000, sms_sent: 0, sms_cap: 500 },
    ]
  }

  from(table: string) {
    const b = super.from(table) as unknown as { insert: (p: Record<string, unknown>) => unknown }
    if (table === 'chat_sessions') {
      const insert = b.insert.bind(b)
      b.insert = (p: Record<string, unknown>) =>
        insert({
          id: randomUUID(),
          status: 'active',
          turn_count: 0,
          spent_usd: 0,
          messages: [],
          expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
          claimed_card_id: null,
          booking_ref: null,
          booking_id: null,
          inquiry_sent_at: null,
          verified_at: null,
          ...p,
        })
    }
    return b as never
  }

  sessions() {
    return this.rows('chat_sessions')
  }
}

/** A session row, as the database would hold it. */
export function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    status: 'active',
    turn_count: 0,
    spent_usd: 0,
    messages: [],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    claimed_card_id: null,
    booking_ref: null,
    booking_id: null,
    inquiry_sent_at: null,
    verified_at: new Date().toISOString(),
    ...over,
  }
}
