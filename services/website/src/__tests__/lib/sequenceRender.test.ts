/**
 * Rendering a sequence step into an email.
 *
 * The two things worth pinning: a customer-written name must not reach markup
 * raw, and a marketing email must not go out with no way to stop it.
 */

import {
  renderHtml,
  renderText,
  flattenHeaderValue,
  renderStepEmail,
  unsubscribeFooterHtml,
} from '@/lib/sequences/render'

describe('renderHtml escapes what a customer wrote', () => {
  it('escapes a name carrying markup', () => {
    const out = renderHtml('<p>Hi {{first_name}}!</p>', { firstName: '<img src=x onerror=alert(1)>' })
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('escapes an attribute-breaking name', () => {
    const out = renderHtml('<a title="{{first_name}}">x</a>', { firstName: '" onmouseover="evil()' })
    expect(out).not.toMatch(/onmouseover="evil/)
    expect(out).toContain('&quot;')
  })

  it('falls back to "there" for a blank name', () => {
    expect(renderHtml('Hi {{first_name}}', { firstName: '   ' })).toBe('Hi there')
    expect(renderHtml('Hi {{first_name}}', {})).toBe('Hi there')
  })

  it('replaces every occurrence, not just the first', () => {
    expect(renderHtml('{{first_name}} {{first_name}}', { firstName: 'Ada' })).toBe('Ada Ada')
  })
})

describe('renderText is for headers, not markup', () => {
  it('does NOT html-escape (a subject would read "Sam &amp; Jo")', () => {
    expect(renderText('{{first_name}} is here', { firstName: 'Sam & Jo' })).toBe('Sam & Jo is here')
  })

  it('flattens a newline, because a subject is a mail header', () => {
    const out = renderText('Hello {{first_name}}', { firstName: 'Ada\r\nBcc: someone@evil.test' })
    expect(out).not.toContain('\n')
    expect(out).not.toContain('\r')
  })

  it('flattens the line terminators that are not \\n', () => {
    // Built by code point: an invisible character typed into a source file is a
    // test nobody can read in a diff (§24).
    const sneaky = `Ada${String.fromCodePoint(0x2028)}X${String.fromCodePoint(0x0085)}Y`
    const out = flattenHeaderValue(sneaky)
    expect(out).not.toContain(String.fromCodePoint(0x2028))
    expect(out).not.toContain(String.fromCodePoint(0x0085))
    expect(out).toBe('Ada X Y')
  })

  it('flattens the C1 block', () => {
    expect(flattenHeaderValue(`a${String.fromCodePoint(0x9b)}b`)).toBe('a b')
  })
})

describe('every sequence email carries an unsubscribe link', () => {
  const step = { subject: 'Hi {{first_name}}', body_html: '<p>Body</p>', body_text: 'Body' }

  it('appends a footer when the body has no placeholder', () => {
    const out = renderStepEmail(step, { firstName: 'Ada' }, 'tok123')
    expect(out.usedInlineUnsubscribe).toBe(false)
    expect(out.html).toContain('Unsubscribe')
    expect(out.html).toContain('/unsubscribe?t=tok123')
    expect(out.text).toContain('/unsubscribe?t=tok123')
  })

  it('does not double up when the body places its own', () => {
    const out = renderStepEmail(
      { ...step, body_html: '<a href="{{unsubscribe_url}}">out</a>', body_text: 'out: {{unsubscribe_url}}' },
      { firstName: 'Ada' },
      'tok123'
    )
    expect(out.usedInlineUnsubscribe).toBe(true)
    expect(out.html.match(/unsubscribe\?t=/g) ?? []).toHaveLength(1)
  })

  it('the footer URL survives escaping intact', () => {
    const html = unsubscribeFooterHtml('https://www.hosthampton.com/unsubscribe?t=a.b')
    expect(html).toContain('href="https://www.hosthampton.com/unsubscribe?t=a.b"')
  })

  it('renders the subject as a flat header', () => {
    const out = renderStepEmail(step, { firstName: 'Ada\nEvil: yes' }, 'tok')
    expect(out.subject).not.toContain('\n')
  })
})
