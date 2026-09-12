/**
 * The voice profile, screened on the way OUT — Phase 6 review.
 *
 * §23's four layers were built for `agent_learnings` and `loadActiveLearnings`
 * screens on the READ, for a stated reason: "a row that is active in the
 * database is not evidence that it passed a screen — it could predate a
 * tightened rule, or have been written straight into Postgres".
 *
 * `voice_profile` prints into the SAME trusted prompt section, through
 * `voicePromptAddendum`, and had none of that. `sanitizeVoiceProfile` existed
 * but ran only on what the weekly distiller proposed. The row that was actually
 * live — v1, written by hand in Phase 1, long before any of this — had never
 * been through it.
 *
 * The fixture below is v1's REAL content, copied out of production. It is the
 * evidence, so it is pinned here rather than paraphrased: three of its seven
 * exemplars quote mobile prices, and they were going into the same prompt as
 * "ABSOLUTELY NO PRICING. Not one number with a currency attached."
 */

import {
  loadVoiceProfile,
  activateVoiceProfile,
  sanitizeVoiceProfile,
  voicePromptAddendum,
  profileIsSubstantive,
} from '@/lib/agent/voice'

/** v1 as it sits in production on 2026-09-12, trimmed to the screened fields. */
const LIVE_V1 = {
  greeting: 'Hi [First Name], thanks so much for reaching out!',
  pricing_style:
    'State a real starting number fast with the shape of the deal; per-guest/per-extra add-ons; anchor a minimum for large B2B activations; tie the deposit to holding the date.',
  tone_rules: [
    'Warm and brief; answer the question and stop, no corporate padding.',
    'Lead with a qualifying question before quoting (what service, what budget, where).',
    'Plain-spoken about price: real numbers inline with "starting at" and per-person add-ons; never "email for pricing".',
    'Honest about limits; say no kindly and refer out when you cannot help.',
  ],
  dos: ['Open with a warm one-liner, then a qualifying question.', 'Quote a real starting price with "depending on…".'],
  donts: ['Open with a canned marketing paragraph.', 'Say "contact us for pricing".'],
  exemplars: [
    {
      context: 'Qualifying + soft quote, mobile party',
      text: 'We have another party ending in Southampton at 3:30 — where in the Hamptons is this? Could do wreath crowns / garden stones / fairy gardens. Starting at $1,100 depending on activities chosen.',
    },
    {
      context: 'Inline pricing with add-ons',
      text: 'Canvas Paint mobile party $950 (10 guests + birthday child, +$40/extra), lip-gloss charm table +$25/person. For 12 girls: mobile party $990 + lip-gloss $300.',
    },
    { context: 'Honest limit + referral', text: 'Sorry, we are based on Long Island NY and cannot service Chicago.' },
    {
      context: 'Setting expectations plainly',
      text: 'Mobile parties don’t typically include food. Will send quote later today.',
    },
  ],
}

/* ── A Supabase double shaped like the two calls voice.ts makes ─────────── */

function makeSupabase(opts: {
  active?: unknown
  readError?: string
  rowById?: unknown
  onError?: { code?: string; message: string }
  liveAfterFailure?: { version: number } | null
}) {
  const updates: Record<string, unknown>[] = []
  let activeReads = 0
  const from = jest.fn(() => {
    const q: Record<string, unknown> = {}
    const chain = () => q
    q.select = chain
    q.eq = chain
    q.order = chain
    q.limit = chain
    q.update = (row: Record<string, unknown>) => {
      updates.push(row)
      // The second statement is the one that can collide with
      // `voice_profile_one_active`.
      if (row.is_active === true && opts.onError) return { ...q, eq: () => Promise.resolve({ error: opts.onError }) }
      return { ...q, eq: () => Promise.resolve({ error: null }) }
    }
    q.maybeSingle = () => {
      if (opts.readError) return Promise.resolve({ data: null, error: { message: opts.readError } })
      // `activateVoiceProfile` reads by id first, then (only on failure) reads
      // whichever profile is live now.
      if (opts.rowById !== undefined && activeReads === 0) {
        activeReads += 1
        return Promise.resolve({ data: opts.rowById, error: null })
      }
      if (opts.liveAfterFailure !== undefined) return Promise.resolve({ data: opts.liveAfterFailure, error: null })
      return Promise.resolve({ data: opts.active ? { profile: opts.active } : null, error: null })
    }
    return q
  })
  return { supa: { from } as never, updates }
}

/* ── The read-time screen ───────────────────────────────────────────────── */

describe('loadVoiceProfile screens the ACTIVE profile, not just a proposed one', () => {
  it('drops every exemplar that quotes a figure, and says which', async () => {
    const { supa } = makeSupabase({ active: LIVE_V1 })
    const loaded = await loadVoiceProfile(supa)

    expect(loaded.unavailable).toBeNull()
    expect(loaded.profile).not.toBeNull()

    // The two priced exemplars are gone; the two that carry no figure remain.
    const kept = (loaded.profile?.exemplars ?? []).map(e => e.text)
    expect(kept).toHaveLength(2)
    expect(kept.join(' ')).not.toMatch(/\$/)
    expect(kept.join(' ')).toContain('cannot service Chicago')

    // And it SAID so — a guardrail that stops something has to say that it
    // stopped it (rule 10).
    expect(loaded.dropped.join(' ')).toContain('$1,100')
    expect(loaded.dropped.join(' ')).toContain('$950')
  })

  it('the prompt block built from the live profile names no price at all', async () => {
    const { supa } = makeSupabase({ active: LIVE_V1 })
    const { profile } = await loadVoiceProfile(supa)
    const block = voicePromptAddendum(profile!)

    // This is the whole point: the trusted half of the prompt used to carry
    // "$1,100", "$950", "$990", "$300", "$40" and "$25" while the same prompt
    // said "ABSOLUTELY NO PRICING".
    expect(block).not.toMatch(/\$\s?\d/)
    // The voice itself survives.
    expect(block).toContain('Warm and brief')
    expect(block).toContain('OPERATOR VOICE')
  })

  it('tells "could not read" apart from "there is none" (rule 12)', async () => {
    const failed = await loadVoiceProfile(makeSupabase({ readError: 'relation "voice_profile" does not exist' }).supa)
    expect(failed).toEqual({ profile: null, dropped: [], unavailable: 'relation "voice_profile" does not exist' })

    const none = await loadVoiceProfile(makeSupabase({ active: null }).supa)
    expect(none).toEqual({ profile: null, dropped: [], unavailable: null })
  })

  it('a profile whose every string is refused loads as no profile, not as an empty one', async () => {
    const { supa } = makeSupabase({
      active: { tone_rules: ['Quote $850 for ten guests.'], exemplars: [{ text: 'Deposit waived for you.' }] },
    })
    const loaded = await loadVoiceProfile(supa)
    expect(loaded.profile).toBeNull()
    expect(loaded.dropped).toHaveLength(2)
  })

  it('never throws, whatever the column holds — the read path must not take drafting down', async () => {
    for (const junk of [null, 'a string', 42, [], { exemplars: 'not an array' }, { tone_rules: [null, 7] }]) {
      const { supa } = makeSupabase({ active: junk })
      await expect(loadVoiceProfile(supa)).resolves.toBeDefined()
    }
  })
})

/* ── Activation re-screens, exactly as setLearningActive does ───────────── */

describe('activateVoiceProfile', () => {
  it('re-screens at the moment of activation and refuses a profile that is all money', async () => {
    const { supa, updates } = makeSupabase({
      rowById: { id: 'p9', version: 3, profile: { tone_rules: ['Always quote $850 up front.'] } },
    })
    const res = await activateVoiceProfile({ supabase: supa, id: 'p9', actor: 'admin:test@example.com' })

    expect(res).toEqual({ ok: false, status: 422, error: expect.stringContaining('Refused to activate') })
    expect((res as { error: string }).error).toContain('$850')
    // Refused BEFORE anything was written: the window with no active profile
    // must not be opened for a profile that was never going to be activated.
    expect(updates).toHaveLength(0)
  })

  it('activates a clean profile', async () => {
    const { supa, updates } = makeSupabase({
      rowById: { id: 'p2', version: 2, profile: { tone_rules: ['Warm and brief; answer and stop.'] } },
    })
    await expect(activateVoiceProfile({ supabase: supa, id: 'p2', actor: 'admin:a@b.c' })).resolves.toEqual({
      ok: true,
      version: 2,
    })
    // Deactivate-then-activate, in that order.
    expect(updates).toEqual([{ is_active: false }, { is_active: true }])
  })

  it('when the second statement loses a race, it reports the state that is actually true', async () => {
    // The realistic failure here is 23505 on the partial unique index
    // `voice_profile_one_active`, which happens when a CONCURRENT activation
    // slipped in between the two statements. The old message said "No voice
    // profile is active" unconditionally — in exactly this case one IS, and
    // naming the wrong state to the only person who can fix it is rule 12.
    const { supa } = makeSupabase({
      rowById: { id: 'p2', version: 2, profile: { tone_rules: ['Warm and brief; answer and stop.'] } },
      onError: { code: '23505', message: 'duplicate key value violates unique constraint' },
      liveAfterFailure: { version: 4 },
    })
    const res = await activateVoiceProfile({ supabase: supa, id: 'p2', actor: 'admin:a@b.c' })
    expect(res).toEqual({ ok: false, status: 500, error: expect.stringContaining('v4 is the active one') })
    expect((res as { error: string }).error).not.toContain('No voice profile is active')
  })

  it('and still says "none is active" when that is what is true', async () => {
    const { supa } = makeSupabase({
      rowById: { id: 'p2', version: 2, profile: { tone_rules: ['Warm and brief; answer and stop.'] } },
      onError: { message: 'connection reset' },
      liveAfterFailure: null,
    })
    const res = await activateVoiceProfile({ supabase: supa, id: 'p2', actor: 'admin:a@b.c' })
    expect((res as { error: string }).error).toContain('No voice profile is active')
  })
})

/* ── One implementation, not two (rule 11) ──────────────────────────────── */

describe('the screen has exactly one implementation', () => {
  it('distill re-exports voice.ts\'s sanitizeVoiceProfile rather than keeping a copy', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const distill = require('@/lib/agent/distill')
    expect(distill.sanitizeVoiceProfile).toBe(sanitizeVoiceProfile)
  })

  it('draftInquiry re-exports the draftGuards functions rather than keeping a copy', () => {
    // Phase 6 moved three guardrails into draftGuards.ts and re-exported them.
    // Rule 7: a guardrail moved between modules can break its own test
    // silently, and the older tests still import them from draftInquiry. This
    // asserts the two names are the SAME function object, which is the only
    // way the older tests are evidence about the code that actually runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viaDraft = require('@/lib/agent/draftInquiry')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viaGuards = require('@/lib/agent/draftGuards')
    expect(viaDraft.containsMoney).toBe(viaGuards.containsMoney)
    expect(viaDraft.containsFabricatedTerms).toBe(viaGuards.containsFabricatedTerms)
    expect(viaDraft.containsForeignContact).toBe(viaGuards.containsForeignContact)
  })

  it('profileIsSubstantive agrees with what the loader will actually keep', () => {
    // The propose path and the read path must agree, or the distiller proposes
    // a profile the loader then discards and nobody can explain the gap.
    expect(profileIsSubstantive(sanitizeVoiceProfile(LIVE_V1).profile)).toBe(true)
    expect(profileIsSubstantive(sanitizeVoiceProfile({ tone_rules: ['Quote $850.'] }).profile)).toBe(false)
    expect(profileIsSubstantive({})).toBe(false)
  })
})
