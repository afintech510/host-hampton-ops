import {
  adultLabel,
  adultsLine,
  formatHostPhone,
  formFromCustomize,
  isHostPhone,
  isIosUserAgent,
  kidsLine,
  overCap,
  patchFromForm,
  pollIntervalMs,
  shareGate,
  shareMessage,
  smsHref,
  stateBanner,
  UPDATING_MESSAGE,
  type HostCustomizeValues,
  type HostState,
} from '@/lib/evites/hostUi'

const STATES: HostState[] = ['preview', 'needs_time', 'live', 'closed']

describe('shareGate: the Share panel is live only when the party is live AND the picture is fresh', () => {
  it('live + fresh is the only enabled combination', () => {
    const enabled = STATES.flatMap((s) => [true, false].map((fresh) => [s, fresh] as const)).filter(([s, fresh]) => shareGate(s, fresh).enabled)
    expect(enabled).toEqual([['live', true]])
  })

  it('live but not fresh says "Updating your invitation..."', () => {
    expect(shareGate('live', false)).toEqual({ enabled: false, message: UPDATING_MESSAGE })
    expect(UPDATING_MESSAGE).toBe('Updating your invitation…')
  })

  it('every other state explains itself rather than showing a bare disabled button', () => {
    for (const s of ['preview', 'needs_time', 'closed'] as const) {
      for (const fresh of [true, false]) {
        const g = shareGate(s, fresh)
        expect(g.enabled).toBe(false)
        expect((g.message ?? '').length).toBeGreaterThan(10)
      }
    }
    expect(shareGate('preview', true).message).toMatch(/booked/)
    expect(shareGate('needs_time', true).message).toMatch(/start time/)
    expect(shareGate('closed', true).message).toMatch(/happened/)
  })

  it('a fresh picture does not unlock a party that is not live', () => {
    expect(shareGate('preview', true).enabled).toBe(false)
    expect(shareGate('needs_time', true).enabled).toBe(false)
    expect(shareGate('closed', true).enabled).toBe(false)
  })
})

describe('stateBanner: copy for each of preview / needs_time / live / closed (spec §4)', () => {
  it('has distinct, non-empty copy for each', () => {
    const titles = STATES.map((s) => stateBanner(s, true).title)
    expect(new Set(titles).size).toBe(4)
    expect(stateBanner('preview', true).title).toBe('Preview')
    expect(stateBanner('needs_time', true).title).toBe('Time coming soon')
    expect(stateBanner('closed', true).title).toBe('This party has happened \u{1F389}')
    expect(stateBanner('live', true).tone).toBe('live')
  })
  it('live but stale is the "updating" banner', () => {
    expect(stateBanner('live', false)).toMatchObject({ tone: 'updating', title: UPDATING_MESSAGE })
  })
})

describe('sms fallback (spec §7.2)', () => {
  it('iOS gets sms:&body=, everything else sms:?body=', () => {
    expect(smsHref(true, 'hi')).toBe('sms:&body=hi')
    expect(smsHref(false, 'hi')).toBe('sms:?body=hi')
  })
  it('the body is the sentence, a space, the link - percent-encoded', () => {
    const body = shareMessage("You're invited! RSVP here:", 'https://www.hosthampton.com/i/mia-glow-7kq2')
    expect(body).toBe("You're invited! RSVP here: https://www.hosthampton.com/i/mia-glow-7kq2")
    const href = smsHref(false, body)
    expect(href).not.toMatch(/\s/)
    expect(decodeURIComponent(href.slice('sms:?body='.length))).toBe(body)
  })
  it('iPhone and iPad user agents are iOS; Android, desktop and null are not', () => {
    expect(isIosUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false)
    expect(isIosUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
    expect(isIosUserAgent(null)).toBe(false)
    expect(isIosUserAgent(undefined)).toBe(false)
  })
})

describe('polling cadence', () => {
  it('30 s normally, 5 s only while a redraw is in flight on a live party', () => {
    expect(pollIntervalMs('live', true)).toBe(30_000)
    expect(pollIntervalMs('preview', false)).toBe(30_000)
    expect(pollIntervalMs('needs_time', false)).toBe(30_000)
    expect(pollIntervalMs('closed', false)).toBe(30_000)
    expect(pollIntervalMs('live', false)).toBe(5_000)
  })
})

describe('headcount text', () => {
  it('"11 of 10 kids" against the cap, flagged over', () => {
    expect(kidsLine(11, 10)).toBe('11 of 10 kids')
    expect(overCap(11, 10)).toBe(true)
    expect(overCap(10, 10)).toBe(false)
    expect(kidsLine(4, 12)).toBe('4 of 12 kids')
  })
  it('without a cap there is nothing to be over', () => {
    expect(kidsLine(4, null)).toBe('4 kids')
    expect(kidsLine(1, null)).toBe('1 kid')
    expect(overCap(400, null)).toBe(false)
  })
  it('adults: "2+" counts as 2 and the total carries a plus', () => {
    expect(adultsLine(3, false)).toBe('3 adults')
    expect(adultsLine(1, false)).toBe('1 adult')
    expect(adultsLine(5, true)).toBe('5+ adults')
    expect(adultsLine(2, true)).toBe('2+ adults')
    expect(adultLabel(0)).toBe('no adults staying')
    expect(adultLabel(1)).toBe('1 adult')
    expect(adultLabel(2)).toBe('2+ adults')
  })
})

describe('host phone', () => {
  it('only NNN-NNN-NNNN with a first digit of 2-9 is a host phone', () => {
    expect(isHostPhone('631-555-0123')).toBe(true)
    for (const bad of ['(631) 555-0123', '631 555 0123', '6315550123', '131-555-0123', '031-555-0123', '631-555-012', '631-555-01234', '631-555-012a', '+1-631-555-0123', '', null, 6315550123]) {
      expect(isHostPhone(bad)).toBe(false)
    }
  })
  it('the form formats the usual spellings, and leaves anything else alone for the server to refuse', () => {
    expect(formatHostPhone('(631) 555-0123')).toBe('631-555-0123')
    expect(formatHostPhone('631.555.0123')).toBe('631-555-0123')
    expect(formatHostPhone('+1 631 555 0123')).toBe('631-555-0123')
    expect(formatHostPhone('1-631-555-0123')).toBe('631-555-0123')
    expect(formatHostPhone('call me')).toBe('call me')
    expect(formatHostPhone('631-555-012a')).toBe('631-555-012a')
    expect(formatHostPhone('555-0123')).toBe('555-0123')
  })
})

describe('patchFromForm: only what changed, with empty as null', () => {
  const stored: HostCustomizeValues = {
    host_note: 'Welcome!',
    gift_note: null,
    rsvp_deadline: '2026-11-01',
    show_host_contact: true,
    host_contact_name: null,
    host_contact_phone: null,
  }

  it('an untouched form is an empty patch (nothing to save)', () => {
    expect(patchFromForm(formFromCustomize(stored), stored)).toEqual({})
  })

  it('an old RSVP-by date that has since passed is not re-sent with an unrelated edit', () => {
    const form = { ...formFromCustomize(stored), giftNote: 'No gifts please' }
    expect(patchFromForm(form, stored)).toEqual({ gift_note: 'No gifts please' })
  })

  it('clearing a field sends null; whitespace is nothing', () => {
    const form = { ...formFromCustomize(stored), hostNote: '   ', rsvpDeadline: '' }
    expect(patchFromForm(form, stored)).toEqual({ host_note: null, rsvp_deadline: null })
  })

  it('the phone is formatted on the way out; an unformattable one is sent as typed so the server refuses it', () => {
    const f = formFromCustomize(stored)
    expect(patchFromForm({ ...f, hostContactPhone: '(631) 555-0123' }, stored)).toEqual({ host_contact_phone: '631-555-0123' })
    expect(patchFromForm({ ...f, hostContactPhone: 'call me' }, stored)).toEqual({ host_contact_phone: 'call me' })
  })

  it('the show/hide toggle', () => {
    expect(patchFromForm({ ...formFromCustomize(stored), showHostContact: false }, stored)).toEqual({ show_host_contact: false })
  })
})
