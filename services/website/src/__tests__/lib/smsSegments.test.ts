/**
 * Tests for lib/smsSegments.ts — the 160/320 marks in the composer.
 *
 * The property worth testing is the one a comment cannot guarantee: that a
 * single non-GSM character changes the answer for the WHOLE message. Our drafts
 * are full of curly apostrophes because that is what a model writes for
 * "kid's", so a counter that got this wrong would have told Allie a
 * 150-character message was one segment while the carrier split and billed it
 * as three.
 */

import { smsEncodingOf, smsSegmentInfo, smsUnits } from '@/lib/smsSegments'

describe('smsEncodingOf', () => {
  it('is GSM-7 for ordinary ASCII', () => {
    expect(smsEncodingOf("Hi Jess - we can do Saturday the 12th at 2pm. Sound good?")).toBe('GSM-7')
  })

  it('drops to UCS-2 on a single curly apostrophe', () => {
    // The exact character a model writes, and the one that would silently
    // triple the segment count.
    expect(smsEncodingOf('your kid’s party')).toBe('UCS-2')
  })

  it('drops to UCS-2 on an em dash or an emoji', () => {
    expect(smsEncodingOf('we can do it — no problem')).toBe('UCS-2')
    expect(smsEncodingOf('see you then 🎉')).toBe('UCS-2')
  })

  it('keeps the GSM extension characters in GSM-7', () => {
    expect(smsEncodingOf('total [1200] {net}')).toBe('GSM-7')
  })
})

describe('smsUnits', () => {
  it('counts an extended GSM character as two septets', () => {
    // '[' needs an escape byte, so it costs twice what a letter does.
    expect(smsUnits('abc')).toBe(3)
    expect(smsUnits('ab[')).toBe(4)
  })

  it('counts UCS-2 in UTF-16 code units, so an astral emoji is two', () => {
    expect(smsUnits('🎉')).toBe(2)
  })
})

describe('smsSegmentInfo', () => {
  it('is zero segments for an empty draft', () => {
    const info = smsSegmentInfo('')
    expect(info.segments).toBe(0)
    expect(info.units).toBe(0)
  })

  it('is one segment at exactly 160 GSM characters and two at 161', () => {
    expect(smsSegmentInfo('a'.repeat(160)).segments).toBe(1)
    expect(smsSegmentInfo('a'.repeat(161)).segments).toBe(2)
  })

  it('charges the concatenation header past the first segment', () => {
    // 153, not 160, per segment once there is more than one — which is why the
    // second boundary is 306 and not 320.
    expect(smsSegmentInfo('a'.repeat(306)).segments).toBe(2)
    expect(smsSegmentInfo('a'.repeat(307)).segments).toBe(3)
  })

  it('splits a UCS-2 message at 70, not 160', () => {
    const text = '’' + 'a'.repeat(70)
    const info = smsSegmentInfo(text)
    expect(info.encoding).toBe('UCS-2')
    expect(info.units).toBe(71)
    expect(info.segments).toBe(2)
  })

  it('reports the remaining room against the CURRENT limit, never negative', () => {
    const info = smsSegmentInfo('a'.repeat(200))
    expect(info.segments).toBe(2)
    expect(info.unitsInCurrentLimit).toBe(306)
    expect(info.unitsRemaining).toBe(106)
    expect(smsSegmentInfo('a'.repeat(306)).unitsRemaining).toBe(0)
  })

  it('moves its boundary marks with the encoding', () => {
    expect(smsSegmentInfo('plain').boundaries[0]).toBe(160)
    expect(smsSegmentInfo('’').boundaries[0]).toBe(70)
  })
})
