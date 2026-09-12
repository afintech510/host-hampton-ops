/**
 * `createTownServiceDraft` used to `JSON.parse` a model reply and insert it
 * wholesale. These tests are the shapes a model really produces — and the ones
 * an injected instruction inside a town name would aim for.
 */

import {
  normalizeDraft,
  trimToBudget,
  trimTitleToBudget,
  MAX_SECTIONS,
  MAX_FAQ_ITEMS,
  MAX_KEYWORDS,
  MAX_SECTION_TEXT_CHARS,
} from '@/lib/content/draftNormalize'
import { MAX_TITLE_CHARS, MAX_DESCRIPTION_CHARS, TITLE_SUFFIX } from '@/lib/seo'

const U = (cp: number) => String.fromCodePoint(cp)

const GOOD = {
  title: 'Permanent Jewelry in Southampton | Host Hampton',
  meta_description: 'Welded-on permanent bracelets for Southampton and the East End.',
  keywords: ['permanent jewelry southampton', 'welded bracelet'],
  sections: [{ heading: 'How it works', text: 'We weld it on.' }],
  faq: [{ q: 'Do you come to Southampton?', a: 'We do.' }],
}

describe('the happy path passes through unchanged', () => {
  it('keeps every field and records no notes', () => {
    const r = normalizeDraft(GOOD)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft).toEqual(GOOD)
    expect(r.notes).toEqual([])
  })
})

describe('the title and description budget is enforced by the WRITER', () => {
  it('a long title is trimmed and KEEPS the brand suffix', () => {
    const long = `Permanent Jewelry Welded Bracelets and Anklets for Southampton New York${TITLE_SUFFIX}`
    expect(long.length).toBeGreaterThan(MAX_TITLE_CHARS)
    const r = normalizeDraft({ ...GOOD, title: long })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(r.draft.title.endsWith(TITLE_SUFFIX)).toBe(true)
    // Rule 10: the trim must be reported, not silent.
    expect(r.notes.join(' ')).toMatch(/title/)
  })

  it('a long title with no suffix is trimmed plainly', () => {
    const r = normalizeDraft({ ...GOOD, title: 'A'.repeat(200) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
  })

  it('the 165-character description that is LIVE today would be cut to budget', () => {
    // /es/party-room-rental carries 165 characters. Nothing constrained it
    // because the budget lived only in a prompt.
    const live = 'x'.repeat(120) + ' ' + 'y'.repeat(44)
    expect(live.length).toBe(165)
    const r = normalizeDraft({ ...GOOD, meta_description: live })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.meta_description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
    expect(r.notes.join(' ')).toMatch(/meta_description/)
  })

  it('trims on a word boundary rather than mid-word', () => {
    const s = 'one two three four five six seven eight nine ten'
    expect(trimToBudget(s, 20)).toBe('one two three four')
    expect(trimToBudget(s, 100)).toBe(s)
  })

  it('does not collapse a string that is one very long token', () => {
    const s = 'a'.repeat(50)
    expect(trimToBudget(s, 20)).toHaveLength(20)
  })

  it('trimTitleToBudget leaves a title that already fits alone', () => {
    expect(trimTitleToBudget(GOOD.title)).toBe(GOOD.title)
  })
})

describe('the `html` key — the one the renderer used to execute', () => {
  it('a section returning html stores TEXT and reports it', () => {
    const r = normalizeDraft({
      ...GOOD,
      sections: [{ heading: 'Hi', html: '<p>Real copy</p><script>steal()</script>' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.sections[0]).toEqual({ heading: 'Hi', text: 'Real copy' })
    // No `html` key survives into what gets stored.
    expect(Object.keys(r.draft.sections[0])).toEqual(['heading', 'text'])
    expect(JSON.stringify(r.draft)).not.toMatch(/steal|<script/)
    expect(r.notes.join(' ')).toMatch(/"html" field/)
  })

  it('markup inside a `text` field is stripped too', () => {
    const r = normalizeDraft({
      ...GOOD,
      sections: [{ heading: 'Hi', text: 'Copy <img src=x onerror=alert(1)> more' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.sections[0].text).not.toMatch(/onerror|</)
  })

  it('markup in the TITLE is stripped', () => {
    const r = normalizeDraft({ ...GOOD, title: '<b>Southampton</b> | Host Hampton' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).toBe('Southampton | Host Hampton')
  })
})

/**
 * `.length` and `.slice` count UTF-16 code units, not characters. A budget cut
 * that lands between the halves of a surrogate pair leaves a lone surrogate,
 * which is not a character at all: it serialises as U+FFFD in the `<title>` or
 * `<meta name="description">` this string exists to fill. The trim that fixed
 * the SEO budget would have put a replacement glyph in the search result.
 */
describe('trimming never splits a surrogate pair', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

  it('an emoji-heavy description is cut on a whole character', () => {
    const desc = 'Book a party ' + '\u{1F389}'.repeat(100)
    const out = trimToBudget(desc, MAX_DESCRIPTION_CHARS)
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
    expect(LONE_SURROGATE.test(out)).toBe(false)
    // And it is still the same string up to the cut, not a mangled one.
    expect(desc.startsWith(out)).toBe(true)
  })

  it('a cut landing exactly between the two halves drops the half', () => {
    // 'ab' + one emoji: slicing to 3 lands mid-pair.
    const out = trimToBudget('ab\u{1F389}cd', 3)
    expect(LONE_SURROGATE.test(out)).toBe(false)
    expect(out).toBe('ab')
  })

  it('an emoji title keeps its brand suffix and stays whole', () => {
    const title = 'Permanent Jewelry ' + '\u{1F389}'.repeat(30) + TITLE_SUFFIX
    const out = trimTitleToBudget(title)
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
    expect(LONE_SURROGATE.test(out)).toBe(false)
    expect(out.endsWith(TITLE_SUFFIX)).toBe(true)
  })
})

describe('the characters that forge structure', () => {
  it('a newline in the title becomes a space', () => {
    const r = normalizeDraft({ ...GOOD, title: 'South\nampton | Host Hampton' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).toBe('South ampton | Host Hampton')
  })

  it.each([0x85, 0x2028, 0x2029])('U+%s is flattened, not passed through', cp => {
    const r = normalizeDraft({ ...GOOD, title: `A${U(cp)}B | Host Hampton` })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).not.toContain(U(cp))
  })

  it.each([0x200b, 0x200d, 0xfeff, 0x202e, 0x2066])('U+%s is removed outright', cp => {
    const r = normalizeDraft({ ...GOOD, title: `A${U(cp)}B | Host Hampton` })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).not.toContain(U(cp))
  })

  it('a C1 control is removed', () => {
    const r = normalizeDraft({ ...GOOD, title: `A${U(0x9b)}B | Host Hampton` })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).toBe('AB | Host Hampton')
  })
})

describe('shapes the type annotation claimed were impossible', () => {
  it.each([null, undefined, 'a string', 42, [1, 2, 3]])('refuses %j as a reply', v => {
    const r = normalizeDraft(v)
    expect(r.ok).toBe(false)
  })

  it('refuses a reply with no title', () => {
    const r = normalizeDraft({ ...GOOD, title: '   ' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/title/)
  })

  it('refuses a reply with no sections AND no faq — an empty landing page', () => {
    const r = normalizeDraft({ ...GOOD, sections: [], faq: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/sections or FAQ/)
  })

  it('drops non-object entries inside the arrays instead of storing them', () => {
    const r = normalizeDraft({
      ...GOOD,
      sections: ['a string', null, 42, ['nested'], { heading: 'Real', text: 'Copy' }],
      faq: ['junk', { q: 'Q?', a: 'A.' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.sections).toEqual([{ heading: 'Real', text: 'Copy' }])
    expect(r.draft.faq).toEqual([{ q: 'Q?', a: 'A.' }])
    expect(r.notes.join(' ')).toMatch(/kept 1 of 5/)
  })

  it('drops an FAQ entry with a question and no answer', () => {
    // A `Question` node with an empty `acceptedAnswer` is invalid structured
    // data — worse than no FAQ at all.
    const r = normalizeDraft({ ...GOOD, faq: [{ q: 'Do you travel?', a: '' }, { q: 'Q?', a: 'A.' }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.faq).toEqual([{ q: 'Q?', a: 'A.' }])
  })

  it('drops keywords that are not strings', () => {
    const r = normalizeDraft({ ...GOOD, keywords: ['ok', null, 7, { a: 1 }, 'also ok'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.keywords).toEqual(['ok', 'also ok'])
  })

  it('drops a non-array keywords / sections / faq and says so', () => {
    const r = normalizeDraft({ ...GOOD, keywords: 'not an array' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.keywords).toEqual([])
    expect(r.notes.join(' ')).toMatch(/keywords: dropped/)
  })
})

describe('nothing is unbounded', () => {
  it('caps sections, faq and keywords', () => {
    const r = normalizeDraft({
      ...GOOD,
      sections: Array.from({ length: 40 }, (_, i) => ({ heading: `H${i}`, text: 'x' })),
      faq: Array.from({ length: 40 }, (_, i) => ({ q: `Q${i}`, a: 'a' })),
      keywords: Array.from({ length: 40 }, (_, i) => `k${i}`),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.sections).toHaveLength(MAX_SECTIONS)
    expect(r.draft.faq).toHaveLength(MAX_FAQ_ITEMS)
    expect(r.draft.keywords).toHaveLength(MAX_KEYWORDS)
  })

  it('caps a runaway section body', () => {
    const r = normalizeDraft({ ...GOOD, sections: [{ heading: 'H', text: 'x'.repeat(50_000) }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.sections[0].text.length).toBeLessThanOrEqual(MAX_SECTION_TEXT_CHARS)
  })
})
