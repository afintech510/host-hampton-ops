/**
 * The tripwire for the outbound template layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE-READING TEST AND NOT A RENDERING TEST. The escaping gap in
 * `lib/emailTemplates.ts` survived two reviews — `docs/reminder-engine-review.md`
 * §10.4 wrote it down and deliberately left it — and it survived because
 * **nothing failed** when somebody added a template that interpolated a
 * customer-written field straight into markup. A rendering test only covers the
 * templates whoever wrote it remembered to render; the 26th template is by
 * definition the one nobody remembered.
 *
 * So this reads the FILES, the way `slugSafety.test.ts` walks `src/app` and
 * `experimentsSchema.test.ts` parses migration 045 off disk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT AVOIDS BEING THE TEST SOMEBODY DELETES. Two design choices:
 *
 *  1. **It is a deny-list of FIELD NAMES, not an allow-list of expressions.** It
 *     does not try to be a type checker. It knows the ~60 field names in this
 *     codebase that carry human-written free text (`customerName`, `notes`,
 *     `contact_name`, `patchIdea`, …) and it fails when one of those reaches an
 *     HTML template literal without passing through `escapeHtml` — directly, or
 *     by having been rebound to an escaped value earlier in the same function
 *     (`const d = escapeFields(raw)`, which is how `lib/emailTemplates.ts`
 *     does it, and `const [a,b] = [...].map(v => escapeHtml(v ?? ''))`, which is
 *     how `email-templates/reminders.ts` did it first). Both spellings pass.
 *
 *  2. **Every exemption carries a reason, in code, beside the thing it
 *     exempts.** A false positive is fixed by adding one line with a sentence,
 *     not by weakening the check — which is the failure mode a strict test
 *     actually dies of.
 *
 * WHAT IT CANNOT SEE, stated rather than implied (rule 8 — a test that oversells
 * itself is a comment asserting the opposite of its code):
 *
 *  - It is a lexer. A field renamed on the way in (`const x = row.notes`) and
 *    then interpolated as `${x}` is invisible to the name list, unless the new
 *    name is also on it.
 *  - It only reads the files in `TEMPLATE_SOURCES`. A NEW file that builds mail
 *    HTML is covered by the second describe block, which walks `src` for
 *    `resend.emails.send` and fails if such a file is not on the list — so the
 *    list cannot go stale silently.
 *  - It says nothing about the plain-text half of an email, which must NOT be
 *    escaped. That distinction is enforced by only looking at literals that are
 *    building markup.
 */

import fs from 'fs'
import path from 'path'
import { scanSource, WEBSITE_SRC, stripNeutralised } from '../helpers/templateScan'

/* ───────────────────────────────────────────────────────────────────
 * The files that build outbound email HTML.
 * ─────────────────────────────────────────────────────────────────── */
const TEMPLATE_SOURCES = [
  'lib/emailTemplates.ts',
  'lib/email-templates/marketing-emails.ts',
  'lib/email-templates/summer-hair.ts',
  'lib/email-templates/event-newsletter.ts',
  'lib/email-templates/reminders.ts',
  'lib/planPayment.ts',
  'lib/planShare.ts',
  'lib/unclaimedPayment.ts',
  'lib/sequences/render.ts',
  'lib/agent/sendApproved.ts',
  'lib/experiments/screen.ts',
  'app/api/contact/route.ts',
  'app/api/quote/save/route.ts',
  'app/api/canvas-bag-inquiry/route.ts',
  'app/api/trucker-inquiry/route.ts',
  'app/api/mobile-party-inquiry/route.ts',
  'app/api/cm-cheer-order/route.ts',
  'app/api/studio-rental/edit/route.ts',
  'app/api/portal/notify-payment/route.ts',
  'app/api/portal/send-message/route.ts',
  'app/api/signup/route.ts',
  'app/api/webhook/route.ts',
  'app/api/admin/campaigns/actions/route.ts',
  'app/api/admin/pay-link/route.ts',
  'app/api/admin/gift-cards/send-promo/route.ts',
  'app/api/admin/orders/[id]/email/route.ts',
  'app/api/admin/events/[id]/email/route.ts',
]

/**
 * Field names that carry human-written free text somewhere in this codebase.
 *
 * A field is on this list because of who CAN write it, not who did (rule 5): an
 * admin-typed `location` is still a field an injected instruction could reach in
 * some other phase, and `docs/booking-agent-plan.md` §24 is what happens when
 * that argument is waved away.
 *
 * Matched on the LAST path segment, case-insensitively, with `_` removed — so
 * `d.customerName`, `booking.contact_name` and `m.contactName` are all one entry.
 */
const HOSTILE_FIELDS = [
  'name', 'firstname', 'lastname', 'fullname', 'customername', 'contactname', 'childname',
  'parentname', 'athletename', 'sendername', 'recipientname', 'purchasername', 'displayname',
  'email', 'customeremail', 'contactemail', 'purchaseremail', 'recipientemail', 'rawemail',
  'phone', 'customerphone', 'contactphone',
  'notes', 'note', 'message', 'adminmessage', 'personalmessage', 'details', 'summary',
  'vision', 'patchidea', 'colorpreference', 'occasion', 'company', 'businessname', 'ighandle',
  'organizationname', 'organizationtype', 'programname', 'itemname', 'packagename', 'packagetype',
  'eventtitle', 'eventtype', 'eventtypedisplay', 'eventdescription', 'partytheme', 'themename',
  'themedescription', 'location', 'title', 'description', 'headline', 'subline', 'preheader',
  'intro', 'promotext', 'availabilitynote', 'pricingnote', 'ctatext', 'variantlabel',
  'timeofday', 'preferreddate', 'partydate', 'partytime', 'eventdate', 'eventtime',
  'balanceduenote', 'methodlabel', 'paymentmethod', 'venmohandle', 'zelleemail',
  'reason', 'refundamount', 'invoicenumber', 'eventdatetime', 'docttitle', 'doctitle',
]

/**
 * Interpolations that are allowed to reach markup unescaped, each with the
 * reason. Keyed by `file:line-independent expression`, because a line number
 * would make every unrelated edit above it look like a new finding.
 *
 * ADD TO THIS LIST RATHER THAN WEAKENING THE CHECK — with a sentence saying why
 * the value is not text.
 */
const EXEMPT: { file: string; expr: string; why: string }[] = [
  {
    file: 'app/api/admin/events/[id]/email/route.ts',
    expr: 'htmlBody',
    why:
      'Deliberate HTML: EventsTab.tsx sends `editorRef.current.innerHTML` from a ' +
      'contentEditable rich-text composer, so escaping it would print the markup ' +
      'an admin just formatted. Admin-authored and admin-triggered; the reader is ' +
      'a customer, so the residual risk is an admin attacking their own customer.',
  },
  {
    file: 'app/api/admin/orders/[id]/email/route.ts',
    expr: 'htmlBody',
    why:
      'Same route shape, but this one is fed from a plain TEXTAREA — so the escape ' +
      'happens at the sender (OrdersTab.tsx) where the plain-text contract is known, ' +
      'and the route keeps accepting HTML for parity with the events composer.',
  },
  {
    file: 'lib/emailTemplates.ts',
    expr: 'i.name',
    why:
      '`lineItemRows` maps over the line items of an ALREADY-escaped data object — ' +
      '`escapeFields` recurses into arrays and objects, so `d.lineItems[].name` is ' +
      'escaped by the time this builder sees it, while `totalCents` and `quantity` ' +
      'stay numbers. The invariant it rests on (every call site passes `d.`, never ' +
      '`raw.`) is asserted by "line-item rows are built from escaped data" below, ' +
      'because an exemption whose reason is an invariant should be an exemption ' +
      'whose invariant is checked.',
  },
  {
    file: 'lib/email-templates/marketing-emails.ts',
    expr: 'headline',
    why:
      'A parameter of the internal `marketingHeader` helper, not a field. The file ' +
      'escapes at the entry of each EXPORTED template (before the defaults are ' +
      'destructured, because those defaults contain literal HTML entities), so the ' +
      'helpers receive values that are already escaped or are source literals. The ' +
      '"every exported template escapes at entry" test below is what holds that up.',
  },
  {
    file: 'lib/email-templates/marketing-emails.ts',
    expr: 'subline',
    why: 'Second parameter of the same helper, same convention as `headline` above.',
  },
  {
    file: 'lib/email-templates/marketing-emails.ts',
    expr: 'label',
    why: 'The button caption parameter of `ctaButton`; every call site passes a source literal.',
  },
]

function normaliseField(sym: string): string {
  const last = sym.split('.').pop() || sym
  return last.toLowerCase().replace(/_/g, '')
}

function isExempt(file: string, expr: string): boolean {
  return EXEMPT.some(e => e.file === file && e.expr === expr.trim())
}

describe('outbound email templates escape human-written fields', () => {
  for (const rel of TEMPLATE_SOURCES) {
    it(`${rel} interpolates no hostile field raw`, () => {
      const src = fs.readFileSync(path.join(WEBSITE_SRC, rel), 'utf8')
      const interps = scanSource(rel, src)
      const offenders: string[] = []
      for (const x of interps) {
        if (!x.html) continue
        if (x.urlAttr) continue // covered by the URL block below
        if (isExempt(rel, x.expr)) continue
        // A nested template literal is HTML already; its own interpolations are
        // scanned separately, so judging the wrapper would double-count.
        if (x.expr.includes('`')) continue
        // Same reasoning for a call to a builder declared in this file.
        if (x.inFileCall) continue
        // A ternary CONDITION emits nothing — `${intro ? escapeHtml(intro) : '…'}`
        // puts the escaped branch in the document and the bare `intro` nowhere.
        // Dropping conditions is what stops the check reporting the guard that
        // protects the very value it is checking.
        const surviving = stripNeutralised(x.expr).replace(/[A-Za-z_$][\w$.]*\s*\?/g, '?')
        for (const sym of x.symbols) {
          const field = normaliseField(sym)
          if (!HOSTILE_FIELDS.includes(field)) continue
          // Present in `symbols` but gone from the stripped text = it was inside
          // a neutralising call after all.
          //
          // Test the WHOLE path, not the leaf. Testing the leaf with a guard
          // that forbids a preceding `.` can never match a member expression —
          // `raw.fullName` has a dot in front of `fullName` by construction — so
          // this check silently excused every `${raw.someField}` in the file.
          // Found by reintroducing the defect and watching the test stay green,
          // not by reading it (rule 8, on my own patch, for the second time this
          // session).
          const escaped = sym.replace(/[.]/g, '\\.')
          if (!new RegExp(`(?:^|[^A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$])`).test(surviving)) continue
          // escape-at-entry: the name was rebound to an escaped value
          if (isEscapedBinding(src, sym)) continue
          offenders.push(`${rel}:${x.line}  ${x.fn}  \${${x.expr.replace(/\s+/g, ' ').slice(0, 110)}}`)
          break
        }
      }
      expect(offenders).toEqual([])
    })
  }
})

/**
 * Was this name bound to an already-escaped value?
 *
 * Recognises the two spellings this codebase uses, and nothing else:
 *   const d = escapeFields(raw)            → every `d.x` is escaped
 *   const { a, b } = escapeFields(params)  → `a` and `b` are escaped
 *   const [a, b] = [...].map(v => escapeHtml(v ?? ''))
 *   const first = escapeHtml(...)
 */
function isEscapedBinding(src: string, sym: string): boolean {
  const root = sym.includes('.') ? sym.split('.')[0] : sym
  const leaf = sym.split('.').pop() as string
  if (new RegExp(`const\\s+${root}\\s*=\\s*escapeFields\\(`).test(src)) return true
  if (new RegExp(`const\\s+${root}\\s*=\\s*escapeHtml\\(`).test(src)) return true
  // destructured out of escapeFields(...) — the binding list may span lines
  for (const m of src.matchAll(/const\s*(\{[\s\S]{0,600}?\}|\[[^\]]{0,300}\])\s*=\s*escapeFields\(/g)) {
    if (new RegExp(`(?:^|[^A-Za-z0-9_$])${leaf}(?:[^A-Za-z0-9_$]|$)`).test(m[1])) return true
  }
  // `const [a, b] = [...].map(v => escapeHtml(...))`
  for (const m of src.matchAll(/const\s*\[([^\]]{0,300})\]\s*=\s*\[[\s\S]{0,400}?\]\s*\.map\([^)]*escapeHtml/g)) {
    if (new RegExp(`(?:^|[^A-Za-z0-9_$])${leaf}(?:[^A-Za-z0-9_$]|$)`).test(m[1])) return true
  }
  // A local DERIVED from an already-escaped root, which is the third spelling
  // and the most common one: `const firstName = d.customerName.split(' ')[0]`
  // where `d` came out of `escapeFields`. Splitting an escaped string on a
  // space cannot re-create a `<`, so the derived value is still escaped.
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*)/g)) {
    if (m[1] !== leaf) continue
    const init = m[2]
    // The ROOT of each member chain, which is the only part that says where the
    // value came from. Without the leading guard, `d.name.split(' ')` yields
    // both `d` and `name` and the check asks whether a method receiver was
    // escaped — which it never is.
    const roots = [...init.matchAll(/(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\./g)].map(r => r[1])
    if (roots.length && roots.every(r => new RegExp(`const\\s+${r}\\s*=\\s*escapeFields\\(`).test(src))) return true
  }
  return false
}

describe('every URL in an email href goes through a URL screen, not an escaper', () => {
  const SCREENS = /^(?:mailHref|mailHrefExternal|mailToHref|telHref|safeImageUrl|safeSiteLink)\(/
  /**
   * Hrefs that are allowed to be built without a screen, with the reason.
   * A literal URL in the source is not data and needs no screen; these are the
   * cases where a *variable* is used and the screen lives elsewhere.
   */
  const URL_EXEMPT: { file: string; expr: string; why: string }[] = [
    {
      file: 'lib/emailTemplates.ts',
      expr: 'href',
      why: '`payButton` renders an href its CALLER already screened, and refuses to render at all when handed an empty string.',
    },
    {
      file: 'lib/email-templates/marketing-emails.ts',
      expr: 'href',
      why: '`ctaButton` is the same shape: it calls mailHref itself and returns nothing when refused.',
    },
    {
      file: 'lib/email-templates/reminders.ts',
      expr: 'mapsUrl',
      why: 'A hard-coded Google Maps URL for the studio address, built in the template from a literal. No data reaches it.',
    },
    {
      file: 'lib/email-templates/event-newsletter.ts',
      expr: 'escapeHtml(ticketUrl)',
      why: '`ticketUrl` is the output of `safeSiteLink` a few lines above, with a literal fallback; the escape is the attribute-encoding half.',
    },
    {
      file: 'lib/email-templates/event-newsletter.ts',
      expr: "escapeHtml(img.startsWith('/') ? `https://www.hosthampton.com${img}` : img)",
      why: '`img` is the output of `safeImageUrl`; the absolute-ising is because a mail client has no base URL.',
    },
    {
      file: 'lib/sequences/render.ts',
      expr: 'safe',
      why: '`safe` is the output of `mailHref` on the line above.',
    },
    {
      file: 'lib/agent/sendApproved.ts',
      expr: 'mailHref(siteUrl())',
      why: 'Screened inline.',
    },
    {
      file: 'lib/email-templates/marketing-emails.ts',
      expr: 'escapeHtml(imageUrl)',
      why: '`imageUrl` is the output of `safeImageUrl(params.imageUrl)` two lines above; the escape is the attribute-encoding half, which is the order rule 4 asks for — screen the URL, then encode for the attribute.',
    },
  ]

  for (const rel of TEMPLATE_SOURCES) {
    it(`${rel} screens every interpolated href/src`, () => {
      const src = fs.readFileSync(path.join(WEBSITE_SRC, rel), 'utf8')
      const offenders: string[] = []
      for (const x of scanSource(rel, src)) {
        if (!x.html || !x.urlAttr) continue
        const expr = x.expr.trim()
        if (SCREENS.test(expr)) continue
        if (URL_EXEMPT.some(e => e.file === rel && e.expr === expr)) continue
        offenders.push(`${rel}:${x.line}  ${x.fn}  ${x.urlAttr}="\${${expr.slice(0, 100)}}"`)
      }
      expect(offenders).toEqual([])
    })
  }
})

/**
 * The button builders take an href their CALLER screened — which makes the call
 * site the thing to check, and the href check above cannot see it because the
 * URL never appears inside an `href="…"` in that file.
 *
 * Without this, `payButton(raw.portalUrl, 'View Your Booking')` is invisible to
 * the whole suite: exactly the hole the exemption for `payButton` opens, closed
 * from the other side. Found by reintroducing the defect and watching every test
 * stay green.
 */
describe('button builders are handed a screened href', () => {
  const BUILDERS = ['payButton', 'ctaButton']
  const SCREENED_ARG = /^(?:mailHref|mailHrefExternal|safeSiteLink)\(/

  for (const rel of ['lib/emailTemplates.ts', 'lib/email-templates/marketing-emails.ts']) {
    it(`${rel} passes only screened URLs to its button builders`, () => {
      const src = fs.readFileSync(path.join(WEBSITE_SRC, rel), 'utf8')
      const offenders: string[] = []
      for (const builder of BUILDERS) {
        for (const m of src.matchAll(new RegExp(`\\b${builder}\\(([^,)]+)[,)]`, 'g'))) {
          const arg = m[1].trim()
          // the builder's own definition, e.g. `function payButton(href: string`
          if (/^href\b|^url\b|^label\b/.test(arg)) continue
          if (SCREENED_ARG.test(arg)) continue
          // `ctaButton(label, url)` screens internally, so its first arg is a caption
          if (builder === 'ctaButton') continue
          offenders.push(`${rel}  ${builder}(${arg.slice(0, 60)}…)`)
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('line-item rows are built from escaped data', () => {
    const src = fs.readFileSync(path.join(WEBSITE_SRC, 'lib/emailTemplates.ts'), 'utf8')
    const calls = [...src.matchAll(/lineItemRows\(([^)]*)\)/g)].map(m => m[1].trim())
    // the declaration itself takes `items`; every CALL must pass the escaped copy
    const fromRaw = calls.filter(a => !/^items\b/.test(a) && !a.startsWith('d.'))
    expect(fromRaw).toEqual([])
    expect(calls.filter(a => a.startsWith('d.')).length).toBeGreaterThan(0)
  })
})

describe('the file list cannot go stale', () => {
  function walk(d: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue
        walk(p, out)
      } else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  /**
   * Files that send mail but build no markup of their own — they pass a template
   * function's output straight to Resend. Listed so the walker below does not
   * demand they be audited as template sources.
   */
  const SENDS_BUT_TEMPLATES_ELSEWHERE = [
    'app/api/admin/campaigns/test/route.ts',
    'app/api/admin/events/[id]/tickets/[ticketId]/refund/route.ts',
    'app/api/admin/orders/[id]/refund/route.ts',
    'app/api/admin/orders/[id]/resend/route.ts',
    'app/api/admin/parties/create/route.ts',
    'app/api/admin/parties/[id]/route.ts',
    'app/api/admin/studio-rental/invite/route.ts',
    'app/api/checkout/route.ts',
    'app/api/cron/send-reminders/route.ts',
    'app/api/events/checkout/route.ts',
    'app/api/fundraiser-inquiry/route.ts',
    'app/api/party-builder/save/route.ts',
    'app/api/party-checkout/route.ts',
    'app/api/portal/email-auth/request/route.ts',
    'app/api/portal/resend-link/route.ts',
    'app/api/summer-hair/book/route.ts',
    'lib/brevo.ts',
    'lib/sequences/processor.ts',
    'app/api/lead/route.ts',
  ]

  /**
   * The positive half of the check, and the one that catches what a lexer
   * cannot.
   *
   * The deny-list above reads INTERPOLATIONS. A field that reaches markup
   * through a data structure is invisible to it — which is not hypothetical:
   * `reminders.ts` escaped five fields with `.map(v => escapeHtml(…))` and
   * destructured `eventDate`, `partyDate` and `balanceDueNote` raw beside them,
   * and all three reached the mail through `detailCard([{ value: partyDate }])`.
   * A per-field list is a list somebody has to keep complete; an escape-at-entry
   * line is one statement about the whole function.
   *
   * So: every exported template in the template MODULES must begin by escaping
   * its input. The route files are excluded because they escape at the
   * interpolation instead — they build one body inline rather than exporting a
   * template — and the deny-list above is the right check for that shape.
   */
  const TEMPLATE_MODULES = [
    'lib/emailTemplates.ts',
    'lib/email-templates/marketing-emails.ts',
    'lib/email-templates/summer-hair.ts',
    'lib/email-templates/reminders.ts',
  ]

  it('every exported template escapes its input at entry', () => {
    const offenders: string[] = []
    for (const rel of TEMPLATE_MODULES) {
      const src = fs.readFileSync(path.join(WEBSITE_SRC, rel), 'utf8')
      const fns = [...src.matchAll(/export function ([A-Za-z_$][\w$]*)\s*\(/g)]
      for (let i = 0; i < fns.length; i++) {
        const name = fns[i][1]
        const start = fns[i].index as number
        const end = i + 1 < fns.length ? (fns[i + 1].index as number) : src.length
        const body = src.slice(start, end)
        // A template that takes no data cannot leak any.
        if (/^export function [A-Za-z_$][\w$]*\s*\(\s*\)/.test(body)) continue
        if (body.includes('escapeFields(')) continue
        offenders.push(`${rel}  ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every file that sends mail is either audited or listed as template-free', () => {
    const unlisted: string[] = []
    for (const abs of walk(WEBSITE_SRC)) {
      const src = fs.readFileSync(abs, 'utf8')
      if (!/resend\.emails\.send|new Resend\(/.test(src)) continue
      const rel = path.relative(WEBSITE_SRC, abs).split(path.sep).join('/')
      if (TEMPLATE_SOURCES.includes(rel)) continue
      if (SENDS_BUT_TEMPLATES_ELSEWHERE.includes(rel)) continue
      unlisted.push(rel)
    }
    expect(unlisted).toEqual([])
  })

  it('no file outside lib/escapeHtml.ts defines its own HTML escaper', () => {
    const dupes: string[] = []
    /**
     * `app/sitemap.xml/route.ts` escapes for XML, not HTML — a different entity
     * set (`&apos;` is XML, `&#39;` is what HTML wants) for a different reader.
     * Two screens for two languages is not rule 11; one screen used for both
     * would be.
     */
    const NOT_AN_HTML_ESCAPER = ['app/sitemap.xml/route.ts']
    for (const abs of walk(WEBSITE_SRC)) {
      const rel = path.relative(WEBSITE_SRC, abs).split(path.sep).join('/')
      if (rel === 'lib/escapeHtml.ts') continue
      if (NOT_AN_HTML_ESCAPER.includes(rel)) continue
      const src = fs.readFileSync(abs, 'utf8')
      // The signature of a hand-rolled escaper: a chain that replaces `<` with
      // its entity. Three of these existed (lib/agent/sendApproved.ts,
      // app/api/portal/send-message/route.ts, and escapeHtml itself), two of
      // them missing `"` — rule 11's sharpest form.
      if (/replace\(\/</g.test(src) && /&lt;/.test(src) && /&amp;/.test(src) && /replace\(/.test(src)) {
        if (/\.replace\(\/&\/g,\s*'&amp;'\)[\s\S]{0,120}?\.replace\(\/<\/g,\s*'&lt;'\)/.test(src)) dupes.push(rel)
      }
    }
    expect(dupes).toEqual([])
  })

  it('every exemption carries a reason', () => {
    for (const e of EXEMPT) {
      expect(e.why.length).toBeGreaterThan(40)
    }
  })
})
