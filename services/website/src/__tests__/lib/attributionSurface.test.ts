/**
 * Attribution — where an inquiry came from.
 *
 * What was live before this file existed, measured on production 2026-09-15:
 *
 *   - `contacts.source` was the LITERAL `'direct'` for every website contact,
 *     written on insert and again on every later update. It is the one channel
 *     column the admin Contacts tab displays, and it said the same thing about
 *     all 1217 rows.
 *   - `captureUtm()` was called from inside the four form components, so a tag
 *     was only ever read off the URL of the page that HELD the form. A visitor
 *     who landed on the homepage from a tagged link and clicked through arrived
 *     with a clean URL. Result: **95 form submissions in six months, 3 carrying
 *     any UTM**, and all three only because the tagged page was the form's own.
 *   - The three that survived were dropped into `contact_interactions.metadata`
 *     — a JSON blob no screen reads — and `/api/checkout` did `void utm`, which
 *     discarded it on the one path where money follows.
 *   - Six of the intake routes never had UTM plumbing at all.
 *
 * The rules below are in two halves. The first half exercises the module. The
 * second half READS THE SOURCE, because every one of the failures above was a
 * missing call site rather than a wrong function, and a unit test of a function
 * nobody calls is exactly the shape of guard this repository keeps finding
 * holes in.
 *
 * House style, and every clause of it is load-bearing (see
 * `tripwires-are-satisfied-by-the-wrong-occurrence`): comments are STRIPPED
 * before any source rule runs, anchors tolerate CRLF, the file lists are walked
 * rather than enumerated, and each rule asserts how many files it actually
 * examined so that a rule matching nothing fails loudly instead of passing.
 */

import fs from 'fs'
import path from 'path'
import {
  screenAttribution,
  deriveLeadSource,
  attributionFromBody,
  hasAttributionSignal,
  screenHeardAbout,
  HEARD_ABOUT_OPTIONS,
  LEAD_SOURCES,
} from '@/lib/attribution'
import { LEAD_SOURCE_LABELS } from '../helpers/fakeContactsDb'

const SRC = path.join(process.cwd(), 'src')

/** Blank out comments, preserving offsets. One left-to-right pass. */
function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      out.push(...walk(p, match))
    } else if (match.test(e.name)) out.push(p)
  }
  return out.sort()
}

const read = (p: string) => decomment(fs.readFileSync(p, 'utf8'))
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

describe('screenAttribution', () => {
  it('keeps the five UTM keys and drops everything else', () => {
    const out = screenAttribution({
      utm_source: 'instagram',
      utm_medium: 'story',
      utm_campaign: 'fall_2026',
      utm_content: 'a',
      utm_term: 'b',
      admin: true,
      id: '00000000-0000-0000-0000-000000000000',
    })
    expect(out).toEqual({
      utm_source: 'instagram',
      utm_medium: 'story',
      utm_campaign: 'fall_2026',
      utm_content: 'a',
      utm_term: 'b',
    })
  })

  it('refuses a non-object, an array and a null', () => {
    for (const bad of [null, undefined, 'instagram', 42, ['utm_source'], true]) {
      expect(screenAttribution(bad)).toEqual({})
    }
  })

  it('drops a non-string value rather than stringifying it', () => {
    expect(screenAttribution({ utm_source: { toString: () => 'facebook' } })).toEqual({})
    expect(screenAttribution({ utm_source: ['facebook'] })).toEqual({})
  })

  it('bounds a long value at 200 characters', () => {
    const out = screenAttribution({ utm_campaign: 'x'.repeat(5000) })
    expect(out.utm_campaign).toHaveLength(200)
  })

  it('strips control characters — a newline here is a forged log/CSV row', () => {
    const out = screenAttribution({ utm_source: 'insta\ngram\r\nadmin=true\x00' })
    expect(out.utm_source).not.toMatch(/[\n\r\x00]/)
  })

  it('keeps hyphens and underscores, which real campaign names use', () => {
    const out = screenAttribution({ utm_campaign: 'kids_parties-spring_2026' })
    expect(out.utm_campaign).toBe('kids_parties-spring_2026')
  })

  it('reduces a referrer to its host and never keeps the path or query', () => {
    const out = screenAttribution({
      referrer: 'https://www.google.com/search?q=birthday+party+hampton+bays&pws=1',
    })
    expect(out.referrer).toBe('google.com')
  })

  it('accepts a bare host as a referrer', () => {
    expect(screenAttribution({ referrer: 'instagram.com' }).referrer).toBe('instagram.com')
  })

  it('drops an unparseable referrer instead of storing the raw text', () => {
    expect(screenAttribution({ referrer: '://///' }).referrer).toBeUndefined()
  })

  it('keeps a landing path but refuses a URL or a protocol-relative one', () => {
    expect(screenAttribution({ landing_path: '/party-packages' }).landing_path).toBe('/party-packages')
    // `//evil.com` is a URL to a browser and a path to a naive check — the
    // second door from the content-pipeline finding.
    expect(screenAttribution({ landing_path: '//evil.com/x' }).landing_path).toBeUndefined()
    expect(screenAttribution({ landing_path: 'https://evil.com/x' }).landing_path).toBeUndefined()
    expect(screenAttribution({ landing_path: 'javascript:alert(1)' }).landing_path).toBeUndefined()
  })

  it('strips a query string off the landing path', () => {
    expect(screenAttribution({ landing_path: '/book?token=secret' }).landing_path).toBe('/book')
  })

  it('refuses a captured_at outside a plausible window', () => {
    expect(screenAttribution({ captured_at: '3000-01-01T00:00:00Z' }).captured_at).toBeUndefined()
    expect(screenAttribution({ captured_at: '1999-01-01T00:00:00Z' }).captured_at).toBeUndefined()
    expect(screenAttribution({ captured_at: 'yesterday' }).captured_at).toBeUndefined()
    const now = new Date().toISOString()
    expect(screenAttribution({ captured_at: now }).captured_at).toBe(now)
  })

  it('is idempotent — screening an already-screened blob changes nothing', () => {
    const once = screenAttribution({ utm_source: 'facebook', referrer: 'https://facebook.com/x' })
    expect(screenAttribution(once)).toEqual(once)
  })
})

describe('deriveLeadSource', () => {
  it('LEAD_SOURCES matches pg_enum lead_source exactly, in order', () => {
    // Two independent transcriptions of the same live enum. If they drift, one
    // of them is wrong about the database and `deriveLeadSource` can mint a
    // value that refuses at INSERT.
    expect([...LEAD_SOURCES]).toEqual(LEAD_SOURCE_LABELS)
  })

  it('only ever returns a label the lead_source enum holds', () => {
    // The enum is a PG type: a value it does not hold is a 22P02 at INSERT, and
    // the intake routes swallow that non-fatally — so a mis-derived channel
    // would drop the whole contact, silently, on the first lead from a channel
    // nobody anticipated.
    const inputs = [
      {}, { utm_source: 'instagram' }, { utm_source: 'FaceBook' }, { utm_source: 'chatgpt.com' },
      { utm_source: 'google', utm_medium: 'cpc' }, { utm_source: 'google' },
      { referrer: 'perplexity.ai' }, { referrer: 'hosthampton.com' }, { utm_medium: 'partner' },
      { utm_source: '<script>' }, { utm_source: 'x'.repeat(200) },
    ]
    for (const input of inputs) {
      expect(LEAD_SOURCES).toContain(deriveLeadSource(input))
    }
  })

  it('maps the named channels', () => {
    expect(deriveLeadSource({ utm_source: 'instagram' })).toBe('instagram')
    expect(deriveLeadSource({ utm_source: 'facebook' })).toBe('facebook')
    expect(deriveLeadSource({ utm_source: 'nextdoor' })).toBe('nextdoor')
    expect(deriveLeadSource({ utm_source: 'yelp' })).toBe('yelp')
    expect(deriveLeadSource({ utm_source: 'brevo' })).toBe('email')
  })

  it('is case-insensitive and ignores a www. prefix', () => {
    expect(deriveLeadSource({ utm_source: 'InStaGram.com' })).toBe('instagram')
    expect(deriveLeadSource({ utm_source: 'www.facebook.com' })).toBe('facebook')
  })

  it('splits Google paid from Google organic on the medium', () => {
    expect(deriveLeadSource({ utm_source: 'google', utm_medium: 'cpc' })).toBe('google_ads')
    expect(deriveLeadSource({ utm_source: 'google', utm_medium: 'organic' })).toBe('google_organic')
    expect(deriveLeadSource({ utm_source: 'google' })).toBe('google_organic')
  })

  it('splits the Facebook surfaces on the medium', () => {
    expect(deriveLeadSource({ utm_source: 'facebook', utm_medium: 'group_post' })).toBe('facebook_group')
    expect(deriveLeadSource({ utm_source: 'facebook', utm_medium: 'marketplace' })).toBe('facebook_marketplace')
  })

  it('answers `other` for a real but unlabelled source — chatgpt.com is all we have ever captured', () => {
    expect(deriveLeadSource({ utm_source: 'chatgpt.com' })).toBe('other')
    // ...and the verbatim tag has to survive, because `other` is not the answer.
    expect(screenAttribution({ utm_source: 'chatgpt.com' }).utm_source).toBe('chatgpt.com')
  })

  it('falls back to the referrer only when there is no tag', () => {
    expect(deriveLeadSource({ referrer: 'instagram.com' })).toBe('instagram')
    expect(deriveLeadSource({ utm_source: 'yelp', referrer: 'instagram.com' })).toBe('yelp')
  })

  it('does not credit a channel for our own site', () => {
    expect(deriveLeadSource({ referrer: 'hosthampton.com' })).toBe('direct')
  })

  it('answers `direct` only when there is genuinely no signal', () => {
    expect(deriveLeadSource({})).toBe('direct')
    expect(deriveLeadSource({ landing_path: '/party-packages' })).toBe('direct')
    // Anything with a signal must NOT be direct — that collapse is the whole bug.
    expect(deriveLeadSource({ utm_source: 'somewhere-new' })).not.toBe('direct')
    expect(deriveLeadSource({ referrer: 'somewhere-new.com' })).not.toBe('direct')
  })

  it('cannot be fooled by a host substring in a referrer', () => {
    // `evil.com/?x=instagram.com` under any `includes()` reads as Instagram.
    expect(deriveLeadSource(screenAttribution({ referrer: 'https://evil.com/?x=instagram.com' }))).toBe('other')
  })
})

describe('"How did you hear about us?"', () => {
  it('every option maps to a label the lead_source enum holds', () => {
    // Same failure as `deriveLeadSource`: an option whose `leadSource` the enum
    // does not hold would drop the whole contact on the first person who picks
    // it. This is the rule that makes adding an option safe.
    for (const option of HEARD_ABOUT_OPTIONS) {
      expect(LEAD_SOURCES).toContain(option.leadSource)
    }
  })

  it('has unique values and no empty label', () => {
    const values = HEARD_ABOUT_OPTIONS.map(o => o.value)
    expect(new Set(values).size).toBe(values.length)
    expect(HEARD_ABOUT_OPTIONS.every(o => o.label.trim().length > 0)).toBe(true)
  })

  it('offers word-of-mouth and walk-in — the channels no browser can measure', () => {
    // The entire justification for asking. If these two ever leave the list,
    // the question is just a worse copy of the UTM.
    const sources = HEARD_ABOUT_OPTIONS.map(o => o.leadSource)
    expect(sources).toContain('referral')
    expect(sources).toContain('walk_in')
  })

  it('accepts only a value we offered', () => {
    for (const option of HEARD_ABOUT_OPTIONS) {
      expect(screenHeardAbout(option.value)).toBe(option.value)
    }
    for (const bad of ['', 'INSTAGRAM', 'tiktok', 'friend', null, 7, {}, ['instagram']]) {
      expect(screenHeardAbout(bad)).toBeUndefined()
    }
  })

  it('tolerates surrounding whitespace but not a different value', () => {
    // Forgiving about a stray space (losing a real answer to one is worse than
    // accepting it), strict about everything else.
    expect(screenHeardAbout('  friend_referral  ')).toBe('friend_referral')
    expect(screenHeardAbout('friend_referral!')).toBeUndefined()
  })

  it('is stored in its own key and never merged into utm_source', () => {
    const out = screenAttribution({ self_reported: 'friend_referral' })
    expect(out.self_reported).toBe('friend_referral')
    expect(out.utm_source).toBeUndefined()
  })

  it('keeps the free-text note only against "something else"', () => {
    const kept = screenAttribution({ self_reported: 'something_else', self_reported_note: 'saw the van' })
    expect(kept.self_reported_note).toBe('saw the van')

    // A note beside a chosen option would contradict the option itself.
    const dropped = screenAttribution({ self_reported: 'instagram', self_reported_note: 'saw the van' })
    expect(dropped.self_reported_note).toBeUndefined()
  })

  it('bounds and de-fangs the free text', () => {
    const out = screenAttribution({ self_reported: 'something_else', self_reported_note: 'x'.repeat(5000) })
    expect(out.self_reported_note).toHaveLength(200)

    const nasty = screenAttribution({ self_reported: 'something_else', self_reported_note: 'a\nb\r\nc' })
    expect(nasty.self_reported_note).not.toMatch(/[\n\r]/)
  })

  it('counts as a signal — otherwise the answer is collected and then declined', () => {
    expect(hasAttributionSignal({ self_reported: 'friend_referral' })).toBe(true)
  })

  it('derives the channel a browser could never have seen', () => {
    expect(deriveLeadSource({ self_reported: 'friend_referral' })).toBe('referral')
    expect(deriveLeadSource({ self_reported: 'drove_by' })).toBe('walk_in')
    expect(deriveLeadSource({ self_reported: 'event_or_market' })).toBe('pop_up_market')
  })

  it('ranks BELOW a tag we set and ABOVE a referrer we merely observed', () => {
    // We tagged the link, so the click is the stronger claim.
    expect(deriveLeadSource({ utm_source: 'instagram', self_reported: 'friend_referral' })).toBe('instagram')
    // They heard it from a friend and then googled the name. The friend is the
    // origin; the search was navigation.
    expect(deriveLeadSource({ referrer: 'google.com', self_reported: 'friend_referral' })).toBe('referral')
  })

  it('never lets an unknown answer reach the enum', () => {
    // Straight past the allowlist into the deriver, which is the path a future
    // refactor could open.
    expect(LEAD_SOURCES).toContain(deriveLeadSource({ self_reported: 'tiktok' } as never))
  })
})

describe('attributionFromBody', () => {
  it('reads heardAbout off the body — it is a form field, not part of the blob', () => {
    const out = attributionFromBody({ heardAbout: 'friend_referral' })
    expect(out.self_reported).toBe('friend_referral')
  })

  it('merges the form answer with the stored first touch, losing neither', () => {
    const out = attributionFromBody({
      attribution: { utm_source: 'instagram', landing_path: '/party-packages' },
      heardAbout: 'friend_referral',
    })
    expect(out.utm_source).toBe('instagram')
    expect(out.landing_path).toBe('/party-packages')
    expect(out.self_reported).toBe('friend_referral')
  })

  it('carries heardAboutOther through under its stored name', () => {
    const out = attributionFromBody({ heardAbout: 'something_else', heardAboutOther: 'the sign on 27' })
    expect(out.self_reported_note).toBe('the sign on 27')
  })

  it('ignores an unknown heardAbout rather than storing it', () => {
    const out = attributionFromBody({ heardAbout: 'tiktok', attribution: { utm_source: 'yelp' } })
    expect(out.self_reported).toBeUndefined()
    expect(out.utm_source).toBe('yelp')
  })

  it('reads the new field name', () => {
    expect(attributionFromBody({ attribution: { utm_source: 'yelp' } }).utm_source).toBe('yelp')
  })

  it('still reads the pre-053 `utm` field name', () => {
    // Browsers hold the old bundle until the tab is closed. Dropping this would
    // lose a day of attribution on deploy day — silently, which is the exact
    // failure this whole change is about.
    expect(attributionFromBody({ utm: { utm_source: 'yelp' } }).utm_source).toBe('yelp')
  })

  it('screens what it reads — it is not a passthrough', () => {
    const out = attributionFromBody({ attribution: { utm_source: 'a\nb', evil: 1, landing_path: '//x' } })
    expect(out.utm_source).not.toMatch(/\n/)
    expect(out).not.toHaveProperty('evil')
    expect(out.landing_path).toBeUndefined()
  })

  it('survives a body that is not an object', () => {
    for (const bad of [null, undefined, 'x', 7, []]) expect(attributionFromBody(bad)).toEqual({})
  })
})

describe('hasAttributionSignal', () => {
  it('is false for an empty blob and for a landing path alone', () => {
    expect(hasAttributionSignal({})).toBe(false)
    expect(hasAttributionSignal({ landing_path: '/x', captured_at: new Date().toISOString() })).toBe(false)
  })

  it('is true for any UTM key or a referrer', () => {
    expect(hasAttributionSignal({ utm_source: 'x' })).toBe(true)
    expect(hasAttributionSignal({ utm_campaign: 'x' })).toBe(true)
    expect(hasAttributionSignal({ referrer: 'instagram.com' })).toBe(true)
  })
})

/* ── Source rules ──────────────────────────────────────────────────────────
 *
 * The unit tests above would all have passed on 2026-09-14, when the answer
 * reached no row at all.
 */

/** Intake routes: public, and they create the contact or the plan. */
const INTAKE_ROUTES = [
  'lead', 'contact', 'mobile-party-inquiry', 'trucker-inquiry', 'canvas-bag-inquiry',
  'fundraiser-inquiry', 'quote/save', 'party-builder/save', 'party-checkout', 'checkout',
]

describe('every intake route records the first touch', () => {
  it('reads the posted attribution through the one screen', () => {
    const missing: string[] = []
    for (const route of INTAKE_ROUTES) {
      const file = path.join(SRC, 'app', 'api', ...route.split('/'), 'route.ts')
      // A renamed route must fail here, not silently leave INTAKE_ROUTES stale.
      expect(`${route}: ${fs.existsSync(file)}`).toBe(`${route}: true`)
      const src = read(file)
      if (!/attributionFromBody\s*\(/.test(src)) missing.push(route)
    }
    expect(missing).toEqual([])
  })

  it('passes it to every contact and plan write it makes', () => {
    const offenders: string[] = []
    let callsChecked = 0

    for (const route of INTAKE_ROUTES) {
      const file = path.join(SRC, 'app', 'api', ...route.split('/'), 'route.ts')
      const src = read(file)

      // Brace-match each call from the end of its argument-opening `{`, so a
      // nested object inside the call cannot end the match early and so an
      // `attribution` belonging to a DIFFERENT call cannot satisfy this one.
      for (const fn of ['upsertContact', 'upsertContactResult', 'ensureLeadPlan']) {
        const re = new RegExp(`\\b${fn}\\s*\\(\\s*\\{`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) {
          const open = m.index + m[0].length - 1
          let depth = 0
          let end = open
          for (let i = open; i < src.length; i++) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
          }
          const args = src.slice(open, end + 1)
          callsChecked++
          if (!/\battribution\b/.test(args)) offenders.push(`${route} → ${fn}()`)
        }
      }
    }

    expect(callsChecked).toBeGreaterThanOrEqual(12)
    // Any entry here is a contact/plan write that drops the first touch.
    expect(offenders).toEqual([])
  })

  it('never re-hardcodes a channel literal in place of the derived one', () => {
    // `source: 'direct'` on the email path is the original bug verbatim. The
    // phone path keeps it deliberately (a texter has no browser, so `direct` is
    // a real answer there) and is the single permitted occurrence.
    const contacts = read(path.join(SRC, 'lib', 'contacts.ts'))
    const literals = contacts.match(/source:\s*'direct'/g) || []
    expect(literals).toHaveLength(1)
    expect(contacts).toMatch(/upsertContactByPhone[\s\S]*source:\s*'direct'/)
  })
})

describe('the browser captures the first touch site-wide', () => {
  it('mounts the capture in the ROOT layout, not in a form', () => {
    // The whole finding: capture that lives in the form only sees the URL of
    // the page the form is on.
    const layout = read(path.join(SRC, 'app', 'layout.tsx'))
    expect(layout).toMatch(/<AttributionCapture\s*\/>/)
    expect(layout).toMatch(/import AttributionCapture from '@\/components\/AttributionCapture'/)

    const component = read(path.join(SRC, 'components', 'AttributionCapture.tsx'))
    expect(component).toMatch(/captureAttribution\(\)/)
  })

  it('has no per-form capture left to drift from it', () => {
    const offenders = walk(SRC, /\.tsx?$/)
      .filter(p => !rel(p).startsWith('lib/utm'))
      .filter(p => /\bcaptureAttribution\s*\(/.test(read(p)))
      .map(rel)
    expect(offenders).toEqual(['components/AttributionCapture.tsx'])
  })

  it('records first touch and does not overwrite it later in the visit', () => {
    const utm = read(path.join(SRC, 'lib', 'utm.ts'))
    // The guard that makes it first-touch: an existing value returns early.
    expect(utm).toMatch(/if\s*\(\s*sessionStorage\.getItem\([A-Z_]+\)\s*\)\s*return/)
  })

  it('every client POST to an intake route carries it', () => {
    const endpoints = INTAKE_ROUTES.map(r => `/api/${r}`)
    const offenders: string[] = []
    let postsChecked = 0

    for (const file of walk(SRC, /\.tsx$/)) {
      const src = read(file)
      for (const endpoint of endpoints) {
        const re = new RegExp(`fetch\\(\\s*'${endpoint.replace(/\//g, '\\/')}'`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) {
          // The body of a fetch is within the options object that follows it.
          const window = src.slice(m.index, m.index + 2500)
          if (!/body:\s*JSON\.stringify\(/.test(window)) continue
          postsChecked++
          if (!/getAttribution\(\)/.test(window)) offenders.push(`${rel(file)} → ${endpoint}`)
        }
      }
    }

    expect(postsChecked).toBeGreaterThanOrEqual(15)
    // Any entry here is a form posting an inquiry with no first touch.
    expect(offenders).toEqual([])
  })

  it('nothing discards the posted value any more', () => {
    // `/api/checkout` ended with `void utm` — a deliberate discard on the one
    // path where money follows the lead.
    const offenders = walk(path.join(SRC, 'app', 'api'), /route\.ts$/)
      .filter(p => /\bvoid\s+(utm|attribution)\b/.test(read(p)))
      .map(rel)
    expect(offenders).toEqual([])
  })
})

/**
 * The forms that carry "How did you hear about us?".
 *
 * This is the set that had real inquiry volume in the 60 days to 2026-09-15:
 * mobile-party 19, party-packages 8, kids-party-menu 6, trucker-hat-bar 6,
 * party-room-rental 6, contact-us 2. Enumerated rather than walked because
 * "every form" is not the rule — a checkout body is not an inquiry and does
 * not get asked.
 */
const ASKING_FORMS = [
  'components/MobilePartyForm.tsx',
  'components/ContactForm.tsx',
  'components/RoomRentalLeadForm.tsx',
  'components/DraftPartyLeadForm.tsx',
  'app/trucker-hat-bar/InquiryForm.tsx',
  'app/party-packages/PartyPackagesContent.tsx',
  'app/kids-party-menu/KidsPartyMenuContent.tsx',
]

describe('the question is actually asked, and the answer actually posted', () => {
  it('every asking form renders the field and posts the answer', () => {
    const offenders: string[] = []
    for (const form of ASKING_FORMS) {
      const file = path.join(SRC, ...form.split('/'))
      expect(`${form}: ${fs.existsSync(file)}`).toBe(`${form}: true`)
      const src = read(file)
      // Rendered AND posted. A form that shows the dropdown but never sends it
      // is the most expensive failure available here: it looks like the
      // question is being asked and answered, and nothing is recorded.
      if (!/<HeardAboutSelect\b/.test(src)) offenders.push(`${form}: not rendered`)
      if (!/heardAboutFields\s*\(/.test(src)) offenders.push(`${form}: answer not posted`)
    }
    expect(offenders).toEqual([])
  })

  it('the posted field names are the ones the server reads', () => {
    // `heardAboutFields` is the only writer of these two names and
    // `attributionFromBody` is the only reader. If they drift, the answer is
    // collected and silently dropped — and the symptom is indistinguishable
    // from "nobody answers that question".
    const helper = read(path.join(SRC, 'components', 'HeardAboutSelect.tsx'))
    const lib = read(path.join(SRC, 'lib', 'attribution.ts'))
    for (const field of ['heardAbout', 'heardAboutOther']) {
      expect(helper).toContain(field)
      expect(lib).toContain(field)
    }
  })

  it('no form builds its own option list', () => {
    // One list, in the module that knows what each option MEANS (rule 11).
    const offenders = walk(SRC, /\.tsx$/)
      .filter(p => rel(p) !== 'components/HeardAboutSelect.tsx')
      .filter(p => /How did you hear about us/i.test(read(p)))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the field is optional on every form that has it', () => {
    // A required question on an inquiry form costs inquiries, and a lead we
    // lose is worth more than a lead we can attribute.
    const component = read(path.join(SRC, 'components', 'HeardAboutSelect.tsx'))
    expect(component).not.toMatch(/<select[^>]*\brequired\b/)
    expect(component).toMatch(/<option value="">/)
  })
})

describe('the answer is readable by a human', () => {
  it('the admin Marketing tab reads the attribution summary', () => {
    const route = read(path.join(SRC, 'app', 'api', 'admin', 'marketing', 'route.ts'))
    expect(route).toMatch(/attribution:\s*summarizeAttribution\(/)
    // Rule 12: a failed read is reported, never rendered as zero.
    expect(route).toMatch(/unreadable/)

    const tab = read(path.join(SRC, 'app', 'admin', 'MarketingTab.tsx'))
    expect(tab).toMatch(/attribution\?\.unreadable/)
    expect(tab).toMatch(/byUtmSource/)
  })

  it('a self-report is labelled as one, never counted as a measured tag', () => {
    // The two are different claims. A chart that silently merges them invites
    // a spending decision made on the weaker evidence.
    const route = read(path.join(SRC, 'app', 'api', 'admin', 'marketing', 'route.ts'))
    expect(route).toMatch(/said so/)
    expect(route).toMatch(/referrer\)/)
  })

  it('the free-text answers reach a human — they are the next option', () => {
    const route = read(path.join(SRC, 'app', 'api', 'admin', 'marketing', 'route.ts'))
    expect(route).toMatch(/selfReportedNotes/)
    const tab = read(path.join(SRC, 'app', 'admin', 'MarketingTab.tsx'))
    expect(tab).toMatch(/selfReportedNotes/)
  })
})
