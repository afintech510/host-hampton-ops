/**
 * The guest RSVP flow as a PURE reducer (spec §7.5 "Screen copy", HANDOFF §3).
 *
 *   Yes:  1 start -> 2 details -> 3 confirmed
 *   No:   1 start -> 2 details -> (2) declined         "Can't make it" asks for a parent name only
 *
 * Client state only, never URL changes (GA must not see a screen as a page).
 * The component (`components/evites/RsvpIsland.tsx`) owns the network; this file
 * owns what screen is showing, what has been typed, and whether it may be sent,
 * so the whole flow is testable in the repo's node-only jest.
 *
 * `validateDetails` mirrors the server's screens (`lib/evites/screens.ts`) so a
 * guest meets the message beside the right field instead of after a round trip.
 * The server is still the authority.
 *
 * Returning guests: a loaded answer starts on `confirmed` / `declined` with
 * `saved` set, so every later submit is a PATCH. `?edit=1` (the emailed "Update
 * your RSVP" link) starts on `start` with the old answers filled in.
 */

import type { OwnRsvp } from '@/lib/evites/rsvpView'
import {
  ALLERGY_NOTE_MAX,
  CHILD_NAME_MAX,
  MAX_CHILDREN,
  NOTE_TO_HONOREE_MAX,
  PARENT_NAME_MAX,
  screenReminderContact,
} from '@/lib/evites/screens'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'

export type Screen = 'start' | 'details' | 'confirmed' | 'declined'
export type Choice = 'yes' | 'no'

export interface FlowError {
  field: string | null
  message: string
}

export interface FlowState {
  screen: Screen
  /** The answer the server holds, if any. When set, a submit is a PATCH. */
  saved: OwnRsvp | null
  /** True while changing a saved answer (the start screen says "Update"). */
  editing: boolean
  choice: Choice | null
  parentName: string
  /** First names; always at least one entry (an empty string is an unfilled box). */
  children: string[]
  adultCount: 0 | 1 | 2 | null
  hasAllergy: boolean | null
  allergyNote: string
  reminderContact: string
  /** The honeypot. A person never sees the field; a script fills it. */
  website: string
  // screen 3
  note: string
  clubChecked: boolean
  clubEmail: string
  birthdayMonth: number | null
  busy: boolean
  error: FlowError | null
  reminderDropped: boolean
  /** Screen 3's note / club save went through. */
  extrasSaved: boolean
}

export type FlowAction =
  | { type: 'choose'; choice: Choice }
  | { type: 'back' }
  | { type: 'edit' }
  | { type: 'set'; field: 'parentName' | 'allergyNote' | 'reminderContact' | 'website' | 'note' | 'clubEmail'; value: string }
  | { type: 'setAdults'; value: 0 | 1 | 2 }
  | { type: 'setAllergy'; value: boolean }
  | { type: 'setChild'; index: number; value: string }
  | { type: 'addChild' }
  | { type: 'removeChild'; index: number }
  | { type: 'setClub'; checked: boolean }
  | { type: 'setMonth'; value: number | null }
  | { type: 'submitStart' }
  | { type: 'submitted'; rsvp: OwnRsvp; reminderDropped: boolean }
  | { type: 'failed'; message: string; field?: string | null }
  | { type: 'extrasStart' }
  | { type: 'extrasDone'; rsvp: OwnRsvp }

/** The screen NUMBER the guest is on, for "Yes is three screens, No is two". */
export function screenNumber(screen: Screen): 1 | 2 | 3 {
  switch (screen) {
    case 'start':
      return 1
    case 'details':
    case 'declined':
      return 2
    case 'confirmed':
      return 3
  }
}

const BLANK: Omit<FlowState, 'screen'> = {
  saved: null,
  editing: false,
  choice: null,
  parentName: '',
  children: [''],
  adultCount: null,
  hasAllergy: null,
  allergyNote: '',
  reminderContact: '',
  website: '',
  note: '',
  clubChecked: false,
  clubEmail: '',
  birthdayMonth: null,
  busy: false,
  error: null,
  reminderDropped: false,
  extrasSaved: false,
}

/** The form fields filled from a saved answer. */
function prefill(rsvp: OwnRsvp): Partial<FlowState> {
  const names = rsvp.children.map((c) => c.first_name)
  return {
    choice: rsvp.status,
    parentName: rsvp.parent_name,
    children: names.length > 0 ? names : [''],
    adultCount: rsvp.status === 'yes' ? ((rsvp.adult_count === 1 || rsvp.adult_count === 2 ? rsvp.adult_count : 0) as 0 | 1 | 2) : null,
    hasAllergy: rsvp.status === 'yes' ? rsvp.has_allergy : null,
    allergyNote: rsvp.allergy_note ?? '',
    reminderContact: rsvp.reminder_email ?? rsvp.reminder_phone_e164 ?? '',
    note: rsvp.note_to_honoree ?? '',
    clubEmail: rsvp.club_email ?? rsvp.reminder_email ?? '',
    birthdayMonth: rsvp.birthday_month,
  }
}

export function initialState(own: OwnRsvp | null, startInEdit = false): FlowState {
  if (!own) return { ...BLANK, screen: 'start' }
  const base: FlowState = { ...BLANK, ...prefill(own), saved: own, screen: own.status === 'yes' ? 'confirmed' : 'declined' }
  return startInEdit ? { ...base, screen: 'start', editing: true, choice: null } : base
}

/** The first thing wrong with what is typed on screen 2, or null. */
export function validateDetails(s: FlowState): FlowError | null {
  const parent = s.parentName.replace(/\s+/g, ' ').trim()
  if (s.choice === null) return { field: 'status', message: 'Please choose Yes or Can’t make it.' }
  if (parent === '') return { field: 'parentName', message: 'Please enter your name.' }
  if (Array.from(parent).length > PARENT_NAME_MAX) return { field: 'parentName', message: 'That name is too long.' }
  if (s.choice === 'no') return null

  const names = s.children.map((c) => c.replace(/\s+/g, ' ').trim())
  if (names.length < 1 || names.length > MAX_CHILDREN) return { field: 'children', message: 'Please add at least one child (up to 6).' }
  const blank = names.findIndex((n) => n === '')
  if (blank >= 0) return { field: `child-${blank}`, message: 'Please enter the child’s first name.' }
  const long = names.findIndex((n) => Array.from(n).length > CHILD_NAME_MAX)
  if (long >= 0) return { field: `child-${long}`, message: 'That name is too long.' }
  if (s.adultCount === null) return { field: 'adultCount', message: 'Please choose how many adults are staying.' }
  if (s.hasAllergy === null) return { field: 'hasAllergy', message: 'Please tell us whether there is a food allergy.' }
  if (s.hasAllergy && s.allergyNote.trim() === '') return { field: 'allergyNote', message: 'Please tell us about the allergy.' }
  if (s.hasAllergy && Array.from(s.allergyNote.trim()).length > ALLERGY_NOTE_MAX) return { field: 'allergyNote', message: 'That note is too long.' }
  if (screenReminderContact(s.reminderContact).kind === 'invalid') {
    return { field: 'reminderContact', message: 'Please enter an email address or a mobile number.' }
  }
  return null
}

/** The JSON for screens 1-2. A decline carries a name and nothing else. `website` is always present (the honeypot). */
export function buildAnswerBody(s: FlowState): Record<string, unknown> {
  if (s.choice === 'no') return { status: 'no', parentName: s.parentName, website: s.website }
  return {
    status: 'yes',
    parentName: s.parentName,
    children: s.children.map((firstName) => ({ firstName })),
    adultCount: s.adultCount,
    hasAllergy: s.hasAllergy,
    ...(s.hasAllergy ? { allergyNote: s.allergyNote } : {}),
    reminderContact: s.reminderContact,
    website: s.website,
  }
}

export interface ClubOffer {
  version: string
  wording: string
}

/** What screen 3 asks the server to save, or null when there is nothing to save. */
export function buildExtrasBody(s: FlowState, club: ClubOffer | null): { body: Record<string, unknown> } | { error: FlowError } | null {
  const body: Record<string, unknown> = {}
  const note = s.note.trim()
  if (note !== (s.saved?.note_to_honoree ?? '')) {
    if (Array.from(note).length > NOTE_TO_HONOREE_MAX) return { error: { field: 'note', message: 'That note is too long.' } }
    body.noteToHonoree = note
  }
  if (s.clubChecked && club) {
    if (!isPlausibleEmailAddress(s.clubEmail.trim())) return { error: { field: 'clubEmail', message: 'Please enter a valid email address.' } }
    body.club = {
      optIn: true,
      email: s.clubEmail.trim(),
      ...(s.birthdayMonth !== null ? { birthdayMonth: s.birthdayMonth } : {}),
      consentVersion: club.version,
    }
  }
  return Object.keys(body).length === 0 ? null : { body }
}

export function rsvpReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case 'choose':
      return { ...s, choice: a.choice, screen: 'details', error: null }
    case 'back':
      if (s.screen === 'details') return { ...s, screen: 'start', error: null }
      return s
    case 'edit':
      return { ...s, screen: 'start', editing: true, choice: null, error: null, extrasSaved: false, reminderDropped: false }
    case 'set':
      return { ...s, [a.field]: a.value, error: s.error && s.error.field === a.field ? null : s.error }
    case 'setAdults':
      return { ...s, adultCount: a.value, error: s.error?.field === 'adultCount' ? null : s.error }
    case 'setAllergy':
      return { ...s, hasAllergy: a.value, error: s.error?.field === 'hasAllergy' || s.error?.field === 'allergyNote' ? null : s.error }
    case 'setChild': {
      const children = s.children.map((c, i) => (i === a.index ? a.value : c))
      return { ...s, children, error: s.error?.field === `child-${a.index}` ? null : s.error }
    }
    case 'addChild':
      return s.children.length >= MAX_CHILDREN ? s : { ...s, children: [...s.children, ''] }
    case 'removeChild':
      return s.children.length <= 1 ? s : { ...s, children: s.children.filter((_, i) => i !== a.index), error: null }
    case 'setClub':
      return { ...s, clubChecked: a.checked, error: null }
    case 'setMonth':
      return { ...s, birthdayMonth: a.value }
    case 'submitStart': {
      if (s.busy) return s
      const problem = validateDetails(s)
      return problem ? { ...s, error: problem } : { ...s, busy: true, error: null }
    }
    case 'submitted': {
      const typedEmail = screenReminderContact(s.reminderContact)
      return {
        ...s,
        ...prefill(a.rsvp),
        // What the guest has typed on screen 3 survives a re-submit of screen 2.
        note: s.note !== '' ? s.note : (a.rsvp.note_to_honoree ?? ''),
        // An address typed into the reminder box is a good guess for the club box even if the reminder itself was declined.
        clubEmail: a.rsvp.club_email ?? (typedEmail.kind === 'email' ? typedEmail.email : (a.rsvp.reminder_email ?? '')),
        saved: a.rsvp,
        editing: false,
        screen: a.rsvp.status === 'yes' ? 'confirmed' : 'declined',
        busy: false,
        error: null,
        reminderDropped: a.reminderDropped,
        extrasSaved: false,
        website: '',
      }
    }
    case 'failed':
      return { ...s, busy: false, error: { field: a.field ?? null, message: a.message } }
    case 'extrasStart':
      return s.busy ? s : { ...s, busy: true, error: null }
    case 'extrasDone':
      return { ...s, saved: a.rsvp, busy: false, error: null, extrasSaved: true, clubChecked: false }
  }
}
