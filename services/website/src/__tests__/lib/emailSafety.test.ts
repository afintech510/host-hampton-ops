/**
 * The mail-body screens.
 *
 * Both directions on every one of them: the hostile payload is refused AND the
 * legitimate value survives. A screen proved only in the refusing direction is
 * how a live revenue email gets quietly broken — which is the failure mode
 * §11.12 of the Phase 5 review is about, and it happened twice in this session
 * (a codemod that escaped four HTML fragments, and a check whose leaf-anchored
 * regex could never match a member expression).
 */

import { mailHref, mailHrefExternal, mailToHref, telHref, escapeFields } from '@/lib/emailSafety'

let warn: jest.SpyInstance
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('mailHref — links to our own site', () => {
  it('keeps a real portal link, query string and all', () => {
    const url = 'https://www.hosthampton.com/api/portal/auth?ref=HH-2026-0976&token=abc.def'
    // `&` becomes `&amp;` because the value lands inside an HTML attribute, and
    // a browser decodes it back to `&` before following the link.
    expect(mailHref(url)).toBe(
      'https://www.hosthampton.com/api/portal/auth?ref=HH-2026-0976&amp;token=abc.def'
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps a site-relative path by making it absolute — a mail client has no base URL', () => {
    expect(mailHref('/plan/HH-2026-0976/summary')).toBe('https://www.hosthampton.com/plan/HH-2026-0976/summary')
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['another origin', 'https://evil.example.com/pay'],
    ['protocol-relative', '//evil.example.com/pay'],
    ['the backslash form', '/\\evil.example.com/pay'],
    ['a doubled leading slash on our host', 'https://www.hosthampton.com//evil.example.com/pay'],
    ['plain http', 'http://www.hosthampton.com/pay'],
    ['a bare word', 'pay'],
  ])('refuses %s', (_why, url) => {
    expect(mailHref(url)).toBe('')
  })

  it('a refusal is reported, with the value, bounded', () => {
    mailHref('javascript:alert(1)')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('refused')
    expect(String(warn.mock.calls[0][0])).toContain('javascript')
  })

  it('an absent URL is not an error and is not logged', () => {
    expect(mailHref(null)).toBe('')
    expect(mailHref(undefined)).toBe('')
    expect(mailHref('')).toBe('')
    expect(warn).not.toHaveBeenCalled()
  })

  it('refuses a control character, tested by code point', () => {
    const url = `https://www.hosthampton.com/pay${String.fromCodePoint(0x00)}`
    expect(mailHref(url)).toBe('')
    expect(mailHref(`java${String.fromCodePoint(0x09)}script:alert(1)`)).toBe('')
  })
})

describe('mailHrefExternal — the two fields that legitimately leave our origin', () => {
  it('keeps a photo gallery on someone else’s host', () => {
    expect(mailHrefExternal('https://photos.app.goo.gl/AbCdEf123')).toBe('https://photos.app.goo.gl/AbCdEf123')
  })

  it('keeps a Google review link', () => {
    const url = 'https://g.page/r/CabCdEfGhIjK/review'
    expect(mailHrefExternal(url)).toBe(url)
  })

  it('still refuses a scheme that is not https', () => {
    expect(mailHrefExternal('javascript:alert(1)')).toBe('')
    expect(mailHrefExternal('data:text/html,x')).toBe('')
    expect(mailHrefExternal('http://photos.example.com/x')).toBe('')
  })

  it('still refuses a pathname that is itself protocol-relative', () => {
    expect(mailHrefExternal('https://www.hosthampton.com//evil.example.com/x')).toBe('')
  })

  it('escapes for the attribute it is going into', () => {
    expect(mailHrefExternal('https://photos.example.com/a?x=1&y=2')).toContain('&amp;')
  })
})

describe('mailToHref — an address typed by anybody', () => {
  it('keeps an ordinary address', () => {
    expect(mailToHref('adam@easternbuilding.supply')).toBe('mailto:adam@easternbuilding.supply')
  })

  it('keeps a mixed-case address unchanged — 21 real contacts have capitals', () => {
    expect(mailToHref('BON.Smith@GMAIL.COM')).toBe('mailto:BON.Smith@GMAIL.COM')
  })

  it.each([
    ['a percent-encoded newline, which is how a bcc: is appended', 'a@b.com%0Abcc:victim@x.com'],
    ['a literal comma, a second recipient', 'a@b.com,victim@x.com'],
    ['an angle bracket', 'a@b.com><script>'],
    ['a quote', 'a"@b.com'],
    ['a query string', 'a@b.com?subject=x'],
    ['no at sign', 'not-an-address'],
    ['no TLD', 'a@localhost'],
    ['a backslash', 'a\\@b.com'],
  ])('refuses %s', (_why, addr) => {
    expect(mailToHref(addr)).toBe('')
  })

  it('refuses a real newline, built by code point', () => {
    expect(mailToHref(`a@b.com${String.fromCodePoint(0x0a)}bcc:victim@x.com`)).toBe('')
  })
})

describe('telHref — a phone number typed by anybody', () => {
  it('keeps a US number and strips the formatting', () => {
    expect(telHref('(631) 400-8080')).toBe('tel:6314008080')
    expect(telHref('+1 631 400 8080')).toBe('tel:+16314008080')
  })

  it('builds an sms: link on request', () => {
    expect(telHref('+16314008080', 'sms')).toBe('sms:+16314008080')
  })

  it.each([
    ['letters', 'javascript:alert(1)'],
    ['too short', '123'],
    ['too long', '1234567890123456789'],
    ['empty after stripping', '(—) ——'],
  ])('refuses %s', (_why, phone) => {
    expect(telHref(phone)).toBe('')
  })
})

describe('escapeFields — escape at entry', () => {
  it('escapes every string, at any depth', () => {
    const out = escapeFields({
      customerName: '<script>alert(1)</script>',
      nested: { notes: 'a & b "c" \'d\'' },
      items: [{ name: '<img src=x onerror=alert(1)>' }],
    })
    expect(out.customerName).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.nested.notes).toBe('a &amp; b &quot;c&quot; &#39;d&#39;')
    expect(out.items[0].name).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('leaves numbers, booleans, null and undefined alone', () => {
    // `${d.guestCount}` and `${d.isFree ? … : …}` have to keep working, and a
    // number turned into a string is how a template starts printing "12" where
    // it used to compare.
    const out = escapeFields({ guestCount: 12, isFree: false, notes: null, phone: undefined, cents: 0 })
    expect(out.guestCount).toBe(12)
    expect(out.isFree).toBe(false)
    expect(out.notes).toBeNull()
    expect(out.phone).toBeUndefined()
    expect(out.cents).toBe(0)
  })

  it('does not mutate the input, so the raw object is still there for the URL fields', () => {
    const raw = { customerName: 'A & B', portalUrl: 'https://www.hosthampton.com/p?a=1&b=2' }
    const out = escapeFields(raw)
    expect(raw.customerName).toBe('A & B')
    expect(out.customerName).toBe('A &amp; B')
    // The point of not mutating: the URL still parses, because it was never
    // HTML-escaped.
    expect(mailHref(raw.portalUrl)).toContain('a=1&amp;b=2')
  })

  it('an already-escaped URL is CORRUPTED by the screen, not refused — which is why the call site is what gets checked', () => {
    const raw = { portalUrl: 'https://www.hosthampton.com/p?a=1&b=2' }
    const out = escapeFields(raw)
    // This is the wrong-fix failure mode, measured rather than assumed. Passing
    // `d.portalUrl` (escaped) instead of `raw.portalUrl` does not produce a
    // refusal a reviewer would notice — `&amp;` is a perfectly valid query
    // string, so the URL parses, passes the host check, and comes back
    // double-escaped. The recipient then clicks a link carrying a parameter
    // literally named `amp;b`.
    expect(mailHref(out.portalUrl)).toBe('https://www.hosthampton.com/p?a=1&amp;amp;b=2')
    // So the screen cannot be the thing that catches this, and it is not asked
    // to be: `emailTemplateEscaping.test.ts` asserts at the CALL SITE that every
    // URL comes off `raw.` and every button builder is handed a screened href.
    // A guarantee nothing checks is the defect this whole session is about.
  })

  it('does not hang on a cycle', () => {
    const a: Record<string, unknown> = { name: 'x' }
    a.self = a
    expect(() => escapeFields(a)).not.toThrow()
  })

  it('escapes a lone < that is prose, not markup — and does not eat the rest of the sentence', () => {
    // The `containsMarkup` defect from docs/content-pipeline.md §11.2, in the
    // other direction: escaping is safe where stripping was not.
    expect(escapeFields({ notes: 'Groups of <10 guests and >4 adults' }).notes).toBe(
      'Groups of &lt;10 guests and &gt;4 adults'
    )
  })
})
