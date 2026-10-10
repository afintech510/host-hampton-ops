import { fitFontSize } from '@/lib/evites/fit'
import { loadFont } from '@/lib/evites/glyphs'

/** The name slot of the Glow layout: Bungee Outline, 165 px, 90 px floor, 960 px wide. */
const NAME = { font: 'bungee' as const, size: 165, minSize: 90, maxWidth: 960 }

describe('evites/fit - fitFontSize', () => {
  it('a short name keeps the full size', () => {
    const r = fitFontSize({ ...NAME, text: 'MIA' })
    expect(r.size).toBe(165)
    expect(r.fits).toBe(true)
    expect(r.width).toBeLessThanOrEqual(960)
  })

  it('a long name shrinks to <= maxWidth and >= minSize', () => {
    const r = fitFontSize({ ...NAME, text: 'ALEXANDRIA' })
    expect(r.size).toBeLessThan(165)
    expect(r.size).toBeGreaterThanOrEqual(90)
    expect(r.width).toBeLessThanOrEqual(960)
    expect(r.fits).toBe(true)
  })

  it('is the LARGEST whole size that fits: one pixel more would overflow', () => {
    const r = fitFontSize({ ...NAME, text: 'ALEXANDRIA' })
    const font = loadFont('bungee')
    expect(font.getAdvanceWidth('ALEXANDRIA', r.size + 1, { kerning: true })).toBeGreaterThan(960)
    expect(Number.isInteger(r.size)).toBe(true)
  })

  it('agrees with a brute-force step-down (the spike\'s algorithm)', () => {
    const font = loadFont('bungee')
    for (const text of ['ZOEY', 'CHRISTOPHER', 'BIRTHDAY STAR', 'WILHELMINA', 'ANNABELLE']) {
      let size = 165
      while (size > 90 && font.getAdvanceWidth(text, size, { kerning: true }) > 960) size -= 1
      expect(fitFontSize({ ...NAME, text }).size).toBe(size)
    }
  })

  it('a name too long even at the floor reports fits=false at minSize', () => {
    const r = fitFontSize({ ...NAME, text: 'WWWWWWWWWWWWWWWWWWWW' })
    expect(r.size).toBe(90)
    expect(r.fits).toBe(false)
    expect(r.width).toBeGreaterThan(960)
  })

  it('letter-spacing widens the text, so it shrinks sooner', () => {
    const base = { font: 'poppins600' as const, size: 36, minSize: 20, maxWidth: 760, text: 'SATURDAY, NOVEMBER 14 · 2–4 PM' }
    const plain = fitFontSize(base)
    const spaced = fitFontSize({ ...base, letterSpacingEm: 0.04 })
    expect(spaced.width).toBeGreaterThan(0)
    expect(spaced.size).toBeLessThanOrEqual(plain.size)
    expect(spaced.width).toBeLessThanOrEqual(760)
  })

  it('uppercase measures the upper-cased text', () => {
    const lower = fitFontSize({ ...NAME, text: 'mia', size: 100, minSize: 10 })
    const upper = fitFontSize({ ...NAME, text: 'mia', size: 100, minSize: 10, uppercase: true, maxWidth: 200 })
    const upperDirect = fitFontSize({ ...NAME, text: 'MIA', size: 100, minSize: 10, maxWidth: 200 })
    expect(upper.size).toBe(upperDirect.size)
    expect(lower.fits).toBe(true)
  })

  it('empty text is the full size and zero wide', () => {
    expect(fitFontSize({ ...NAME, text: '' })).toEqual({ size: 165, width: 0, fits: true })
  })

  it('minSize above size is clamped to size (never grows the text)', () => {
    const r = fitFontSize({ ...NAME, text: 'MIA', size: 50, minSize: 80 })
    expect(r.size).toBeLessThanOrEqual(50)
  })

  it('is memoised: the same input returns the same answer', () => {
    const a = fitFontSize({ ...NAME, text: 'ALEXANDRIA' })
    const b = fitFontSize({ ...NAME, text: 'ALEXANDRIA' })
    expect(b).toBe(a)
  })

  it('"BIRTHDAY STAR" in the no-name slot (150 px narrower) still fits above the floor', () => {
    const r = fitFontSize({ ...NAME, text: 'BIRTHDAY STAR', maxWidth: 960 - 150 })
    expect(r.size).toBeGreaterThanOrEqual(90)
    expect(r.fits).toBe(true)
  })
})
