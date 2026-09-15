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
 * Reading order is deliberate: an explicit `utm_source` beats an inferred
 * referrer, because the tag is what we put on the link ourselves and the
 * referrer is whatever the browser felt like sending.
 *
 * `direct` is returned ONLY when there is no signal at all. It used to be
 * returned always, which is worse than useless: a column that says the same
 * thing about every row reads as an answer and is not one.
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
  return screenAttribution(fields.attribution ?? fields.utm)
}

/** True when the blob carries anything worth writing. */
export function hasAttributionSignal(attribution: Attribution): boolean {
  return UTM_KEYS.some(k => !!attribution[k]) || !!attribution.referrer
}
