import { computeSizes, ogSizes, ogTexts, ogTitleSize, HARD_FLOOR, OG_COLUMN_WIDTH } from '@/lib/evites/layout'
import { fitFontSize } from '@/lib/evites/fit'
import { inviteFacts } from '@/lib/evites/facts'
import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import { bookingRow, evitesRow, THEME_ROWS, LINE_ITEM_ROWS } from '../../helpers/eviteFixtures'

const factsFor = (booking: Record<string, unknown> = {}, evite: Record<string, unknown> = {}, items = LINE_ITEM_ROWS) =>
  inviteFacts(bookingRow(booking) as never, evitesRow(evite) as never, items, THEME_ROWS, 'live')

const widthOf = (text: string, font: 'bungee' | 'monoton' | 'neon', size: number) =>
  fitFontSize({ text, font, size, minSize: size, maxWidth: Number.POSITIVE_INFINITY }).width

describe('evites/layout - computeSizes', () => {
  it('Mia: every slot sits at its nominal size and the star has no size (it is not drawn)', () => {
    const s = computeSizes(GLOW_TEMPLATE, factsFor())
    expect(s.theme_word).toBeLessThanOrEqual(250)
    expect(s.theme_word).toBeGreaterThanOrEqual(240) // "GLOW" is ~875 px at 250
    expect(s.theme_sub).toBe(138)
    expect(s.honoree).toBe(165)
    expect(s.star).toBeUndefined()
    expect([s.age, s.birthday_word]).toEqual([128, 132])
    expect(s.date_time).toBeLessThanOrEqual(36)
    expect(s.invited_line).toBe(30) // a static slot has no maxWidth: nominal
  })

  it('BIRTHDAY STAR: the name shrinks so the name, the gap and the star fit the 960 px row; the star scales with it', () => {
    const f = factsFor({ child_name: null })
    expect(f.honoreeDisplay).toBe('BIRTHDAY STAR')
    const s = computeSizes(GLOW_TEMPLATE, f)
    expect(s.honoree).toBeLessThan(165)
    expect(s.honoree).toBeGreaterThanOrEqual(90)
    expect(s.star).toBeGreaterThan(0)
    expect(s.star / 156).toBeCloseTo(s.honoree / 165, 1) // the star keeps its proportion to the name
    expect(widthOf('BIRTHDAY STAR', 'bungee', s.honoree) + 24 + s.star).toBeLessThanOrEqual(960)
    // and it is the LARGEST such size: one px bigger would not fit
    const bigger = s.honoree + 1
    expect(widthOf('BIRTHDAY STAR', 'bungee', bigger) + 24 + Math.round(156 * (bigger / 165))).toBeGreaterThan(960 - 4)
  })

  it('a long name shrinks to the row, never past it', () => {
    const s = computeSizes(GLOW_TEMPLATE, factsFor({ child_name: 'Alexandria-Rose' }))
    expect(s.honoree).toBeLessThan(165)
    expect(widthOf('ALEXANDRIA-ROSE', 'bungee', s.honoree)).toBeLessThanOrEqual(960)
  })

  it('a 20-character wide name goes below the designer floor rather than off the canvas, and never below HARD_FLOOR', () => {
    const f = factsFor({ child_name: 'MMMMMMMMMMMMMMMMMMMM' })
    const s = computeSizes(GLOW_TEMPLATE, f)
    expect(s.honoree).toBeLessThan(90)
    expect(s.honoree).toBeGreaterThanOrEqual(HARD_FLOOR)
    expect(widthOf(f.honoreeDisplay, 'bungee', s.honoree)).toBeLessThanOrEqual(960)
  })

  it('a long theme word (an admin override) shrinks the GLOW slot inside 1000 px', () => {
    const f = factsFor({}, { theme_word: 'ABCDEFGHIJKL' })
    const s = computeSizes(GLOW_TEMPLATE, f)
    expect(s.theme_word).toBeLessThan(250)
    expect(widthOf('ABCDEFGHIJKL', 'monoton', s.theme_word)).toBeLessThanOrEqual(1000)
  })

  it('no age: the age row has no sizes at all (and the canvas will not draw it)', () => {
    const s = computeSizes(GLOW_TEMPLATE, factsFor({ child_age: null }))
    expect(s.age).toBeUndefined()
    expect(s.birthday_word).toBeUndefined()
  })

  it('plain has no icon strip but sizes everything else the same', () => {
    const f = factsFor({ package_type: 'Mystery' }, {}, [])
    expect(computeSizes(PLAIN_TEMPLATE, f)).toEqual(computeSizes(GLOW_TEMPLATE, f))
  })

  it('a long place line shrinks to the 760 px box and a short one does not', () => {
    const short = computeSizes(GLOW_TEMPLATE, factsFor())
    expect(short.location).toBe(25)
    const long = computeSizes(
      GLOW_TEMPLATE,
      factsFor({ party_type: 'mobile_party', party_tags: { location_type: 'mobile', address: '12345 Extraordinarily Long Boulevard Name Extension, East Quogue, NY 11942' } }),
    )
    expect(long.location).toBeLessThanOrEqual(25)
  })
})

describe('evites/layout - the OG card strings and sizes', () => {
  it('Mia: the title is MIA\'S GLOW PARTY, the host line drops "Any"', () => {
    const t = ogTexts(factsFor())
    expect(t.title).toBe("MIA'S GLOW PARTY")
    expect(t.kicker).toBe("YOU'RE INVITED")
    expect(t.date).toBe(factsFor().shortDateLine)
    expect(t.place).toBe('Host Hampton, Speonk')
    expect(t.host).toBe(`Questions? Ask Allie ${String.fromCharCode(0xb7)} 631-998-9325`)
  })

  it('no name: GLOW BIRTHDAY PARTY (spec v1.1 B1); a generic theme does not say BIRTHDAY twice', () => {
    expect(ogTexts(factsFor({ child_name: null })).title).toBe('GLOW BIRTHDAY PARTY')
    const generic = factsFor({ child_name: null, package_type: null }, {}, [])
    expect(ogTexts(generic).title).toBe('BIRTHDAY PARTY')
  })

  it('the host line is null when the host contact is switched off', () => {
    expect(ogTexts(factsFor({}, { show_host_contact: false })).host).toBeNull()
  })

  it('Mia keeps the full 74 px title; a long name shrinks it until its longest word fits the column', () => {
    expect(ogTitleSize("MIA'S GLOW PARTY", GLOW_TEMPLATE)).toBe(74)
    const long = "ALEXANDRIA-ROSE'S GLOW PARTY"
    const size = ogTitleSize(long, GLOW_TEMPLATE)
    expect(size).toBeLessThan(74)
    expect(widthOf("ALEXANDRIA-ROSE'S", 'bungee', size)).toBeLessThanOrEqual(OG_COLUMN_WIDTH)
  })

  it('ogSizes: the date, place and host lines each fit the column', () => {
    const texts = ogTexts(factsFor())
    const s = ogSizes(texts, GLOW_TEMPLATE)
    expect(s).toMatchObject({ title: 74, date: 30, place: 30, host: 24 })
  })
})
