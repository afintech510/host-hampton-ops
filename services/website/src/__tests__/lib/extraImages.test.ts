import sharp from 'sharp'
import {
  EXTRA_ALT_MAX,
  EXTRA_OBJECT,
  MAX_EXTRA_IMAGES,
  cleanExtraAlt,
  extraImageUrls,
  screenExtraImagesValue,
} from '@/lib/evites/extraImages'
import { newExtraObject, processExtraImage, sniffImageType } from '@/lib/evites/extraImagesProcess'

const KEY = 'a'.repeat(32)
const OBJ = 'extra-0123456789abcdef.jpg'

describe('screenExtraImagesValue', () => {
  it('keeps valid entries and cleans the alt', () => {
    expect(screenExtraImagesValue([{ object: OBJ, alt: '  Bring   diapers <b> ' }])).toEqual([{ object: OBJ, alt: 'Bring diapers b' }])
  })
  it('drops anything that is not an exact object name, duplicates and non-objects', () => {
    const bad = ['../x.jpg', 'extra-0123456789abcdef.png', 'extra-0123456789ABCDEF.jpg', 'extra-short.jpg', 'custom-0123456789abcdef.jpg', 'extra-0123456789abcdef.jpg/../a', 5, null]
    const v = [...bad.map((object) => ({ object, alt: 'x' })), null, 'str', 7, { object: OBJ }, { object: OBJ, alt: 'dup' }]
    expect(screenExtraImagesValue(v)).toEqual([{ object: OBJ, alt: '' }])
  })
  it('is null-safe and caps at four', () => {
    for (const v of [null, undefined, 'x', {}, 3]) expect(screenExtraImagesValue(v)).toEqual([])
    const five = Array.from({ length: 5 }, (_, i) => ({ object: `extra-000000000000000${i}.jpg`, alt: '' }))
    expect(screenExtraImagesValue(five)).toHaveLength(MAX_EXTRA_IMAGES)
  })
  it('alt is capped at 120 characters and stripped of control characters', () => {
    expect(cleanExtraAlt('x'.repeat(500))).toHaveLength(EXTRA_ALT_MAX)
    expect(cleanExtraAlt('a\u0000b\nc')).toBe('a b c')
    expect(cleanExtraAlt(42)).toBe('')
  })
})

describe('extraImageUrls', () => {
  it('builds the public Storage URL in the evite folder', () => {
    expect(extraImageUrls({ image_key: KEY, extra_images: [{ object: OBJ, alt: 'a' }] }, 'https://p.supabase.co/')).toEqual([
      { object: OBJ, alt: 'a', url: `https://p.supabase.co/storage/v1/object/public/evites/${KEY}/${OBJ}` },
    ])
  })
  it('is empty without an image_key, a Supabase URL or a valid key', () => {
    const ex = [{ object: OBJ, alt: '' }]
    expect(extraImageUrls({ image_key: null, extra_images: ex }, 'https://p.supabase.co')).toEqual([])
    expect(extraImageUrls({ image_key: 'not-a-key', extra_images: ex }, 'https://p.supabase.co')).toEqual([])
    expect(extraImageUrls({ image_key: KEY, extra_images: ex }, undefined)).toEqual([])
    expect(extraImageUrls({ image_key: KEY }, 'https://p.supabase.co')).toEqual([])
  })
})

describe('processing', () => {
  it('names are random and match the stored pattern', () => {
    const a = newExtraObject()
    expect(a).toMatch(EXTRA_OBJECT)
    expect(newExtraObject()).not.toBe(a)
  })
  it('magic bytes, not names', () => {
    expect(sniffImageType(Buffer.from('<svg></svg>'))).toBeNull()
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
  })
  it('resizes to 1200 wide without cropping, never enlarges, outputs a JPEG', async () => {
    const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer()
    const out = await processExtraImage(wide)
    const m = await sharp(out).metadata()
    expect(m.format).toBe('jpeg')
    expect(m.width).toBe(1200)
    expect(m.height).toBe(400)
    const small = await sharp({ create: { width: 300, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const m2 = await sharp(await processExtraImage(small)).metadata()
    expect([m2.width, m2.height]).toEqual([300, 500])
  })
  it('throws on bytes sharp cannot read', async () => {
    await expect(processExtraImage(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]))).rejects.toThrow()
  })
})
