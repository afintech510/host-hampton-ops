/**
 * Where an inquiry came from.
 *
 * ONE definition, shared by the browser (which captures it) and the routes
 * (which screen it and write it). The browser half must not import anything
 * server-side, so everything in here is pure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR. Until 2026-09-15, `contacts.source` was the literal string
 * `'direct'` for every website contact and the posted `utm` blob was dropped
 * into an interaction's `metadata` JSON that no screen reads. Six months of
 * form submissions (95 of them) carry three UTMs between them, and all three
 * say `chatgpt.com`.
 *
 * TWO VALUES, NOT ONE, and the distinction is the whole point:
 *
 *   `Attribution` — the raw first touch, verbatim. Never normalised, never
 *   collapsed. `chatgpt.com` is a real and currently interesting answer and
 *   there is no enum label for it.
 *
 *   `LeadSource`  — the `lead_source` PG enum, for grouping. It has fifteen
 *   labels and the world has more than fifteen channels, so `deriveLeadSource`
 *   answers `other` a lot. That is honest, and it is lossy, which is why the
 *   verbatim blob is stored alongside it and not instead of it.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export type UtmKey = (typeof UTM_KEYS)[number]

export interface Attribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  /** Referring host only — never the full URL. See the note in screenAttribution. */
  referrer?: string
  /** Path of the first page of the visit, query string stripped. */
  landing_path?: string
  /** ISO-8601, set by the browser at first touch. */
  captured_at?: string
  /** Set only by migration 053's backfill, so a report can tell it apart. */
  backfilled?: boolean
  /**
   * What the customer SAID when asked, as a `HEARD_ABOUT_OPTIONS` value.
   *
   * Kept in its own key and never merged into `utm_source`, because the two are
   * different kinds of evidence and a report has to be able to tell them apart:
   * a UTM is a fact about a click, a self-report is a person's recollection.
   */
  self_reported?: HeardAboutValue
  /** Their own words when they chose "Something else". Bounded, never parsed. */
  self_reported_note?: string
}

/**
 * Every label `lead_source` holds, as of migration 053. `deriveLeadSource`
 * returns a member of THIS array and nothing else.
 *
 * It is written out rather than inferred because the failure it prevents is
 * silent and expensive: `contacts.source` is an enum column, so a value the
 * type does not hold is a 22P02 at INSERT time, which the intake routes catch
 * and log non-fatally — i.e. a mis-derived channel would not corrupt a row, it
 * would DROP THE WHOLE CONTACT, on the first lead from a channel nobody had
 * thought of. Rule 19: the write that refuses is the one nobody notices.
 */
export const LEAD_SOURCES = [
  'instagram',
  'facebook',
  'facebook_group',
  'facebook_marketplace',
  'google_organic',
  'google_ads',
  'nextdoor',
  'yelp',
  'referral',
  'walk_in',
  'pop_up_market',
  'email',
  'sms',
  'direct',
  'other',
] as const

export type LeadSource = (typeof LEAD_SOURCES)[number]

/**
 * "How did you hear about us?" — the options, and what each one means in the
 * `lead_source` enum.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL. Everything else on this surface measures a BROWSER:
 * a tag on a URL, a referring host. That reaches exactly the people who clicked
 * a link. It cannot see the two channels this business actually runs on —
 * somebody's friend recommended us, and somebody called the number off a sign —
 * and it will never see the phone half of the inquiries (48 inbound SMS in
 * September alone, no browser, no URL, nothing to capture).
 *
 * A self-report is weaker evidence than a click and it is the ONLY evidence
 * word-of-mouth ever produces. So it is stored, kept separate, and ranked
 * below a tag we set ourselves and above a referrer we merely observed — see
 * `deriveLeadSource`.
 *
 * The list is derived from the `lead_source` enum rather than invented, so that
 * the answers group with the measured ones instead of forming a second
 * vocabulary nobody can join up. Two deliberate exceptions:
 *
 *   - `ai_assistant` has no enum label and lands in `other`. It is on the list
 *     because the ONLY three UTMs this business has ever captured say
 *     `chatgpt.com`, so it is demonstrably a real channel here, and `other`
 *     with the verbatim value beside it is how we keep counting it until it
 *     earns a label of its own.
 *   - `something_else` opens a free-text box. That is the field that tells us
 *     what the eleventh option should be.
 *
 * The field is OPTIONAL everywhere. A required question on an inquiry form
 * costs real inquiries, and a lead we lose is worth more than a lead we can
 * attribute.
 */
export const HEARD_ABOUT_OPTIONS = [
  { value: 'friend_referral', label: 'A friend or past customer', leadSource: 'referral' },
  { value: 'instagram', label: 'Instagram', leadSource: 'instagram' },
  { value: 'facebook', label: 'Facebook', leadSource: 'facebook' },
  { value: 'facebook_group', label: 'A Facebook group', leadSource: 'facebook_group' },
  { value: 'google', label: 'Google search', leadSource: 'google_organic' },
  { value: 'ai_assistant', label: 'ChatGPT or another AI assistant', leadSource: 'other' },
  { value: 'nextdoor', label: 'Nextdoor', leadSource: 'nextdoor' },
  { value: 'yelp', label: 'Yelp', leadSource: 'yelp' },
  { value: 'event_or_market', label: 'Saw us at an event or market', leadSource: 'pop_up_market' },
  { value: 'drove_by', label: 'Drove by or walked in', leadSource: 'walk_in' },
  { value: 'something_else', label: 'Something else', leadSource: 'other' },
] as const satisfies ReadonlyArray<{ value: string; label: string; leadSource: LeadSource }>

export type HeardAboutValue = (typeof HEARD_ABOUT_OPTIONS)[number]['value']

const HEARD_ABOUT_BY_VALUE = new Map<string, LeadSource>(
  HEARD_ABOUT_OPTIONS.map(o => [o.value, o.leadSource as LeadSource])
)

/** Their own words are bounded harder than a UTM: this one is prose. */
const MAX_NOTE_LEN = 300

/**
 * Accept a `heardAbout` value only if it is one we offered.
 *
 * An allowlist, not a sanitiser. The value decides a `lead_source` enum write,
 * and an unrecognised string that reached that column would be a 22P02 the
 * intake route swallows non-fatally — the whole contact dropped, silently, for
 * a dropdown value. Anything unknown is simply not a self-report.
 */
export function screenHeardAbout(raw: unknown): HeardAboutValue | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  return HEARD_ABOUT_BY_VALUE.has(value) ? (value as HeardAboutValue) : undefined
}

/** Longer than any real tag; a UTM this long is a paste accident or an attack. */
const MAX_VALUE_LEN = 200

function boundedString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  // Control characters out: these values reach a log line, an admin table cell
  // and (via the reporting query) a CSV. Newlines in any of the three are a
  // forged row.
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim()
  if (!clean) return undefined
  return clean.slice(0, MAX_VALUE_LEN)
}

/**
 * Take whatever the browser posted and return only what we are willing to store.
 *
 * This is an ENTRY screen (the mail-template lesson: escape/bound at entry, not
 * at each of the places it is later read). The input is attacker-controlled —
 * it is a field in a public JSON body, not something the browser signs — so
 * nothing here trusts a type, a key, or a length.
 *
 * The referrer is reduced to its HOST. A full referring URL on a lead row is a
 * privacy liability we get nothing for: it can carry the customer's search
 * terms, a session id from the referring site, or a path that identifies them.
 * The host is the entire reportable content of a referrer.
 */
export function screenAttribution(raw: unknown): Attribution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const input = raw as Record<string, unknown>
  const out: Attribution = {}

  for (const key of UTM_KEYS) {
    const val = boundedString(input[key])
    if (val) out[key] = val
  }

  const referrer = boundedString(input.referrer)
  if (referrer) {
    const host = referrerHost(referrer)
    if (host) out.referrer = host
  }

  const path = boundedString(input.landing_path)
  // A path, not a URL: a stored `https://evil/...` here would be rendered as a
  // link by any reporting screen that assumed this column was safe to print.
  if (path && path.startsWith('/') && !path.startsWith('//')) {
    out.landing_path = path.split('?')[0].split('#')[0]
  }

  const selfReported = screenHeardAbout(input.self_reported)
  if (selfReported) {
    out.self_reported = selfReported
    // The note is only meaningful against `something_else`; carrying it on the
    // others would let a stray value contradict the answer beside it.
    if (selfReported === 'something_else') {
      const note = boundedString(input.self_reported_note)
      if (note) out.self_reported_note = note.slice(0, MAX_NOTE_LEN)
    }
  }

  const capturedAt = boundedString(input.captured_at)
  // Bound it to a plausible instant. A browser clock is not authoritative and a
  // year-3000 timestamp would sort above every real row in a report forever.
  if (capturedAt && !Number.isNaN(Date.parse(capturedAt))) {
    const t = Date.parse(capturedAt)
    const now = Date.now()
    if (t > now - 365 * 24 * 3600 * 1000 && t < now + 24 * 3600 * 1000) {
      out.captured_at = new Date(t).toISOString()
    }
  }

  return out
}

/** The host of a referrer, or undefined. Accepts a bare host or a full URL. */
function referrerHost(raw: string): string | undefined {
  const value = raw.trim()
  if (!value) return undefined
  try {
    // PARSE, never prefix-match (the content-pipeline lesson). `evil.com/?x=
    // instagram.com` must not read as Instagram, and it does under any
    // `includes()`.
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host || undefined
  } catch {
    return undefined
  }
}

const OUR_HOSTS = new Set(['hosthampton.com', 'app.hosthampton.com', 'localhost'])

/**
 * Collapse a first touch to the one enum label that best describes it.
 *
 * Reading order is deliberate, strongest evidence first:
 *
 *   1. `utm_source` — a tag WE put on a link. It says which campaign was
 *      clicked, and we authored it.
 *   2. `self_reported` — what they said when asked. Ranked above the referrer
 *      on purpose: someone who heard about us from a friend and then googled
 *      the name arrives with a Google referrer, and the friend is the real
 *      origin. The search was navigation, not discovery. It is also the only
 *      signal word-of-mouth and walk-ins EVER produce.
 *   3. `referrer` — a host the browser volunteered. Real, but it describes the
 *      last hop rather than the origin.
 *
 * `direct` is returned ONLY when all three are absent. It used to be returned
 * always, which is worse than useless: a column that says the same thing about
 * every row reads as an answer and is not one.
 */
export function deriveLeadSource(attribution: Attribution): LeadSource {
  const source = (attribution.utm_source || '').toLowerCase().replace(/^www\./, '')
  const medium = (attribution.utm_medium || '').toLowerCase()
  const paid = ['cpc', 'ppc', 'paid', 'paid_search', 'paidsearch'].includes(medium)

  if (source) {
    if (['instagram', 'instagram.com', 'l.instagram.com', 'ig'].includes(source)) return 'instagram'
    if (['facebook', 'facebook.com', 'm.facebook.com', 'l.facebook.com', 'fb'].includes(source)) {
      if (medium.includes('group')) return 'facebook_group'
      if (medium.includes('marketplace')) return 'facebook_marketplace'
      return 'facebook'
    }
    if (['google', 'google.com'].includes(source)) return paid ? 'google_ads' : 'google_organic'
    if (['nextdoor', 'nextdoor.com'].includes(source)) return 'nextdoor'
    if (['yelp', 'yelp.com'].includes(source)) return 'yelp'
    if (['email', 'brevo', 'newsletter'].includes(source) || medium === 'email') return 'email'
    if (['sms', 'text'].includes(source) || medium === 'sms') return 'sms'
    if (source === 'referral' || medium === 'partner' || medium === 'referral') return 'referral'
    // A tagged link from somewhere with no label of its own — `chatgpt.com`
    // today. `other` plus the verbatim blob, never a guess.
    return 'other'
  }

  const selfReported = attribution.self_reported
  if (selfReported) {
    const mapped = HEARD_ABOUT_BY_VALUE.get(selfReported)
    // The map is built from HEARD_ABOUT_OPTIONS, whose `leadSource` values are
    // type-checked against LeadSource — so this cannot mint a label the enum
    // does not hold. The fallback is belt-and-braces for a value that survived
    // the allowlist through some future edit.
    if (mapped) return mapped
  }

  const referrer = attribution.referrer
  if (referrer && !OUR_HOSTS.has(referrer)) {
    if (referrer.endsWith('instagram.com')) return 'instagram'
    if (referrer.endsWith('facebook.com') || referrer.endsWith('fb.com')) return 'facebook'
    if (referrer.endsWith('nextdoor.com')) return 'nextdoor'
    if (referrer.endsWith('yelp.com')) return 'yelp'
    // A Google referrer with no `gclid`/paid medium is organic search. Ads send
    // the tag; organic does not.
    if (referrer.endsWith('google.com') || referrer.startsWith('google.')) {
      return paid ? 'google_ads' : 'google_organic'
    }
    return 'other'
  }

  return 'direct'
}

/**
 * Read the posted first touch off a public request body, screened.
 *
 * ONE reader for all ten intake routes (rule 11). Two field names because the
 * browser bundle that posts `utm` is cached in visitors' browsers and will keep
 * posting it for as long as they hold that tab open — dropping the old name on
 * deploy day would quietly lose a day of attribution, which is the exact class
 * of silence this whole change is about.
 */
export function attributionFromBody(body: unknown): Attribution {
  if (!body || typeof body !== 'object') return {}
  const fields = body as Record<string, unknown>
  const measured = screenAttribution(fields.attribution ?? fields.utm)

  // "How did you hear about us?" is a FORM FIELD, not part of the blob the
  // browser stored at first touch — it is typed at submit time, on the page,
  // by a person. It is merged here so that the rest of the surface sees one
  // shape and no route has to remember there are two sources.
  const selfReported = screenHeardAbout(fields.heardAbout)
  if (!selfReported) return measured

  return screenAttribution({
    ...measured,
    self_reported: selfReported,
    self_reported_note: fields.heardAboutOther,
  })
}

/**
 * True when the blob carries anything worth writing.
 *
 * A self-report counts. It is the only signal a walk-in or a word-of-mouth
 * lead ever produces, so leaving it out here would mean the answer was
 * collected, screened, stored — and then declined by the first-touch guard in
 * `upsertContactResult` as "no signal", which is precisely the shape of
 * silence this whole surface was built to end.
 */
export function hasAttributionSignal(attribution: Attribution): boolean {
  return UTM_KEYS.some(k => !!attribution[k]) || !!attribution.referrer || !!attribution.self_reported
}
