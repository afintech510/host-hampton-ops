/**
 * The invoice's in-page card payment and its waiver button — source rules.
 *
 * `/plan/[ref]/summary` used to send every customer to a hosted Stripe Payment
 * Link. It now opens Stripe's card form in place through `/api/portal/pay`, can
 * take a bounded PART payment, and offers the room-rental waiver. The behaviour
 * is driven in `portalPayInvoicePurpose.test.ts`, `invoicePartialPay.test.ts`,
 * `planWaiverLink.test.ts` and `webhookMoneyBranches.test.ts`; these rules guard
 * the SHAPE that keeps it safe, so a later refactor cannot quietly move the
 * amount back into the browser.
 *
 * Conventions (AGENTS.md §11): comments are stripped before any rule runs, every
 * anchor tolerates CRLF, no `.skip`, and each rule counts what it examined.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')
const read = (r: string) => fs.readFileSync(path.join(SRC, r), 'utf8')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const code = (r: string) => decomment(read(r))

const PANEL = 'app/plan/[ref]/summary/PayPanel.tsx'
const PAGE = 'app/plan/[ref]/summary/page.tsx'
const PAY_ROUTE = 'app/api/portal/pay/route.ts'
const WAIVER_ROUTE = 'app/api/plan/[ref]/waiver-link/route.ts'

/** The text of a `{ … }` body whose opening brace is the first `{` at/after `from`. */
function braceBody(src: string, from: number): string {
  const open = src.indexOf('{', from)
  expect(open).toBeGreaterThan(-1)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error('unbalanced braces')
}

describe('the sources are readable (so no rule below passes over an empty string)', () => {
  it.each([PANEL, PAGE, PAY_ROUTE, WAIVER_ROUTE])('%s', f => {
    expect(code(f).length).toBeGreaterThan(500)
  })
})

describe('I1 — the card form names a purpose, and only a part payment names an amount', () => {
  const src = code(PANEL)

  it('opens the card through /api/portal/pay as a card payment with a purpose', () => {
    const fn = braceBody(src, src.search(/async function startCard\b/))
    expect(fn).toMatch(/postJson\('\/api\/portal\/pay',\s*\{\s*paymentMethod: 'card',\s*purpose,\s*\.\.\.extra\s*\}\)/)
  })

  it('every startCard call site is accounted for: deposit/balance carry at most a tip, partial carries the amount', () => {
    const calls = [...src.matchAll(/startCard\(([^\n\r]*)\)/g)].map(m => m[1])
    // The declaration is not a call; the two real call sites are.
    const sites = calls.filter(c => !/^purpose:/.test(c))
    expect(sites.length).toBe(2)
    const partialSite = sites.filter(c => /'partial'/.test(c))
    const otherSite = sites.filter(c => !/'partial'/.test(c))
    expect(partialSite).toHaveLength(1)
    expect(partialSite[0]).toMatch(/\{\s*amountCents:\s*cents\s*\}/)
    expect(otherSite).toHaveLength(1)
    expect(otherSite[0]).not.toMatch(/amountCents|amount_cents/)
    expect(otherSite[0]).toMatch(/tipCents:\s*tip/)
  })

  it('never names a payment type — the server decides what the ledger row is called', () => {
    expect(src).not.toMatch(/paymentType|payment_type/)
  })

  it('does not import the money() formatter, which would drag the service-role client into the bundle', () => {
    expect(src).not.toMatch(/from '@\/lib\/planInvoice'/)
    expect(src).not.toMatch(/from '@\/lib\/supabase'/)
  })

  it('reads back the SERVER\'s figures for the button, not its own', () => {
    expect(src).toMatch(/payLabel=\{`Pay \$\{usd\(card\.chargeCents\)\}`\}/)
    expect(src).toMatch(/chargeCents: data\.chargeCents/)
  })

  it('replaces the buttons while a card form is open (no second intent beside the live one)', () => {
    const at = src.search(/if \(card\) \{/)
    const listAt = src.search(/\{options\.map\(o =>/)
    expect(at).toBeGreaterThan(-1)
    expect(listAt).toBeGreaterThan(at)
  })
})

describe('I2 — /api/portal/pay derives the amount before it uses it', () => {
  const src = code(PAY_ROUTE)

  it('screens the purpose and refuses an unknown one outright', () => {
    expect(src).toMatch(/screenInvoicePayPurpose\(body\.purpose\)/)
    expect(src).toMatch(/if \(invoicePurpose === null\) \{(?:(?!\bif\s*\()[\s\S])*?status: 400/)
  })

  it('resolves the purpose against the plan\'s own money, and refuses when that cannot be worked out', () => {
    const at = src.search(/if \(invoicePurpose\) \{/)
    expect(at).toBeGreaterThan(-1)
    const block = braceBody(src, at)
    expect(block).toMatch(/if \(!derivedMoney\) \{(?:(?!\bif\s*\()[\s\S])*?status: 503/)
    expect(block).toMatch(/resolveInvoicePayment\(derivedMoney\.money, invoicePurpose, requestedAmountCents\)/)
    expect(block).toMatch(/if \(!resolved\.ok\) \{(?:(?!\bif\s*\()[\s\S])*?status: 409/)
    expect(block).toMatch(/amountCents = resolved\.amountCents/)
  })

  it('the derived amount is in place BEFORE the ceiling and the PaymentIntent use it', () => {
    const derivedAt = src.search(/amountCents = resolved\.amountCents/)
    const ceilingAt = src.search(/const effectiveAmount = Math\.min\(Math\.round\(amountCents\), balanceCents\)/)
    const intentAt = src.search(/paymentIntents\.create\(/)
    expect(derivedAt).toBeGreaterThan(-1)
    expect(ceilingAt).toBeGreaterThan(derivedAt)
    expect(intentAt).toBeGreaterThan(ceilingAt)
  })

  it('a purposeful request never lets the body name the ledger type', () => {
    expect(src).toMatch(/const namedType = invoicePurpose \? \(invoicePurpose === 'deposit' \? 'deposit' : undefined\) : screenedType/)
  })

  it('enforces the part-payment floor before creating the intent, and exempts nothing but "partial"', () => {
    const floorAt = src.search(/if \(resolvedType === 'partial'\) \{/)
    const intentAt = src.search(/paymentIntents\.create\(/)
    expect(floorAt).toBeGreaterThan(-1)
    expect(intentAt).toBeGreaterThan(floorAt)
    const block = braceBody(src, floorAt)
    expect(block).toMatch(/Math\.min\(MIN_PARTIAL_PAYMENT_CENTS, balanceCents\)/)
    expect(block).toMatch(/status: 400/)
  })

  it('applies the tip rule the Payment Link keeps (purposeAcceptsTip) to a purposeful request', () => {
    expect(src).toMatch(/purposeAcceptsTip\(invoicePurpose === 'balance' \? 'balance' : 'custom', booking\.party_type\)/)
    expect(src).toMatch(/const safeTipCents = tipAllowed \? screenTipCents\(tipCents\) : 0/)
  })

  it('writes BOTH metadata keys with the same figure, and still refuses an unpayable status first', () => {
    expect(src).toMatch(/amountCents: String\(effectiveAmount\)/)
    expect(src).toMatch(/depositCents: String\(effectiveAmount\)/)
    const gateAt = src.search(/if \(!isPayableStatus\(booking\.status\)\)/)
    const resolveAt = src.search(/resolveInvoicePayment\(derivedMoney/)
    expect(gateAt).toBeGreaterThan(-1)
    expect(resolveAt).toBeGreaterThan(gateAt)
  })

  it('answers with what the server settled on', () => {
    expect(src).toMatch(/amountCents: effectiveAmount,/)
    expect(src).toMatch(/chargeCents: totalChargeCents,/)
  })
})

describe('I3 — the page decides embedded vs hosted on the server', () => {
  const src = code(PAGE)

  it('an admin (no portal cookie) and an unpayable status keep the Payment Link', () => {
    expect(src).toMatch(/const embedded = !access\.isAdmin && isPayableStatus\(invoice\.booking\.status\)/)
    expect(src).toMatch(/<PayPanel ref_=\{ref_\} options=\{payOptions\} embedded=\{embedded\} partial=\{partial\} \/>/)
  })

  it('offers a part payment only to the embedded, uncancelled customer, from the shared bounds', () => {
    expect(src).toMatch(/const bounds = embedded && !isCancelled \? partialPaymentBounds\(invoice\) : null/)
  })

  it('never mints a check-in link at render — the waiver link is minted on click', () => {
    expect(src).not.toMatch(/mintCheckinLink/)
    expect(src).toMatch(/waiverOffer\(\{/)
  })
})

describe('I4 — the waiver route', () => {
  const src = code(WAIVER_ROUTE)

  it('is a POST and only a POST (minting writes a row; navigation and prefetch must not)', () => {
    expect(src).toMatch(/export async function POST\b/)
    expect(src).not.toMatch(/export async function (GET|HEAD|PUT|PATCH|DELETE)\b/)
  })

  it('makes the same access decision as the page, and the same offer decision as the button', () => {
    expect(src).toMatch(/planAccess\(req\.headers\.get\('cookie'\), ref\)/)
    expect(src).toMatch(/waiverOffer\(\{/)
    const accessAt = src.search(/planAccess\(/)
    const mintAt = src.search(/mintCheckinLink\(/)
    const offerAt = src.search(/waiverOffer\(\{/)
    expect(accessAt).toBeLessThan(offerAt)
    expect(offerAt).toBeLessThan(mintAt)
  })

  it('uses the EXISTING check-in token mechanism and invents no secret', () => {
    expect(src).toMatch(/import \{ mintCheckinLink \} from '@\/lib\/checkinLink'/)
    expect(src).not.toMatch(/createHmac|randomBytes|process\.env\.[A-Z_]*SECRET/)
  })

  it('names its columns', () => {
    expect(src).not.toMatch(/\.select\('\*'\)/)
  })
})

describe('I5 — no rule in this file is switched off', () => {
  it('has no skipped or todo tests', () => {
    const self = fs.readFileSync(__filename, 'utf8')
    const banned = new RegExp('\\b(?:it|describe|test)\\.(?:sk' + 'ip|to' + 'do)\\b|\\bx(?:it|describe)\\(')
    expect(self).not.toMatch(banned)
  })
})
