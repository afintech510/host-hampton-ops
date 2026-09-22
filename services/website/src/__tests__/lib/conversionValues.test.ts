/**
 * The conversion events must never invent revenue.
 *
 * `lib/gtag.ts` used to end every money field with `value: value || 99`. That is
 * the kind of fallback that looks like a harmless default and is actually a
 * fabrication: a FREE event RSVP reported $99, and so did an unpaid booking
 * request on the busiest funnel on the site. Nothing failed, nothing logged, and
 * GA4 filled up with revenue that did not exist.
 *
 * These tests assert the shape of what is sent to gtag/fbq. Each one FAILS
 * against the old implementation — that is the point of writing them.
 */

type Call = [string, ...unknown[]]

function loadGtag(env: Record<string, string> = {}) {
  jest.resetModules()
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const gtagCalls: Call[] = []
  const fbqCalls: Call[] = []
  // gtag() and fbq() are read off `window` at call time, so a plain global works.
  ;(global as unknown as { window: unknown }).window = {
    gtag: (...args: Call) => gtagCalls.push(args),
    fbq: (...args: Call) => fbqCalls.push(args),
  }
  const mod = require('@/lib/gtag')
  return { mod, gtagCalls, fbqCalls }
}

/** The params object of the first `gtag('event', <name>, …)` call. */
function eventParams(calls: Call[], name: string): Record<string, unknown> | undefined {
  const hit = calls.find(c => c[0] === 'event' && c[1] === name)
  return hit ? (hit[2] as Record<string, unknown>) : undefined
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GADS_ID
  delete process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL
  delete process.env.NEXT_PUBLIC_GADS_LEAD_LABEL
  delete process.env.NEXT_PUBLIC_META_PIXEL_ID
})

describe('trackPurchase does not invent a value', () => {
  it('omits value and currency entirely when the amount is unknown', () => {
    const { mod, gtagCalls } = loadGtag()
    mod.trackPurchase('HH-2026-0001', undefined, 'Event Ticket')

    const params = eventParams(gtagCalls, 'purchase')
    expect(params).toBeDefined()
    // The old code sent `value: 99` here. Not "a different number" — no key.
    expect(params).not.toHaveProperty('value')
    expect(params).not.toHaveProperty('currency')
    expect(params!.transaction_id).toBe('HH-2026-0001')
  })

  it('preserves an explicit zero rather than treating it as missing', () => {
    const { mod, gtagCalls } = loadGtag()
    mod.trackPurchase('RSVP-1', 0, 'Event Ticket')

    const params = eventParams(gtagCalls, 'purchase')
    // `value || 99` turned 0 into 99. A free RSVP really is worth $0 and that is
    // a fact worth sending, so 0 has to survive.
    expect(params!.value).toBe(0)
    expect(params!.currency).toBe('USD')
  })

  it('passes a real amount straight through', () => {
    const { mod, gtagCalls } = loadGtag()
    mod.trackPurchase('cs_test_123', 250, 'Booking Deposit')

    expect(eventParams(gtagCalls, 'purchase')!.value).toBe(250)
  })

  it('does not leak the invented value into the Google Ads conversion either', () => {
    const { mod, gtagCalls } = loadGtag({
      NEXT_PUBLIC_GADS_ID: 'AW-TEST',
      NEXT_PUBLIC_GADS_PURCHASE_LABEL: 'purchaselabel',
    })
    mod.trackPurchase('HH-2026-0002', undefined)

    const conv = gtagCalls.find(
      c => c[0] === 'event' && c[1] === 'conversion',
    )?.[2] as Record<string, unknown>
    expect(conv).toBeDefined()
    expect(conv.send_to).toBe('AW-TEST/purchaselabel')
    // The Ads branch had its own separate `value: value || 99`. Slicing only the
    // GA4 branch would have left this one fabricating revenue in the ad account
    // that actually spends money.
    expect(conv).not.toHaveProperty('value')
  })
})

describe('an unpaid booking request is a lead, not a purchase', () => {
  it('fires generate_lead and never fires purchase', () => {
    const { mod, gtagCalls } = loadGtag()
    mod.trackBookingRequest('HH-2026-0003')

    expect(eventParams(gtagCalls, 'generate_lead')).toBeDefined()
    // api/checkout/route.ts: deposit bookings "are now REQUESTS — we never
    // charge". A purchase event here is a claim that money moved.
    expect(eventParams(gtagCalls, 'purchase')).toBeUndefined()
  })

  it('reports zero value for the lead', () => {
    const { mod, gtagCalls } = loadGtag()
    mod.trackBookingRequest('HH-2026-0004')

    expect(eventParams(gtagCalls, 'generate_lead')!.value).toBe(0)
  })

  it('sends the Google Ads LEAD label, not the purchase label', () => {
    const { mod, gtagCalls } = loadGtag({
      NEXT_PUBLIC_GADS_ID: 'AW-TEST',
      NEXT_PUBLIC_GADS_LEAD_LABEL: 'leadlabel',
      NEXT_PUBLIC_GADS_PURCHASE_LABEL: 'purchaselabel',
    })
    mod.trackBookingRequest('HH-2026-0005')

    const sendTos = gtagCalls
      .filter(c => c[1] === 'conversion')
      .map(c => (c[2] as Record<string, unknown>).send_to)
    expect(sendTos).toContain('AW-TEST/leadlabel')
    expect(sendTos).not.toContain('AW-TEST/purchaselabel')
  })
})

describe('Meta pixel events', () => {
  it('stay silent entirely when the pixel is not configured', () => {
    const { mod, fbqCalls } = loadGtag()
    mod.trackPurchase('HH-2026-0006', 100)
    mod.trackBookingRequest('HH-2026-0007')
    mod.trackLead('room-rental')

    // Unset means not a single byte goes to Meta — the same gating GADS_ID uses.
    expect(fbqCalls).toHaveLength(0)
  })

  it('send value and currency on Purchase, which Meta requires', () => {
    const { mod, fbqCalls } = loadGtag({ NEXT_PUBLIC_META_PIXEL_ID: '1543468516699272' })
    mod.trackPurchase('HH-2026-0008', undefined, 'Event Ticket')

    const purchase = fbqCalls.find(c => c[0] === 'track' && c[1] === 'Purchase')
    expect(purchase).toBeDefined()
    const params = purchase![2] as Record<string, unknown>
    // GA4 omits the key when unknown; Meta rejects Purchase without one, so an
    // explicit 0 is correct here. The two platforms genuinely differ.
    expect(params.value).toBe(0)
    expect(params.currency).toBe('USD')
  })

  it('never attach contact details, because advanced matching is off', () => {
    const { mod, fbqCalls } = loadGtag({ NEXT_PUBLIC_META_PIXEL_ID: '1543468516699272' })
    mod.trackLead('room-rental', 'parent@example.com')
    mod.trackPurchase('HH-2026-0009', 250)

    const serialized = JSON.stringify(fbqCalls)
    expect(serialized).not.toContain('parent@example.com')
    for (const key of ['em', 'ph', 'fn', 'ln', 'email', 'phone']) {
      expect(fbqCalls.some(c => Object.prototype.hasOwnProperty.call(c[2] ?? {}, key))).toBe(false)
    }
  })
})
