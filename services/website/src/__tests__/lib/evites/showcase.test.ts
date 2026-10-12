import { sampleShowcaseInput, screenShowcaseInput, showcaseCards, showcaseTemplates, themeWordOf } from '@/lib/evites/showcase'

describe('invitation showcase (/invitations)', () => {
  it('shows every registered design except plain, the fallback', () => {
    const slugs = showcaseTemplates().map((t) => t.slug)
    expect(slugs.length).toBeGreaterThan(0)
    expect(slugs).not.toContain('plain')
    expect(slugs).toContain('glow')
  })

  it('draws each design with what the visitor typed, in that design', () => {
    const cards = showcaseCards({ name: 'ava', age: 6, date: '2026-11-14', time: '14:00' })
    expect(cards.map((c) => c.slug)).toEqual(showcaseTemplates().map((t) => t.slug))
    for (const c of cards) {
      expect(c.facts.templateSlug).toBe(c.slug)
      expect(c.facts.honoreeDisplay).toBe('AVA')
      expect(c.facts.honoreeName).toBe('Ava')
      expect(c.facts.ageOrdinal).toBe('6th')
      expect(c.facts.dateLine).toBe('Saturday, November 14 · 2–4 PM')
      expect(c.facts.timeText).toBe('2–4 PM')
      expect(c.facts.window).toBeNull()
      expect(c.label).not.toBe('')
    }
    expect(cards.find((c) => c.slug === 'glow')?.facts.themeWord).toBe('GLOW')
  })

  it('a theme word never doubles the design\'s own "PARTY" and always fits the 12-character column', () => {
    for (const c of showcaseCards(sampleShowcaseInput())) {
      expect(c.facts.themeWord).not.toMatch(/\bPARTY\b/)
      expect(c.facts.themeWord.length).toBeLessThanOrEqual(12)
    }
    const fake = (slug: string, label: string) => ({ slug, label }) as unknown as Parameters<typeof themeWordOf>[0]
    expect(themeWordOf(fake('x-1', 'Neon Party'))).toBe('NEON')
    expect(themeWordOf(fake('x-2', 'Watercolor Unicorn'))).toBe('UNICORN')
    expect(themeWordOf(fake('x-3', 'Honk, Beep, Vroom'))).toBe('VROOM')
    expect(themeWordOf(fake('x-4', 'Saddle Up (Horse)'))).toBe('SADDLE UP')
    expect(themeWordOf(fake('x-5', 'Party'))).toBe('BIRTHDAY')
  })

  it('a gap draws the way a real invite with that gap does', () => {
    const [glow] = showcaseCards({ name: '', age: null, date: null, time: null })
    expect(glow.facts.hasName).toBe(false)
    expect(glow.facts.honoreeDisplay).toBe('BIRTHDAY STAR')
    expect(glow.facts.dateLine).toBe('Pick your date')
    const dateOnly = showcaseCards({ name: 'Mia', age: 7, date: '2026-11-14', time: null })[0]
    expect(dateOnly.facts.dateLine).toBe('Saturday, November 14')
    expect(dateOnly.facts.timeText).toBe('')
  })

  it('screens untrusted input and never throws', () => {
    expect(screenShowcaseInput(null)).toEqual({ name: '', age: null, date: null, time: null })
    expect(screenShowcaseInput('nope')).toEqual({ name: '', age: null, date: null, time: null })
    expect(screenShowcaseInput({ name: 'A'.repeat(50), age: '7', date: '2026-02-31', time: '25:99' })).toEqual({
      name: 'A'.repeat(20),
      age: 7,
      date: null,
      time: null,
    })
    expect(screenShowcaseInput({ name: ' Mia\u0000 ', age: 0, date: '2026-11-14', time: '09:30' })).toEqual({
      name: 'Mia',
      age: null,
      date: '2026-11-14',
      time: '09:30',
    })
    expect(screenShowcaseInput({ age: 21 }).age).toBeNull()
    expect(screenShowcaseInput({ age: 6.5 }).age).toBeNull()
  })

  it('the sample party is a Saturday at least two weeks out', () => {
    const s = sampleShowcaseInput(new Date('2026-10-11T15:00:00Z'))
    expect(s.date).toBe('2026-10-31')
    expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).toBe(6)
    expect(s).toMatchObject({ name: 'Mia', age: 7, time: '14:00' })
  })
})
