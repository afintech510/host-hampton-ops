/**
 * The public invitation showcase (`/invitations`): every Host Hampton EVITE design,
 * drawn with whatever name, age, date and time a visitor types.
 *
 *   showcaseCards(input) -> ShowcaseCard[]   (one per design, registry order)
 *
 * SERVER-ONLY (facts and layout read the font files). The page calls it for the
 * first render and `/api/invitations/showcase` calls it as the visitor types; the
 * browser then draws each card with the client-safe `InviteCanvas`, from the same
 * template the sizes were measured against.
 *
 * Nothing here touches the database. A showcase card is `inviteFacts()` over a
 * made-up studio booking, so it says exactly what a real invitation would — the
 * same screening, the same date/time formatting, the same text fitting.
 *
 * The design is forced through the evite's theme override (`theme_word` +
 * `template_slug`), the one path `inviteFacts` has always honoured for any known
 * template, so a design added to the registry shows up here with no change.
 */

import { inviteFacts, type InviteFacts } from '@/lib/evites/facts'
import { computeSizes } from '@/lib/evites/layout'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { TEMPLATE_SLUGS, templateFor } from '@/lib/evites/templates'
import type { InviteSizes, TemplateLayout, TemplateSlug } from '@/lib/evites/templates/types'
import type { InviteState } from '@/lib/evites/state'

export interface ShowcaseInput {
  name: string
  age: number | null
  /** `YYYY-MM-DD`, or null. */
  date: string | null
  /** `HH:MM`, 24-hour, or null. */
  time: string | null
}

export interface ShowcaseCard {
  slug: TemplateSlug
  label: string
  facts: InviteFacts
  sizes: InviteSizes
}

export const SHOWCASE_NAME_MAX = 20
export const SHOWCASE_AGE_MAX = 20

/**
 * The theme word each design is shown with, chosen to read inside that design's own words
 * ("IT'S A HELLO KITTY PARTY!", "JOIN US FOR A COWGIRL PARTY!"). Only designs that draw the
 * word matter; one not listed takes its label's (see `themeWordOf`).
 */
const THEME_WORDS: Readonly<Record<string, string>> = {
  glow: 'GLOW',
  sleepunder: 'SLEEP UNDER',
  'hello-kitty': 'HELLO KITTY',
  'neon-party': 'NEON',
  'saddle-up': 'COWGIRL',
  'slime-pastel': 'SLIME',
  'slime-teal': 'SLIME',
  squish: 'SQUISHMALLOW',
  'two-sweet': 'SWEETS',
}

/** Words a theme word never needs: the designs print their own "PARTY". */
const FILLER = new Set(['PARTY', 'PARTIES', 'THEME', 'BIRTHDAY', 'THE', 'A', 'AND'])

/** Labels for designs whose layout predates the template `label` field. */
const LABELS: Readonly<Record<string, string>> = {
  glow: 'Neon Glow',
  sleepunder: 'Sleep Under',
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

export function labelOf(t: TemplateLayout): string {
  const own = (t as { label?: unknown }).label
  if (typeof own === 'string' && own.trim() !== '') return own
  return LABELS[t.slug] ?? titleCase(t.slug.replace(/-/g, ' '))
}

/**
 * Upper-case, at most 12 characters (the `theme_word` column's limit). From the label, with any
 * "(Horse)" aside, punctuation and filler dropped: the whole thing if it fits, else its last word
 * ("WATERCOLOR UNICORN" -> "UNICORN"), else BIRTHDAY.
 */
export function themeWordOf(t: TemplateLayout): string {
  const fixed = THEME_WORDS[t.slug]
  if (fixed) return fixed
  const words = labelOf(t)
    .replace(/\([^)]*\)/g, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9' -]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !FILLER.has(w))
  const whole = words.join(' ')
  if (whole !== '' && whole.length <= 12) return whole
  const last = words[words.length - 1] ?? ''
  return last !== '' && last.length <= 12 ? last : 'BIRTHDAY'
}

/** The designs on show: every registered template except `plain`, which is the fallback, not a design. */
export function showcaseTemplates(): TemplateLayout[] {
  return TEMPLATE_SLUGS.filter((s) => s !== 'plain').map((s) => templateFor(s)).filter((t) => t.slug !== 'plain')
}

/**
 * Untrusted input (a JSON body, a query string) -> a clean `ShowcaseInput`. Never throws: an
 * unusable field is empty, and an empty field draws the way a real invite with that gap does
 * ("BIRTHDAY STAR", "Pick your date").
 */
export function screenShowcaseInput(raw: unknown): ShowcaseInput {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const name =
    typeof o.name === 'string'
      ? Array.from(o.name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim()).slice(0, SHOWCASE_NAME_MAX).join('')
      : ''
  const ageNum = typeof o.age === 'number' ? o.age : typeof o.age === 'string' && o.age.trim() !== '' ? Number(o.age) : NaN
  const age = Number.isInteger(ageNum) && ageNum >= 1 && ageNum <= SHOWCASE_AGE_MAX ? ageNum : null
  const date = validPartyDate(o.date)
  const t = typeof o.time === 'string' ? /^(\d{2}):(\d{2})$/.exec(o.time.trim()) : null
  const time = t && Number(t[1]) <= 23 && Number(t[2]) <= 59 ? `${t[1]}:${t[2]}` : null
  return { name, age, date, time }
}

/** What the visitor typed, as the facts' state: a date and a time is a live invite, a date alone needs a time. */
function stateOf(input: ShowcaseInput): InviteState {
  if (!input.date) return 'preview'
  return input.time ? 'live' : 'needs_time'
}

export function showcaseCards(input: ShowcaseInput): ShowcaseCard[] {
  const booking = {
    party_type: 'theme_party',
    party_date: input.date,
    party_time: input.time,
    package_type: null,
    guest_count_approx: null,
    child_name: input.name === '' ? null : input.name,
    child_age: input.age,
    party_tags: { location_type: 'host_hampton' },
    quote_snapshot: {},
  }
  const state = stateOf(input)
  const cards: ShowcaseCard[] = []
  for (const template of showcaseTemplates()) {
    const facts = inviteFacts(
      booking,
      {
        template_slug: template.slug,
        theme_word: themeWordOf(template),
        theme_sub: 'PARTY',
        host_contact_name: null,
        host_contact_phone: null,
        show_host_contact: true,
        host_note: null,
        gift_note: null,
        rsvp_deadline: null,
      },
      [],
      [],
      state,
    )
    // The override did not take (a theme word the fonts could not draw): skip rather than show the wrong design.
    if (facts.templateSlug !== template.slug) continue
    // `window` holds Dates, which a JSON body would turn into strings; no slot reads it.
    const clean: InviteFacts = { ...facts, window: null }
    cards.push({ slug: template.slug, label: labelOf(template), facts: clean, sizes: computeSizes(template, clean) })
  }
  return cards
}

/** The first render's example: Mia, turning 7, on a Saturday at least two weeks out, at 2 PM. */
export function sampleShowcaseInput(now: Date = new Date()): ShowcaseInput {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14))
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7))
  return { name: 'Mia', age: 7, date: d.toISOString().slice(0, 10), time: '14:00' }
}
