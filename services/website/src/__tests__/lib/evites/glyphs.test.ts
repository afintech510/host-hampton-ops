import fs from 'fs'
import path from 'path'
import { FONT_KEYS, FONT_FILES, fontDir, loadFont, fitsFont, screenForImage, type FontKey } from '@/lib/evites/glyphs'

const cp = (...n: number[]) => String.fromCodePoint(...n)
const MIDDLE_DOT = cp(0xb7)
const EN_DASH = cp(0x2013)
const CURLY_APOS = cp(0x2019)
const L_STROKE = cp(0x141)
const E_ACUTE = cp(0xe9)
const COMBINING_ACUTE = cp(0x301)
const PARTY_POPPER = cp(0x1f389)
const STAR = cp(0x2b50)
const FULLWIDTH_MIA = cp(0xff2d, 0xff29, 0xff21)

describe('evites/glyphs - the bundled fonts', () => {
  it('all five .woff files exist where fontDir() says, and load', () => {
    expect(fontDir()).toBe(path.join(process.cwd(), 'public', 'evites', 'fonts'))
    for (const k of FONT_KEYS) {
      expect(fs.existsSync(path.join(fontDir(), FONT_FILES[k].file))).toBe(true)
      expect(loadFont(k).numGlyphs).toBeGreaterThan(100)
    }
  })

  it('font loads are memoised (same object back)', () => {
    for (const k of FONT_KEYS) expect(loadFont(k)).toBe(loadFont(k))
  })

  it('an unknown key throws loudly (a coding error, not a runtime condition)', () => {
    expect(() => loadFont('comic-sans' as FontKey)).toThrow(/unknown font key/)
  })
})

describe('evites/glyphs - fitsFont', () => {
  it.each(FONT_KEYS.map((k) => [k]))('%s covers the characters the invitation copy is made of', (k) => {
    expect(fitsFont('MIA', k)).toBe(true)
    expect(fitsFont('7TH 2:30-4:30 & !', k)).toBe(true)
  })

  it.each(FONT_KEYS.map((k) => [k]))('%s has the middle dot and the en dash (asserted per font)', (k) => {
    expect(fitsFont(MIDDLE_DOT, k)).toBe(true)
    expect(fitsFont(EN_DASH, k)).toBe(true)
  })

  it.each(FONT_KEYS.map((k) => [k]))('%s lacks an emoji and an L-with-stroke (latin subset)', (k) => {
    expect(fitsFont(PARTY_POPPER, k)).toBe(false)
    expect(fitsFont(STAR, k)).toBe(false)
    expect(fitsFont(L_STROKE, k)).toBe(false)
  })

  it('controls and zero-width characters never "fit", whatever the cmap says', () => {
    expect(fitsFont('A\nB', 'poppins400')).toBe(false)
    expect(fitsFont('A' + cp(0x200b) + 'B', 'poppins400')).toBe(false)
    expect(fitsFont('A' + cp(0xfe0f), 'poppins400')).toBe(false)
  })

  it('the empty string fits', () => {
    expect(fitsFont('', 'bungee')).toBe(true)
  })
})

describe('evites/glyphs - screenForImage', () => {
  it.each(FONT_KEYS.map((k) => [k]))('%s keeps the middle dot and the en dash exactly where the font has them', (k) => {
    expect(screenForImage(`Sat ${MIDDLE_DOT} 2${EN_DASH}4 PM`, k)).toBe(`Sat ${MIDDLE_DOT} 2${EN_DASH}4 PM`)
  })

  it.each(FONT_KEYS.map((k) => [k]))('%s folds "Lucja" with an L-stroke to plain L', (k) => {
    expect(screenForImage(`${L_STROKE}ucja`, k)).toBe('Lucja')
    expect(screenForImage(`${L_STROKE}UCJA`, k)).toBe('LUCJA')
  })

  it.each(FONT_KEYS.map((k) => [k]))('%s drops an emoji and does not leave a double space', (k) => {
    expect(screenForImage(`Mia ${PARTY_POPPER}`, k)).toBe('Mia')
    expect(screenForImage(`Mia ${PARTY_POPPER} Rose`, k)).toBe('Mia Rose')
    expect(screenForImage(PARTY_POPPER, k)).toBe('')
    expect(screenForImage(`BIRTHDAY STAR ${STAR}`, k)).toBe('BIRTHDAY STAR')
  })

  it('keeps an accented letter the font has (no blanket NFKD)', () => {
    expect(fitsFont(E_ACUTE, 'poppins400')).toBe(true)
    expect(screenForImage(`Jos${E_ACUTE}`, 'poppins400')).toBe(`Jos${E_ACUTE}`)
  })

  it('composes a decomposed input before looking it up', () => {
    expect(screenForImage(`Jose${COMBINING_ACUTE}`, 'poppins400')).toBe(`Jos${E_ACUTE}`)
  })

  it('folds compatibility forms: fullwidth letters become ASCII', () => {
    expect(screenForImage(FULLWIDTH_MIA, 'bungee')).toBe('MIA')
  })

  it('an apostrophe survives; a curly one is kept where the font has it, else straightened', () => {
    expect(screenForImage("Mia's", 'bungee')).toBe("Mia's")
    const out = screenForImage(`Mia${CURLY_APOS}s`, 'bungee')
    expect(out === `Mia${CURLY_APOS}s` || out === "Mia's").toBe(true)
    expect(fitsFont(out, 'bungee')).toBe(true)
  })

  it('whitespace of every kind collapses to one space and the ends are trimmed', () => {
    expect(screenForImage('  Mia \t\n  Rose  ', 'poppins400')).toBe('Mia Rose')
    expect(screenForImage('Mia' + cp(0xa0) + 'Rose', 'poppins400')).toBe('Mia Rose')
  })

  it('the output always fits the font it was screened for', () => {
    const nasty = `${L_STROKE}ukasz ${PARTY_POPPER} ${cp(0xdf)} ${cp(0xd8)}re ${cp(0x4e2d, 0x6587)} ${cp(0x2026)} ${cp(0x201c)}hi${cp(0x201d)}`
    for (const k of FONT_KEYS) expect(fitsFont(screenForImage(nasty, k), k)).toBe(true)
  })

  it('empty and non-string input are empty', () => {
    expect(screenForImage('', 'bungee')).toBe('')
    expect(screenForImage(undefined as unknown as string, 'bungee')).toBe('')
    expect(screenForImage(null as unknown as string, 'bungee')).toBe('')
  })

  it('a name with no drawable character at all screens to nothing (so the caller can say "no name")', () => {
    expect(screenForImage(cp(0x4e2d, 0x6587), 'bungee')).toBe('')
  })
})
