/**
 * The variant screen, both directions.
 *
 * Every hostile codepoint in this file is built with `String.fromCodePoint`.
 * A literal U+2028 is a line terminator in JavaScript SOURCE too, so the first
 * draft of the equivalent file in plan §24 would not parse — and a regex that
 * has to CONTAIN these characters makes the guardrail's own source a line no
 * reviewer can read and no diff can show honestly.
 */

import { screenVariant, bodyHtmlFromText, ALLOWED_PLACEHOLDERS, extractLinks } from '@/lib/experiments/screen'

const GOOD_BODY =
  'Hi {{first_name}},\n\nWe still have room in the studio this month and we would love to have your crew in.\n\nTake a look at the calendar whenever you are ready.'

function ok(raw: { subject?: unknown; bodyText?: unknown }) {
  const r = screenVariant(raw)
  if (!r.ok) throw new Error(`expected pass, got refusal: ${r.reason}`)
  return r
}
function refusal(raw: { subject?: unknown; bodyText?: unknown }): string {
  const r = screenVariant(raw)
  if (r.ok) throw new Error('expected a refusal, got a pass')
  return r.reason
}

describe('screenVariant — legitimate copy survives', () => {
  it('passes a normal variant and keeps its placeholders', () => {
    const r = ok({ subject: 'A quiet week in the studio', bodyText: GOOD_BODY })
    expect(r.copy.subject).toBe('A quiet week in the studio')
    expect(r.copy.bodyText).toContain('{{first_name}}')
    expect(r.notes).toEqual([])
  })

  it('allows every placeholder the renderer actually substitutes', () => {
    for (const p of ALLOWED_PLACEHOLDERS) {
      const r = screenVariant({ subject: 'Subject line here', bodyText: `${GOOD_BODY}\n\nRef {{${p}}}.` })
      expect(r.ok).toBe(true)
    }
  })
})

describe('screenVariant — the refusals, each naming what it matched', () => {
  it('refuses any dollar figure, including the $250 deposit', () => {
    // NO_AMOUNTS_ALLOWED: a marketing variant may publish no price at all,
    // because mobile pricing is under review (PLAN.md §15).
    expect(refusal({ subject: 'Parties from $500', bodyText: GOOD_BODY })).toMatch(/\$500/)
    expect(refusal({ subject: 'Book now', bodyText: `${GOOD_BODY}\n\nThe deposit is $250.` })).toMatch(/\$250/)
  })

  it('refuses a concession the agent has no authority to make', () => {
    expect(refusal({ subject: 'A gift for you', bodyText: `${GOOD_BODY}\n\nWe will waive the deposit.` })).toMatch(/waiv/i)
  })

  it('refuses a link that is not ours, and a payment handle', () => {
    expect(
      refusal({ subject: 'Pay here', bodyText: `${GOOD_BODY}\n\nPay at https://hosthampton-secure.net/pay` })
    ).toMatch(/hosthampton-secure\.net/)
    expect(refusal({ subject: 'Send it over', bodyText: `${GOOD_BODY}\n\nVenmo @not-allie please.` })).toMatch(/payment handle/)
  })

  it('refuses markup — the model writes plain text and we build the HTML', () => {
    expect(refusal({ subject: 'Hello', bodyText: `${GOOD_BODY}<script>alert(1)</script>` })).toMatch(/markup/)
    expect(refusal({ subject: '<b>Hello</b> there friend', bodyText: GOOD_BODY })).toMatch(/markup/)
  })

  it('refuses a placeholder nothing substitutes, and says which', () => {
    const reason = refusal({ subject: 'Hi there', bodyText: `Hi {{customer_first}},\n\n${GOOD_BODY}` })
    expect(reason).toContain('{{customer_first}}')
    expect(reason).toContain('{{first_name}}')
  })

  it('refuses an unmatched brace pair', () => {
    expect(refusal({ subject: 'Hi there', bodyText: `${GOOD_BODY}\n\nSee you {{` })).toMatch(/unmatched/)
  })

  it('refuses a body with no subject, and a body too short to be an email', () => {
    expect(refusal({ subject: '   ', bodyText: GOOD_BODY })).toMatch(/no subject/)
    expect(refusal({ subject: 'Hello', bodyText: 'Too short.' })).toMatch(/too short/)
  })
})

describe('screenVariant — invisible structure', () => {
  const U2028 = String.fromCodePoint(0x2028)
  const NEL = String.fromCodePoint(0x0085)
  const TAG_A = String.fromCodePoint(0xe0041) // TAG LATIN CAPITAL A — invisible ASCII
  const RLO = String.fromCodePoint(0x202e) // RIGHT-TO-LEFT OVERRIDE
  const LONE_SURROGATE = String.fromCodePoint(0xd800)

  it('flattens a subject containing U+2028 — a mail header may not have two lines', () => {
    // U+2028 is the codepoint plan §24.2 found passing straight through
    // `flattenToOneLine`'s first implementation AND through `JSON.stringify`.
    // The forged second line here is a header with no address in it, because
    // the money/link screens would refuse an address for a different reason and
    // this test is about the FLATTENER.
    const r = ok({ subject: `Hello${U2028}Reply-To: elsewhere`, bodyText: GOOD_BODY })
    expect(r.copy.subject).not.toContain(U2028)
    expect(r.copy.subject.split('\n')).toHaveLength(1)
    expect(r.copy.subject).toBe('Hello Reply-To: elsewhere')
  })

  it('and an address smuggled into a subject is refused for its own reason', () => {
    // Two screens, two reasons. Worth pinning both: a change that removed the
    // flattener would still pass the test above if only one of them ran.
    const r = screenVariant({ subject: `Hello${U2028}Bcc: someone@example.com`, bodyText: GOOD_BODY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/someone@example\.com/)
  })

  it('strips the Unicode TAG block, bidi overrides and lone surrogates from the body', () => {
    const hostile = `${GOOD_BODY}${TAG_A}${RLO}${LONE_SURROGATE}`
    const r = ok({ subject: 'Hello there', bodyText: hostile })
    expect(r.copy.bodyText).not.toContain(TAG_A)
    expect(r.copy.bodyText).not.toContain(RLO)
    expect(r.copy.bodyText).not.toContain(LONE_SURROGATE)
    expect(r.notes.join(' ')).toMatch(/invisible or control characters removed/)
  })

  it('turns NEL into a newline rather than letting it forge one silently', () => {
    const r = ok({ subject: 'Hello there', bodyText: `${GOOD_BODY}${NEL}and one more line` })
    expect(r.copy.bodyText).not.toContain(NEL)
  })
})

describe('bodyHtmlFromText — no model-written markup can reach an inbox', () => {
  it('escapes everything and wraps paragraphs', () => {
    const html = bodyHtmlFromText('First <b>para</b> & more.\n\nSecond para.')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&amp;')
    expect(html.match(/<p /g)).toHaveLength(2)
  })

  it('leaves {{tokens}} intact so the renderer can substitute them', () => {
    expect(bodyHtmlFromText('Hi {{first_name}}, welcome.')).toContain('{{first_name}}')
  })

  it('turns a single newline into a <br> and not into a lost line', () => {
    expect(bodyHtmlFromText('one\ntwo')).toContain('<br>')
  })
})

describe('extractLinks', () => {
  it('finds absolute and protocol-relative URLs', () => {
    const found = extractLinks('go to https://www.hosthampton.com/book or //evil.example.com/x')
    expect(found).toContain('https://www.hosthampton.com/book')
    expect(found).toContain('//evil.example.com/x')
  })

  it('a protocol-relative URL is refused by the screen', () => {
    // `containsForeignContact` does not see `//host` — it looks for `https?://`
    // and `www.`. `safeSiteLink` is what catches it, which is why the screen
    // runs BOTH and not either.
    expect(refusal({ subject: 'Look here', bodyText: `${GOOD_BODY}\n\nSee //evil.example.com/x` })).toMatch(
      /not a Host Hampton URL/
    )
  })

  it('a backslash cannot make another origin look site-relative', () => {
    // content-pipeline.md §11.1: the WHATWG URL spec normalises `\` to `/` in a
    // special scheme, so `/\evil.example.com/x` is site-relative to a screen
    // that reasons about prefixes and another ORIGIN to every browser.
    const back = String.fromCodePoint(0x5c)
    const reason = refusal({ subject: 'Look here', bodyText: `${GOOD_BODY}\n\nSee https://www.hosthampton.com/${back}evil.example.com/x` })
    expect(reason).toMatch(/not a Host Hampton URL/)
  })
})

describe('the placeholder list agrees with the renderer', () => {
  it('every allowed placeholder is one lib/sequences/render.ts really substitutes', () => {
    // Read off the module rather than remembered. A token allowed here and not
    // substituted there is rendered to a customer literally (rule 11).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src', 'lib', 'sequences', 'render.ts'),
      'utf8'
    )
    // `render.ts` writes each token as a REGEX — `/\{\{first_name\}\}/g` — so
    // the literal that appears in its source is the escaped form. Asserted on
    // that rather than on `{{first_name}}`, which would pass on a file that
    // merely mentioned the token in a comment.
    const esc = (p: string) => `\\{\\{${p}\\}\\}`
    for (const p of ALLOWED_PLACEHOLDERS) {
      expect(src).toContain(esc(p))
    }
  })

  it('and nothing is allowed here that the renderer does not know', () => {
    // The dangerous direction. A token in this list that `render.ts` does not
    // substitute is one a customer reads literally.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src', 'lib', 'sequences', 'render.ts'),
      'utf8'
    )
    const declared = Array.from(src.matchAll(/\\\{\\\{([a-z_]+)\\\}\\\}/g)).map(m => m[1])
    expect(declared.length).toBeGreaterThan(0)
    for (const p of ALLOWED_PLACEHOLDERS) expect(declared).toContain(p)
  })
})
