import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RsvpView from '@/components/evites/RsvpView'
import {
  buildAnswerBody,
  buildExtrasBody,
  initialState,
  rsvpReducer,
  screenNumber,
  validateDetails,
  type FlowAction,
  type FlowState,
} from '@/lib/evites/rsvpFlow'
import type { OwnRsvp } from '@/lib/evites/rsvpView'
import { readSrc } from '../../helpers/sourceScan'

/**
 * The RSVP flow: Yes in three screens, No in two (spec §7.5, HANDOFF §3).
 * The repo's jest is node-only, so the flow is a pure reducer plus server-rendered
 * markup per screen (the same approach P04/P05 took).
 */

const WORDING = 'Send me party & craft ideas from Host Hampton'
const CLUB = { version: 'club-v1', wording: WORDING }

const ownRsvp = (over: Partial<OwnRsvp> = {}): OwnRsvp => ({
  status: 'yes',
  revision: 1,
  parent_name: 'Pat Parent',
  children: [{ first_name: 'Ava' }, { first_name: 'Ben' }],
  adult_count: 2,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  reminder_email: null,
  reminder_phone_e164: null,
  reminder_opt_out_at: null,
  club_email: null,
  club_opt_in_at: null,
  club_opted_out_at: null,
  birthday_month: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...over,
})

function run(start: FlowState, actions: FlowAction[]): { state: FlowState; screens: number[] } {
  let s = start
  const screens = [screenNumber(s.screen)]
  for (const a of actions) {
    s = rsvpReducer(s, a)
    screens.push(screenNumber(s.screen))
  }
  return { state: s, screens }
}

const fillYes: FlowAction[] = [
  { type: 'choose', choice: 'yes' },
  { type: 'setChild', index: 0, value: 'Ava' },
  { type: 'set', field: 'parentName', value: 'Pat Parent' },
  { type: 'setAdults', value: 1 },
  { type: 'setAllergy', value: false },
]

function markup(state: FlowState, over: { club?: typeof CLUB | null; honoree?: string | null } = {}): string {
  return renderToStaticMarkup(
    createElement(RsvpView, {
      state,
      dispatch: () => undefined,
      onSubmit: () => undefined,
      onSaveExtras: () => undefined,
      onLeaveClub: () => undefined,
      calendarUrl: '/i/mia-glow-7kq2/cal',
      honoree: over.honoree === undefined ? 'Mia' : over.honoree,
      club: over.club === undefined ? CLUB : over.club,
    }),
  )
}

// ──────────────────────────────────────────────────────────────── the walks

describe('Yes is three screens', () => {
  it('start -> details -> confirmed', () => {
    const { state, screens } = run(initialState(null), [...fillYes, { type: 'submitStart' }])
    expect(state.busy).toBe(true)
    expect(state.screen).toBe('details')
    const done = run(state, [{ type: 'submitted', rsvp: ownRsvp({ children: [{ first_name: 'Ava' }], adult_count: 1 }), reminderDropped: false }])
    expect(done.state.screen).toBe('confirmed')
    expect(done.state.busy).toBe(false)
    expect([...screens, ...done.screens.slice(1)]).toEqual([1, 2, 2, 2, 2, 2, 2, 3])
    expect(new Set([...screens, ...done.screens]).size).toBe(3)
  })
})

describe("No (Can't make it) is two screens", () => {
  it('start -> details (parent name only) -> declined', () => {
    const a = run(initialState(null), [{ type: 'choose', choice: 'no' }, { type: 'set', field: 'parentName', value: 'Pat Parent' }, { type: 'submitStart' }])
    expect(a.state.busy).toBe(true)
    const b = run(a.state, [{ type: 'submitted', rsvp: ownRsvp({ status: 'no', children: [], adult_count: 0, has_allergy: null }), reminderDropped: false }])
    expect(b.state.screen).toBe('declined')
    expect(new Set([...a.screens, ...b.screens])).toEqual(new Set([1, 2]))
  })
  it('asks for nothing but a name: no children, adults, allergy or reminder is required', () => {
    const s = run(initialState(null), [{ type: 'choose', choice: 'no' }, { type: 'set', field: 'parentName', value: 'Pat' }]).state
    expect(validateDetails(s)).toBeNull()
    expect(buildAnswerBody(s)).toEqual({ status: 'no', parentName: 'Pat', website: '' })
  })
  it('the No screen is just the name field and the buttons', () => {
    const html = markup(run(initialState(null), [{ type: 'choose', choice: 'no' }]).state)
    expect(html).toContain('Your name')
    expect(html).not.toMatch(/Add sibling|Adults staying|Food allergy|Want a reminder/)
  })
})

describe('back, and what typing does', () => {
  it('back from details returns to the first screen and keeps what was typed', () => {
    const { state } = run(initialState(null), [...fillYes, { type: 'back' }])
    expect(state.screen).toBe('start')
    expect(state.parentName).toBe('Pat Parent')
    expect(state.children).toEqual(['Ava'])
  })
  it('siblings: add up to six, remove down to one', () => {
    let s = initialState(null)
    for (let i = 0; i < 10; i++) s = rsvpReducer(s, { type: 'addChild' })
    expect(s.children).toHaveLength(6)
    expect(markup(rsvpReducer(s, { type: 'choose', choice: 'yes' }))).not.toContain('+ Add sibling')
    for (let i = 0; i < 10; i++) s = rsvpReducer(s, { type: 'removeChild', index: 0 })
    expect(s.children).toHaveLength(1)
  })
  it('typing clears the error shown against that field only', () => {
    let s = run(initialState(null), [{ type: 'choose', choice: 'yes' }, { type: 'submitStart' }]).state
    expect(s.error?.field).toBe('parentName')
    s = rsvpReducer(s, { type: 'set', field: 'reminderContact', value: 'x' })
    expect(s.error?.field).toBe('parentName')
    s = rsvpReducer(s, { type: 'set', field: 'parentName', value: 'P' })
    expect(s.error).toBeNull()
  })
})

describe('validation before anything is sent', () => {
  const base = () => run(initialState(null), fillYes).state
  it('a complete yes is valid', () => {
    expect(validateDetails(base())).toBeNull()
  })
  it.each([
    ['no parent name', { parentName: '  ' }, 'parentName'],
    ['no child name', { children: [''] }, 'child-0'],
    ['a second child left blank', { children: ['Ava', ' '] }, 'child-1'],
    ['no adult answer', { adultCount: null }, 'adultCount'],
    ['no allergy answer', { hasAllergy: null }, 'hasAllergy'],
    ['allergy yes with no detail', { hasAllergy: true, allergyNote: ' ' }, 'allergyNote'],
    ['a reminder that is neither an email nor a number', { reminderContact: 'call me' }, 'reminderContact'],
  ])('%s is refused next to the right field', (_n, patch, field) => {
    const s = { ...base(), ...patch } as FlowState
    expect(validateDetails(s)?.field).toBe(field)
    const after = rsvpReducer(s, { type: 'submitStart' })
    expect(after.busy).toBe(false)
    expect(after.error?.field).toBe(field)
  })
  it('adults of 0 is a real answer', () => {
    expect(validateDetails({ ...base(), adultCount: 0 })).toBeNull()
  })
  it('a reminder email or a mobile number is fine; blank is fine', () => {
    for (const v of ['', 'pat@example.com', '(631) 400-8080']) expect(validateDetails({ ...base(), reminderContact: v })).toBeNull()
  })
  it('a second submit while one is in flight is ignored', () => {
    const once = rsvpReducer(base(), { type: 'submitStart' })
    expect(rsvpReducer(once, { type: 'submitStart' })).toBe(once)
  })
  it('a failed send keeps everything typed and shows the message', () => {
    const busy = rsvpReducer(base(), { type: 'submitStart' })
    const failed = rsvpReducer(busy, { type: 'failed', message: 'This list is full', field: null })
    expect(failed.busy).toBe(false)
    expect(failed.screen).toBe('details')
    expect(failed.parentName).toBe('Pat Parent')
    expect(markup(failed)).toContain('This list is full')
  })
})

describe('what is sent', () => {
  it('a yes carries the party and the honeypot; the allergy note only when there is an allergy', () => {
    const s = run(initialState(null), [...fillYes, { type: 'set', field: 'allergyNote', value: 'stale text' }, { type: 'set', field: 'reminderContact', value: 'pat@example.com' }]).state
    expect(buildAnswerBody(s)).toEqual({
      status: 'yes',
      parentName: 'Pat Parent',
      children: [{ firstName: 'Ava' }],
      adultCount: 1,
      hasAllergy: false,
      reminderContact: 'pat@example.com',
      website: '',
    })
    const withAllergy = rsvpReducer(rsvpReducer(s, { type: 'setAllergy', value: true }), { type: 'set', field: 'allergyNote', value: 'peanuts' })
    expect(buildAnswerBody(withAllergy)).toMatchObject({ hasAllergy: true, allergyNote: 'peanuts' })
  })
})

// ──────────────────────────────────────────────────────────────── returning guests

describe('a returning guest', () => {
  it('a saved yes opens on screen 3, filled in, and a saved no on the declined screen', () => {
    const yes = initialState(ownRsvp({ reminder_email: 'pat@example.com' }))
    expect(yes.screen).toBe('confirmed')
    expect(yes.saved).not.toBeNull()
    expect(yes.parentName).toBe('Pat Parent')
    expect(yes.children).toEqual(['Ava', 'Ben'])
    expect(yes.clubEmail).toBe('pat@example.com')
    expect(initialState(ownRsvp({ status: 'no', children: [], adult_count: 0 })).screen).toBe('declined')
  })
  it('shows their RSVP with an Edit option', () => {
    const html = markup(initialState(ownRsvp()))
    expect(html).toContain("You&#x27;re on the list!")
    expect(html).toContain('Ava, Ben')
    expect(html).toContain('Change my RSVP')
    expect(markup(initialState(ownRsvp({ status: 'no', children: [], adult_count: 0 })))).toContain('Change my RSVP')
  })
  it('Edit goes back to screen 1 with the old answers filled in, and the form says Update', () => {
    const s = rsvpReducer(initialState(ownRsvp()), { type: 'edit' })
    expect(s.screen).toBe('start')
    expect(s.editing).toBe(true)
    expect(markup(s)).toContain('Update your RSVP')
    const d = rsvpReducer(s, { type: 'choose', choice: 'yes' })
    expect(d.children).toEqual(['Ava', 'Ben'])
    expect(markup(d)).toContain('Update my RSVP')
    expect(validateDetails(d)).toBeNull()
  })
  it('the emailed edit link (?edit=1) starts on the first screen in edit mode', () => {
    const s = initialState(ownRsvp(), true)
    expect(s.screen).toBe('start')
    expect(s.editing).toBe(true)
    expect(s.saved).not.toBeNull()
  })
  it('a phone reminder pre-fills the box', () => {
    expect(initialState(ownRsvp({ reminder_phone_e164: '+16314008080' })).reminderContact).toBe('+16314008080')
  })
})

// ──────────────────────────────────────────────────────────────── screens 1 and 2 are not marketing

describe('screens 1 and 2 contain no marketing words', () => {
  const FORBIDDEN = /club|offer|discount|ideas|promo|deal|sale|newsletter|subscribe|coupon/i
  const screens: Array<[string, FlowState]> = [
    ['screen 1', initialState(null)],
    ['screen 1, editing', initialState(ownRsvp(), true)],
    ['screen 2 (yes), blank', rsvpReducer(initialState(null), { type: 'choose', choice: 'yes' })],
    ['screen 2 (yes), with an allergy and siblings', run(initialState(null), [...fillYes, { type: 'addChild' }, { type: 'setAllergy', value: true }]).state],
    ['screen 2 (yes), with an error', run(initialState(null), [{ type: 'choose', choice: 'yes' }, { type: 'submitStart' }]).state],
    ['screen 2 (no)', rsvpReducer(initialState(null), { type: 'choose', choice: 'no' })],
  ]
  it.each(screens)('%s', (_n, state) => {
    const html = markup(state)
    expect(html.length).toBeGreaterThan(200)
    expect(html).not.toMatch(FORBIDDEN)
  })
  it('even when the club wording is loaded, it is not on these screens', () => {
    for (const [, state] of screens) expect(markup(state, { club: CLUB })).not.toContain(WORDING.replace('&', '&amp;'))
  })
})

describe('screen 1 and 2 controls', () => {
  it('screen 1 is the two buttons, Yes and Can’t make it', () => {
    const html = markup(initialState(null))
    expect(html).toMatch(/<button[^>]*>Yes, we&#x27;ll be there<\/button>/)
    expect(html).toMatch(/<button[^>]*>Can&#x27;t make it<\/button>/)
    expect(html).toContain('data-screen="1"')
  })
  it('screen 2 (yes) has every field in the brief', () => {
    const html = markup(rsvpReducer(initialState(null), { type: 'choose', choice: 'yes' }))
    for (const text of ['First name', 'Parent or guardian name', '+ Add sibling', 'Adults staying', '>0<', '>1<', '>2+<', 'Food allergy?', '>No<', '>Yes<', 'Want a reminder?', 'Email or mobile number', 'Send my RSVP']) {
      expect(html).toContain(text)
    }
  })
  it('the allergy details appear only after Yes', () => {
    const base = rsvpReducer(initialState(null), { type: 'choose', choice: 'yes' })
    expect(markup(base)).not.toContain('what to avoid')
    expect(markup(rsvpReducer(base, { type: 'setAllergy', value: true }))).toContain('what to avoid')
  })
  it('carries a honeypot a person cannot reach: off-screen, aria-hidden, not tabbable, autocomplete off', () => {
    const html = markup(rsvpReducer(initialState(null), { type: 'choose', choice: 'yes' }))
    expect(html).toMatch(/aria-hidden="true"[^>]*left:-10000px/)
    expect(html).toMatch(/<input[^>]*name="website"[^>]*tabindex="-1"[^>]*autoComplete="off"|<input[^>]*name="website"[^>]*autoComplete="off"[^>]*tabindex="-1"/i)
  })
  it('is built for a thumb at 375 px: 16px text in every field, 48px minimum tap targets', () => {
    for (const state of [rsvpReducer(initialState(null), { type: 'choose', choice: 'yes' }), initialState(null), initialState(ownRsvp())]) {
      const html = markup(state)
      for (const m of Array.from(html.matchAll(/<(input|textarea|select)\b[^>]*class="([^"]*)"/g))) {
        if (/type="checkbox"/.test(m[0]) || /name="website"/.test(m[0])) continue
        expect(m[2]).toContain('text-base')
        expect(m[2]).toContain('min-h-[3rem]')
        expect(m[2]).toContain('w-full')
      }
      for (const m of Array.from(html.matchAll(/<button\b[^>]*class="([^"]*)"/g))) expect(m[1]).toMatch(/min-h-\[3rem\]/)
      expect(html).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]|overflow-x-scroll/) // nothing forces a sideways scroll
    }
  })
})

// ──────────────────────────────────────────────────────────────── screen 3

describe('screen 3', () => {
  const confirmed = (over: Partial<OwnRsvp> = {}, extra: Partial<FlowState> = {}): FlowState => ({ ...initialState(ownRsvp(over)), ...extra })

  it('says "You’re on the list!", offers Add to calendar, and a note to the birthday child', () => {
    const html = markup(confirmed())
    expect(html).toContain("You&#x27;re on the list!")
    expect(html).toMatch(/<a [^>]*href="\/i\/mia-glow-7kq2\/cal"[^>]*>Add to calendar<\/a>/)
    expect(html).toContain('Leave a note for Mia (optional)')
    expect(html).toContain('data-screen="3"')
  })
  it('names the child generically when the booking has no name', () => {
    expect(markup(confirmed(), { honoree: null })).toContain('Leave a note for the birthday child (optional)')
  })
  it('below a divider, the Birthday Club card: the EXACT server wording next to an UNCHECKED box', () => {
    const html = markup(confirmed({ reminder_email: 'pat@example.com' }))
    expect(html).toContain('<hr')
    expect(html.indexOf('<hr')).toBeLessThan(html.indexOf('Birthday Club'))
    expect(html).toContain(WORDING.replace('&', '&amp;'))
    const box = /<input[^>]*id="rsvp-club"[^>]*>/.exec(html)![0]
    expect(box).toContain('type="checkbox"')
    expect(box).not.toMatch(/checked/)
    expect(html).toMatch(/<label[^>]*for="rsvp-club"[^>]*>[\s\S]*Send me party &amp; craft ideas from Host Hampton/)
    expect(html).toContain('Unsubscribe anytime.')
  })
  it('the wording is whatever the database row says, not a constant in the code', () => {
    const html = markup(confirmed(), { club: { version: 'club-v9', wording: 'Totally different words' } })
    expect(html).toContain('Totally different words')
    expect(html).not.toContain('craft ideas')
    const src = readSrc('components', 'evites', 'RsvpView.tsx') + readSrc('components', 'evites', 'RsvpIsland.tsx')
    expect(src).not.toMatch(/craft ideas|Send me party/)
  })
  it('the club email is prefilled from the reminder email, and the month is an optional select of 12', () => {
    const html = markup(confirmed({ reminder_email: 'pat@example.com' }))
    expect(html).toMatch(/<input[^>]*id="rsvp-club-email"[^>]*value="pat@example.com"/)
    const select = /<select[\s\S]*?<\/select>/.exec(html)![0]
    expect((select.match(/<option/g) ?? []).length).toBe(13) // "Choose a month" + 12
    expect(select).toContain('>January<')
    expect(select).toContain('>December<')
    expect(select).toMatch(/<option value=""[^>]*>Choose a month<\/option>/)
    expect(html).toContain('Birthday month')
    expect(html).toContain('(optional)')
  })
  it('a phone reminder has no club prefill, and gets the calendar hint instead', () => {
    const html = markup(confirmed({ reminder_phone_e164: '+16314008080' }))
    expect(html).toMatch(/id="rsvp-club-email"[^>]*value=""/)
    expect(html).toContain('Add it to your calendar so your phone reminds you')
  })
  it('an email reminder says so; a dropped one tells the guest', () => {
    expect(markup(confirmed({ reminder_email: 'pat@example.com' }))).toContain('email a reminder')
    expect(markup(confirmed({}, { reminderDropped: true }))).toContain('couldn&#x27;t set up an email reminder')
  })
  it('with no wording on record the card is hidden entirely', () => {
    const html = markup(confirmed(), { club: null })
    expect(html).not.toMatch(/Birthday Club|rsvp-club|Unsubscribe anytime/)
    expect(html).toContain('Add to calendar')
  })
  it('a guest already in the club sees that, and a way out, instead of the box', () => {
    const html = markup(confirmed({ club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', opt_in_text_version: 'club-v1' } as Partial<OwnRsvp>))
    expect(html).toContain('signed up with pat@example.com')
    expect(html).toContain('Leave the Birthday Club')
    expect(html).not.toContain('id="rsvp-club"')
  })
  it('after leaving, the box is offered again', () => {
    const html = markup(confirmed({ club_email: 'pat@example.com', club_opt_in_at: '2026-10-21T00:00:00Z', club_opted_out_at: '2026-10-22T00:00:00Z' }))
    expect(html).toContain('id="rsvp-club"')
  })
  it('a ticked box with a bad email is refused before sending; a good one is sent with the version the guest saw', () => {
    const s = confirmed({}, { clubChecked: true, clubEmail: 'nope' })
    expect(buildExtrasBody(s, CLUB)).toEqual({ error: { field: 'clubEmail', message: expect.any(String) } })
    const good = buildExtrasBody({ ...s, clubEmail: 'pat@example.com', birthdayMonth: 6 }, CLUB)
    expect(good).toEqual({ body: { club: { optIn: true, email: 'pat@example.com', birthdayMonth: 6, consentVersion: 'club-v1' } } })
  })
  it('an unticked box sends no club data, a note is sent only when it changed, and nothing to save is null', () => {
    const base = confirmed()
    expect(buildExtrasBody({ ...base, clubEmail: 'pat@example.com', birthdayMonth: 3 }, CLUB)).toBeNull()
    expect(buildExtrasBody({ ...base, note: 'Happy birthday!' }, CLUB)).toEqual({ body: { noteToHonoree: 'Happy birthday!' } })
    const noted = confirmed({ note_to_honoree: 'Hi' })
    expect(buildExtrasBody(noted, CLUB)).toBeNull()
    expect(buildExtrasBody({ ...noted, note: '' }, CLUB)).toEqual({ body: { noteToHonoree: '' } })
    expect(buildExtrasBody({ ...base, clubChecked: true, clubEmail: 'pat@example.com' }, null)).toBeNull() // no wording: nothing to consent to
  })
  it('saving shows a thank-you and un-ticks the box so it cannot be sent twice', () => {
    const s = rsvpReducer(confirmed({}, { clubChecked: true }), { type: 'extrasDone', rsvp: ownRsvp() })
    expect(s.extrasSaved).toBe(true)
    expect(s.clubChecked).toBe(false)
    expect(markup(s)).toContain('Saved. Thank you!')
  })
})

describe('client state only', () => {
  const island = readSrc('components', 'evites', 'RsvpIsland.tsx')
  it('never changes the URL: no router, no history, no location', () => {
    expect(island).not.toMatch(/useRouter|next\/navigation|history\.|pushState|replaceState|location\.|window\.open/)
  })
  it('reports rsvp_started once, on the first tap, and posts first answers but patches later ones', () => {
    expect(island).toMatch(/event: 'rsvp_started'/)
    expect(island).toMatch(/started\.current/)
    expect(island).toMatch(/state\.saved \? 'PATCH' : 'POST'/)
    expect(island).toMatch(/credentials: 'same-origin'/)
  })
  it('is a client component and never shows how many have answered (D15)', () => {
    expect(island.startsWith("'use client'")).toBe(true)
    expect(island).not.toMatch(/count|guests? (have|are)|others/i)
  })
})
