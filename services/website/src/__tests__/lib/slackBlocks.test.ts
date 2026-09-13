/**
 * Block Kit: escaping, limits, and the parked draft (plan §25.9).
 *
 * A draft is model-written text about a customer, rendered into Slack mrkdwn.
 * `<url|label>` is how mrkdwn writes a link, so `<` in untrusted text is not a
 * cosmetic problem — it is the same shape as the injected payment handle §24
 * found in a live voice profile. Escape at ENTRY.
 */

import {
  esc,
  draftMessageBlocks,
  draftMessageText,
  settledBlocks,
  editModalView,
  encodeActionValue,
  decodeActionValue,
  ACTION_APPROVE,
  ACTION_EDIT,
} from '@/lib/slack/blocks'

const BASE = {
  draftId: '00000000-0000-4000-8000-00000000d1a1',
  reviewCode: 'HH-2026-0042',
  partyType: 'mobile_party',
  path: 'quote' as const,
  summary: 'Sarah, Oct 12, 24 guests',
}

/** Every string anywhere in a block tree, so nothing hides in a nested field. */
function allText(blocks: unknown): string[] {
  const out: string[] = []
  const walk = (n: any) => {
    if (typeof n === 'string') out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') Object.values(n).forEach(walk)
  }
  walk(blocks)
  return out
}

describe('esc — the three structural characters', () => {
  it('escapes &, < and >', () => {
    expect(esc('Ben & Jerry <b>')).toBe('Ben &amp; Jerry &lt;b&gt;')
  })

  it('escapes & FIRST, so &lt; does not become &amp;lt;', () => {
    // The identical ordering bug, in the identical shape, is why escapeHtml in
    // lib/mailTemplates.ts carries the same comment.
    expect(esc('<')).toBe('&lt;')
    expect(esc('&lt;')).toBe('&amp;lt;')
  })

  it('leaves an apostrophe and a quote alone — they are not structural here', () => {
    expect(esc(`Sarah's "party"`)).toBe(`Sarah's "party"`)
  })

  it('handles null and undefined without printing them', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })
})

describe('untrusted text cannot forge a link', () => {
  it('a draft containing mrkdwn link syntax is rendered inert', () => {
    const blocks = draftMessageBlocks({
      ...BASE,
      summary: 'Call me at <https://evil.test|our secure payment page>',
      emailDraft: 'Pay here: <https://evil.test|Host Hampton Payments>',
    })
    const text = allText(blocks).join('\n')
    expect(text).not.toContain('<https://evil.test|')
    expect(text).toContain('&lt;https://evil.test|')
  })

  it('a customer name with an ampersand survives readably', () => {
    const blocks = draftMessageBlocks({ ...BASE, summary: 'Ben & Jerry, Oct 12' })
    expect(allText(blocks).join('\n')).toContain('Ben &amp; Jerry')
  })

  it('the only real <…|…> is the review link WE minted', () => {
    const blocks = draftMessageBlocks({
      ...BASE,
      summary: 'a <b> summary',
      reviewUrl: 'https://hosthampton.com/s/8Kq2mXp7Ld3Rw9vTnY4bZc',
    })
    const links = allText(blocks).join('\n').match(/<[^&][^>]*\|[^>]*>/g) ?? []
    expect(links).toEqual(['<https://hosthampton.com/s/8Kq2mXp7Ld3Rw9vTnY4bZc|Open the full review page>'])
  })
})

describe("Slack's limits are rejections, not truncations", () => {
  it('caps a long email draft rather than letting the whole message be refused', () => {
    // Over-length blocks get `invalid_blocks`, which under the fail-soft client
    // reads as "Slack was down" and falls back to SMS forever.
    const blocks = draftMessageBlocks({ ...BASE, emailDraft: 'x'.repeat(9000) })
    for (const s of allText(blocks)) expect(s.length).toBeLessThanOrEqual(3000)
  })

  it('caps the header at 150', () => {
    const blocks: any = draftMessageBlocks({ ...BASE, reviewCode: 'HH-' + 'X'.repeat(400) })
    expect(blocks[0].text.text.length).toBeLessThanOrEqual(150)
  })

  it('counts the ESCAPED length — &amp; is five characters, not one', () => {
    const blocks = draftMessageBlocks({ ...BASE, emailDraft: '&'.repeat(2000) })
    for (const s of allText(blocks)) expect(s.length).toBeLessThanOrEqual(3000)
  })
})

describe('a PARKED draft gets no Approve button', () => {
  it('has no actions block at all', () => {
    const blocks: any[] = draftMessageBlocks({ ...BASE, warning: 'the draft quoted a price we do not offer' })
    expect(blocks.some(b => b.type === 'actions')).toBe(false)
  })

  it('leads with the warning, above the draft', () => {
    // A reviewer skimming on a phone is exactly who an injected payment handle
    // is aimed at, and a warning below the text is a warning read second.
    const blocks: any[] = draftMessageBlocks({
      ...BASE,
      warning: 'mentions an unknown payment handle',
      emailDraft: 'the body of the draft',
    })
    const flat = blocks.map(b => JSON.stringify(b))
    const warnAt = flat.findIndex(s => s.includes('CHECK THIS'))
    const draftAt = flat.findIndex(s => s.includes('the body of the draft'))
    expect(warnAt).toBeGreaterThan(-1)
    expect(warnAt).toBeLessThan(draftAt)
  })

  it('an ordinary draft DOES get the four buttons', () => {
    const blocks: any[] = draftMessageBlocks(BASE)
    const actions = blocks.find(b => b.type === 'actions')
    expect(actions.elements.map((e: any) => e.action_id)).toEqual([
      ACTION_APPROVE,
      ACTION_EDIT,
      'hh_test',
      'hh_cancel',
    ])
  })

  it('the Approve button asks for confirmation — there is no undo on a send', () => {
    const blocks: any[] = draftMessageBlocks(BASE)
    const approve = blocks.find(b => b.type === 'actions').elements[0]
    expect(approve.confirm).toBeDefined()
    expect(approve.confirm.text.text).toMatch(/no undo/i)
  })
})

describe('the notification line', () => {
  it('carries the code and the summary, not "New lead"', () => {
    // This is the half a reviewer sees on a lock screen at 9pm, which is the
    // moment speed-to-lead is actually decided.
    const text = draftMessageText(BASE)
    expect(text).toContain('HH-2026-0042')
    expect(text).toContain('Sarah, Oct 12, 24 guests')
    expect(text).toContain('mobile party')
  })

  it('says DRAFT HELD for a parked draft', () => {
    expect(draftMessageText({ ...BASE, warning: 'held' })).toContain('DRAFT HELD')
  })
})

describe('action values are identifiers, not instructions', () => {
  it('round-trips', () => {
    const v = { draftId: 'd-1', reviewCode: 'HH-2026-0042' }
    expect(decodeActionValue(encodeActionValue(v))).toEqual(v)
  })

  it('refuses junk rather than inventing a draft id', () => {
    expect(decodeActionValue('not json')).toBeNull()
    expect(decodeActionValue('{}')).toBeNull()
    expect(decodeActionValue(JSON.stringify({ draftId: '' }))).toBeNull()
    expect(decodeActionValue(undefined)).toBeNull()
    expect(decodeActionValue(42)).toBeNull()
  })
})

describe('settledBlocks', () => {
  it('removes the actions block — Slack has no disabled button', () => {
    const original: any[] = draftMessageBlocks(BASE)
    expect(original.some(b => b.type === 'actions')).toBe(true)
    const settled: any[] = settledBlocks({ original, outcome: 'Sent to Sarah (email + text)', by: 'Adam' })
    expect(settled.some(b => b.type === 'actions')).toBe(false)
    expect(JSON.stringify(settled)).toContain('Sent to Sarah')
    expect(JSON.stringify(settled)).toContain('Adam')
  })

  it('escapes the outcome and the actor', () => {
    const settled = settledBlocks({ original: [], outcome: '<b>sent</b>', by: 'A & B' })
    const text = allText(settled).join('')
    expect(text).toContain('&lt;b&gt;')
    expect(text).toContain('A &amp; B')
  })
})

describe('the edit modal', () => {
  it('carries the draft id across the round trip in private_metadata', () => {
    const view: any = editModalView({
      draftId: 'd-1',
      reviewCode: 'HH-2026-0042',
      channel: 'C0LEADS',
      threadTs: '1789266286.113400',
    })
    expect(JSON.parse(view.private_metadata)).toEqual({
      draftId: 'd-1',
      reviewCode: 'HH-2026-0042',
      channel: 'C0LEADS',
      threadTs: '1789266286.113400',
    })
  })

  it('keeps the title inside Slack 24-character limit', () => {
    const view: any = editModalView({ draftId: 'd-1', reviewCode: 'HH-' + 'X'.repeat(100) })
    expect(view.title.text.length).toBeLessThanOrEqual(24)
  })
})
