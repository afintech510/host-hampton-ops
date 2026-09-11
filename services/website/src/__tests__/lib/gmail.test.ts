/**
 * Tests for lib/gmail.ts — the read/label client.
 *
 * The parsing here is what the triage prompt sees, so a bad body extraction is
 * not cosmetic: it decides whether a real customer gets answered.
 */

import {
  addressOf,
  decodeBase64Url,
  extractBody,
  parseMessage,
  stripQuotedReply,
} from '@/lib/gmail'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

describe('addressOf', () => {
  it('pulls the bare address out of a display-name header', () => {
    expect(addressOf('"Jess Rivera" <Jess@Example.com>')).toBe('jess@example.com')
    expect(addressOf('jess@example.com')).toBe('jess@example.com')
    expect(addressOf('')).toBe('')
  })
})

describe('decodeBase64Url', () => {
  it('decodes Gmail base64url, including the - and _ substitutions', () => {
    expect(decodeBase64Url(b64('hi there ~ ünïcode'))).toBe('hi there ~ ünïcode')
  })

  it('returns empty rather than throwing on junk', () => {
    expect(typeof decodeBase64Url('!!!not base64!!!')).toBe('string')
  })
})

describe('extractBody', () => {
  it('prefers text/plain over text/html', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('the plain one') } },
        { mimeType: 'text/html', body: { data: b64('<p>the html one</p>') } },
      ],
    }
    expect(extractBody(payload)).toBe('the plain one')
  })

  it('falls back to html with the tags taken out', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: b64('<style>p{color:red}</style><p>Hi <b>Allie</b></p><p>Second &amp; last</p>') },
    }
    const out = extractBody(payload)
    expect(out).toContain('Hi Allie')
    expect(out).toContain('Second & last')
    expect(out).not.toContain('color:red')
    expect(out).not.toContain('<')
  })

  it('walks nested multipart trees', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('nested body') } }] },
        { mimeType: 'application/pdf', body: { attachmentId: 'x' } },
      ],
    }
    expect(extractBody(payload)).toBe('nested body')
  })

  it('returns empty for an attachment-only message rather than throwing', () => {
    expect(extractBody({ mimeType: 'application/pdf', body: {} })).toBe('')
  })
})

describe('stripQuotedReply', () => {
  it('cuts everything from the attribution line', () => {
    const out = stripQuotedReply(
      'Yes please, 20 kids.\n\nOn Wed, Sep 10, 2026 at 2:03 PM Allie <a@b.com> wrote:\n> what size party?\n',
    )
    expect(out).toBe('Yes please, 20 kids.')
  })

  it('cuts an Outlook-style original message block', () => {
    expect(stripQuotedReply('Sounds good.\n\n-----Original Message-----\nFrom: someone')).toBe('Sounds good.')
  })

  it('cuts a signature after the RFC "-- " delimiter', () => {
    expect(stripQuotedReply('Can you do Nov 30?\n\n-- \nJess Rivera\nVP of Something')).toBe('Can you do Nov 30?')
  })

  it('cuts plain >-quoted history', () => {
    expect(stripQuotedReply('Confirming.\n> previous message\n> more of it')).toBe('Confirming.')
  })

  it('leaves an ordinary message untouched', () => {
    const msg = 'Hi! Do you have Nov 30 open for 20 kids?\n\nThanks,\nJess'
    expect(stripQuotedReply(msg)).toBe(msg)
  })
})

describe('parseMessage', () => {
  const raw = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: '"Jess Rivera" <jess@example.com>' },
        { name: 'To', value: 'hosthampton295@gmail.com' },
        { name: 'Subject', value: 'Party for 20 kids?' },
        { name: 'Date', value: 'Wed, 10 Sep 2026 14:03:00 -0400' },
      ],
      mimeType: 'text/plain',
      body: { data: b64('Do you have Nov 30?\n\nOn Tue Allie <a@b.com> wrote:\n> hello') },
    },
    ...overrides,
  })

  it('normalises headers, body and date', () => {
    const m = parseMessage(raw())
    expect(m).toMatchObject({
      id: 'm1',
      threadId: 't1',
      fromEmail: 'jess@example.com',
      subject: 'Party for 20 kids?',
      direction: 'in',
    })
    expect(m.body).toBe('Do you have Nov 30?')
    expect(m.sentAt).toBe('2026-09-10T18:03:00.000Z')
  })

  it('marks a SENT-labelled message outbound — the voice corpus', () => {
    expect(parseMessage(raw({ labelIds: ['SENT'] })).direction).toBe('out')
  })

  it('marks mail from our own address outbound even without the label', () => {
    const r = raw({ labelIds: [] }) as any
    r.payload.headers[0].value = 'Allie <hosthampton295@gmail.com>'
    expect(parseMessage(r).direction).toBe('out')
  })

  it('survives a message with no headers at all', () => {
    const m = parseMessage({ id: 'm2', threadId: 't2', payload: {} })
    expect(m.id).toBe('m2')
    expect(m.sentAt).toBeNull()
    expect(m.body).toBe('')
  })
})
