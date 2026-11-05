/**
 * The photo library's second intake (phone albums), the tag vocabulary, and the
 * admin's bulk approval.
 *
 *   A1  tags are normalised to the spelling find_photos filters on; unknown tags are kept and reported;
 *   A2  screening: a video "poster frame" is not a poster, a flyer still is, screenshots never come in, reels are recognised;
 *   A3  an album row can only name a plain file inside the album, and the album's share link is never stored;
 *   A4  an album is planned before any file moves, and the later copy of a duplicate pair is the one dropped;
 *   A5  an album photo lands as an UNAPPROVED candidate, re-encoded WITHOUT metadata (GPS) — proven on real bytes;
 *   A6  bulk approval only touches rows whose face check is set in the database, and says who did it;
 *   A7  the admin list: junk filters match nothing, sorting by Muse's confidence, paging.
 */
import fs from 'fs'
import path from 'path'
import {
  bulkSetApproval, existingSourceKeys, facetsForAdmin, importLocalPhoto, importMuseRows, listForAdmin, looksLikeFlyer, planLocalImport,
  reelEmbedUrl, screenLocalRow, screenMuseRow, screenPatch,
} from '@/lib/media'
import { convertImageBuffer, METADATA_CHUNKS, webpChunks } from '@/lib/mediaImage'
import { canonicalActivities, canonicalDecor, canonicalTheme, slugifyTag, unknownTags, ACTIVITY_TAGS, THEME_TAGS } from '@/lib/mediaVocab'

const ALBUM = 'https://share.icloud.com/photos/0aBcDeFgHiJkLmNoPqRsTuVwX'
const IG_CDN = 'https://scontent-iad3-1.cdninstagram.com/v/t51/x.jpg?stp=dst-jpg&_nc_cat=1'
const album = (over: Record<string, string> = {}): Record<string, string> => ({
  ig_permalink: ALBUM, slide_index: '1', media_url: 'items/001.jpg', posted_at: '2026-10-04', media_type: 'image', party_type: 'mobile_party',
  venue: 'at_home', theme_slug: 'custom', activities: 'glitter-tattoos', decor_tags: '', description: 'Craft sheets on a party table', identifiable_child_face: 'no',
  people_count: '2', quality: '3', confidence: 'medium', notes: '', ...over,
})
const ig = (over: Record<string, string> = {}): Record<string, string> => ({
  ig_permalink: 'https://www.instagram.com/p/PostFake001/', slide_index: '1', media_url: IG_CDN, posted_at: '2026-11-02', media_type: 'image',
  party_type: 'in_studio_theme', venue: 'studio', theme_slug: 'glow-party', activities: '', decor_tags: 'balloon-garland', description: 'Glow party table',
  identifiable_child_face: 'no', people_count: '0', quality: '4', confidence: 'high', notes: '', ...over,
})

describe('A1: the tag vocabulary', () => {
  it('maps Muse and catalogue spellings onto the tags find_photos filters on', () => {
    expect(canonicalTheme('kpop-demon-hunter-party')).toBe('kpop-party')
    expect(canonicalTheme('Sweets n Treats Party')).toBe('sweets-treats')
    expect(canonicalTheme('none')).toBeNull()
    expect(canonicalTheme('unsure')).toBeNull()
    expect(canonicalTheme('')).toBeNull()
    expect(canonicalTheme('custom')).toBe('custom')
    expect(canonicalActivities(['slime-making', 'Slime', 'Balloon Dogs', 'beaded-braids', 'none'])).toEqual(['slime', 'balloon-dog-painting', 'hair-tinsel'])
    expect(canonicalDecor(['Balloon Arches', 'backdrop'])).toEqual(['balloon-arch', 'backdrop'])
  })

  it('every theme and activity a real Muse batch used is already canonical (no tag drifts out of the filters)', () => {
    const museThemes = ['trucker-hat-party', 'glow-party', 'swiftie-party', 'barbie-party', 'sleep-under-party', 'kpop-party', 'race-car-party', 'toddler-party', 'slime-party', 'spa-party', 'custom']
    for (const t of museThemes) expect(canonicalTheme(t)).toBe(t)
    for (const t of museThemes) expect(THEME_TAGS as readonly string[]).toContain(t)
    const museActivities = ['trucker-hat-bar', 'balloon-dog-painting', 'character-visit', 'photo-booth', 'canvas-painting', 'permanent-jewelry', 'perfume-making', 'bracelet-making', 'sand-art', 'cake-decorating', 'glitter-tattoos', 'soft-play', 'hair-tinsel', 'lip-gloss-charms', 'slime', 'decoden']
    for (const a of museActivities) { expect(canonicalActivities([a])).toEqual([a]); expect(ACTIVITY_TAGS).toHaveProperty(a) }
  })

  it('an unrecognised tag is KEPT and reported, never dropped or guessed', () => {
    expect(canonicalActivities(['hula-hooping'])).toEqual(['hula-hooping'])
    expect(unknownTags({ theme: 'dino-party', activities: ['slime', 'hula-hooping'], decor: ['backdrop', 'lasers'] })).toEqual(['theme:dino-party', 'activity:hula-hooping', 'decor:lasers'])
    expect(unknownTags({ theme: 'glow-party', activities: ['slime'], decor: ['backdrop'] })).toEqual([])
  })

  it('slugifyTag produces only characters findPhotos accepts', () => {
    for (const raw of ['Hair Tinsel', 'A & B', " x' or 1=1", '../..', 'ÄÖ', '  ']) expect(slugifyTag(raw)).toMatch(/^[a-z0-9-]*$/)
  })

  it('a hand edit in the grid is stored in the same spelling the importers write', () => {
    expect(screenPatch({ theme_slug: 'kpop-demon-hunter-party' })).toEqual({ ok: true, patch: { theme_slug: 'kpop-party' } })
    expect(screenPatch({ activities: ['slime-making', 'slime'] })).toEqual({ ok: true, patch: { activities: ['slime'] } })
  })
})

describe('A2: screening', () => {
  it('a video poster frame is NOT a poster; a real poster or flyer still is', () => {
    expect(looksLikeFlyer('Patch trays at a hat bar. Video item; catalogued from poster frame')).toBe(false)
    expect(looksLikeFlyer('Poster frame of a video showing a table')).toBe(false)
    expect(looksLikeFlyer('A poster advertising a holiday market')).toBe(true)
    expect(looksLikeFlyer('Colourful flyer; catalogued from poster frame')).toBe(true)
    expect(screenLocalRow(album({ notes: 'Poster frame of a video; catalogued from poster frame' })).ok).toBe(true)
    expect(screenLocalRow(album({ notes: 'Promo graphic only' })).ok).toBe(false)
  })

  it('a screenshot never comes in', () => {
    expect(screenLocalRow(album({ description: 'Screenshot of a text conversation' }))).toEqual({ ok: false, reason: 'a screenshot' })
    expect(screenMuseRow(ig({ notes: 'screenshot of a story' }))).toEqual({ ok: false, reason: 'a screenshot' })
  })

  it('an unsure or yes face is never taken from an album either', () => {
    for (const v of ['yes', 'unsure', '', 'maybe']) expect(screenLocalRow(album({ identifiable_child_face: v }))).toEqual({ ok: false, reason: 'a child may be identifiable' })
  })

  it('Instagram reels are recognised by permalink or thumbnail type; a plain post is a photo', () => {
    const kind = (o: Record<string, string>) => { const s = screenMuseRow(ig(o)); return s.ok ? s.candidate.mediaKind : null }
    expect(kind({})).toBe('photo')
    expect(kind({ ig_permalink: 'https://www.instagram.com/reel/ReelFake001/' })).toBe('reel')
    expect(kind({ media_type: 'video_thumbnail' })).toBe('reel')
    const s = screenMuseRow(ig({ ig_permalink: 'https://www.instagram.com/reel/ReelFake001/' }))
    if (s.ok) expect(s.candidate.permalink).toBe('https://www.instagram.com/reel/ReelFake001/') // what a later click-to-load embed needs
  })

  it('reelEmbedUrl builds an embed address for a reel permalink only, and loads no script', () => {
    expect(reelEmbedUrl('https://www.instagram.com/reel/ReelFake001/')).toBe('https://www.instagram.com/reel/ReelFake001/embed')
    expect(reelEmbedUrl('https://www.instagram.com/reel/ReelFake001/?igsh=abc')).toBe('https://www.instagram.com/reel/ReelFake001/embed')
    for (const bad of ['https://www.instagram.com/p/PostFake001/', 'https://evil.example/reel/ReelFake001/', 'https://www.instagram.com/reel/x/', '', null, undefined, 'javascript:alert(1)']) {
      expect(reelEmbedUrl(bad as never)).toBeNull()
    }
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'media.ts'), 'utf8')
    expect(src).not.toMatch(/embed\.js|instagram\.com\/embed/)
  })

  it('a letterboard or banner is flagged for a second look, not silently approved or dropped', () => {
    const s = screenLocalRow(album({ notes: 'The name and age on the letterboard are omitted from this catalogue' }))
    expect(s.ok && s.candidate.reviewFlag).toBe('text in the picture may show a name')
    const clean = screenLocalRow(album())
    expect(clean.ok && clean.candidate.reviewFlag).toBeNull()
  })

  it('Instagram rows are normalised on the way in', () => {
    const s = screenMuseRow(ig({ theme_slug: 'kpop-demon-hunter-party', activities: 'slime-making|photo-booth' }))
    expect(s.ok && s.candidate.themeSlug).toBe('kpop-party')
    expect(s.ok && s.candidate.activities).toEqual(['slime', 'photo-booth'])
  })
})

describe('A3: an album row names a file, nothing else', () => {
  it('accepts items/001.jpg and a bare file name', () => {
    expect(screenLocalRow(album()).ok).toBe(true)
    expect(screenLocalRow(album({ media_url: 'IMG_1234.JPG' })).ok).toBe(true)
  })

  it('refuses traversal, absolute paths, URLs, odd extensions and blanks', () => {
    for (const bad of ['../etc/passwd', 'items/../../x.jpg', '/etc/passwd', 'C:\\Users\\x.jpg', 'https://evil.example/x.jpg', 'items/001.exe', 'items/a/b/001.jpg', 'items/001.jpg\u0000.png', '', 'items/ 001.jpg', 'items/001']) {
      expect(screenLocalRow(album({ media_url: bad })).ok).toBe(false)
    }
  })

  it('the album share link is never stored: only a one-way key derived from it', () => {
    const s = screenLocalRow(album())
    expect(s.ok).toBe(true)
    if (!s.ok) return
    expect(JSON.stringify(s.candidate)).not.toContain('icloud.com')
    expect(JSON.stringify(s.candidate)).not.toContain('0aBcDeFgHi')
    expect(s.candidate.sourceKey).toMatch(/^icloud:[0-9a-f]{8}:001$/)
    expect(s.candidate.storagePath).toMatch(/^icloud\/[0-9a-f]{8}-001\.webp$/)
    expect('permalink' in s.candidate).toBe(false)
    const other = screenLocalRow(album({ ig_permalink: 'https://share.icloud.com/photos/another' }))
    expect(other.ok && other.candidate.sourceKey).not.toBe(s.candidate.sourceKey) // two albums may both have an items/001.jpg
  })

  it('album video items become video stills, photos stay photos', () => {
    const v = screenLocalRow(album({ media_type: 'video_thumbnail' }))
    expect(v.ok && v.candidate.mediaKind).toBe('video_still')
    const p = screenLocalRow(album())
    expect(p.ok && p.candidate.mediaKind).toBe('photo')
  })
})

describe('A4: planning an album', () => {
  const rows = [
    album({ media_url: 'items/001.jpg', notes: 'Same Stitch party' }),
    album({ media_url: 'items/002.jpg', notes: 'Near-identical duplicate of item 3' }),
    album({ media_url: 'items/003.jpg', notes: 'Near-identical duplicate of item 2' }),
    album({ media_url: 'items/004.jpg', notes: 'Similar to item 1' }),
    album({ media_url: 'items/005.jpg', identifiable_child_face: 'yes' }),
    album({ media_url: 'items/006.jpg', notes: 'flyer' }),
    album({ media_url: 'items/007.jpg', notes: 'Identical to item 9' }),
  ]

  it('keeps the earlier of a duplicate pair, never both dropped, and counts the reasons', () => {
    const p = planLocalImport(rows)
    expect(p.accepted.map(c => c.item)).toEqual(['items/001.jpg', 'items/002.jpg', 'items/004.jpg', 'items/007.jpg'])
    const reasons = Object.fromEntries(p.skipped.map(s => [s.reason, s.count]))
    expect(reasons).toEqual({ 'a child may be identifiable': 1, 'a flyer or promo graphic': 1, 'near-identical to an earlier photo': 1 })
  })

  it('"identical to" a photo that is not imported keeps the row; keepDuplicates keeps both', () => {
    expect(planLocalImport(rows).accepted.map(c => c.item)).toContain('items/007.jpg')
    expect(planLocalImport(rows, { keepDuplicates: true }).accepted.map(c => c.item)).toContain('items/003.jpg')
  })

  it('a row repeated in the file is collapsed', () => {
    const p = planLocalImport([album(), album()])
    expect(p.accepted).toHaveLength(1)
    expect(p.skipped).toEqual([{ reason: 'duplicate row', count: 1 }])
  })

  it('existingSourceKeys asks in chunks and fails whole if any chunk fails', async () => {
    const calls: number[] = []
    const mk = (failAt: number) => ({
      from: () => ({
        select: () => ({
          in: async (_c: string, ks: string[]) => { calls.push(ks.length); return calls.length === failAt ? { data: null, error: { message: 'boom' } } : { data: ks.slice(0, 1).map(k => ({ source_key: k })), error: null } },
        }),
      }),
    }) as never
    const keys = Array.from({ length: 320 }, (_, i) => `icloud:aaaaaaaa:${i}`)
    const ok = await existingSourceKeys(mk(0), keys)
    expect(calls).toEqual([150, 150, 20])
    expect(ok.kind === 'ok' && ok.data.size).toBe(3)
    calls.length = 0
    expect((await existingSourceKeys(mk(2), keys)).kind).toBe('unavailable')
  })
})

/** A recording fake of the parts of supabase-js the importers use. */
function fakeSb(existing: string[] = []) {
  const log: { op: string; payload?: unknown; args?: unknown[] }[] = []
  const uploads: { path: string; bytes: Uint8Array }[] = []
  const from = () => {
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data: existing.map(k => ({ source_key: k })), error: null })
        return (...args: unknown[]) => {
          if (['insert', 'update'].includes(prop)) log.push({ op: prop, payload: args[0] })
          else log.push({ op: prop, args })
          return chain
        }
      },
    })
    return chain
  }
  const storage = { from: () => ({
    upload: async (p: string, bytes: Uint8Array) => { uploads.push({ path: p, bytes }); return { error: null } },
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.example/media/${p}` } }),
  }) }
  return { sb: { from, storage } as never, log, uploads }
}

describe('A5: an album photo is a candidate, and its metadata is gone', () => {
  const okConvert = async () => ({ bytes: new Uint8Array([1, 2, 3]), w: 800, h: 600 })

  it('inserts an UNAPPROVED icloud row under icloud/, with no album link and our own URL', async () => {
    const { sb, log, uploads } = fakeSb([])
    const out = await importLocalPhoto(sb, album(), new Uint8Array([9, 9, 9]), 'admin:a@b.c', okConvert)
    expect(out.kind).toBe('imported')
    expect(uploads).toHaveLength(1)
    expect(uploads[0].path).toMatch(/^icloud\/[0-9a-f]{8}-001\.webp$/)
    const ins = log.find(l => l.op === 'insert')?.payload as Record<string, unknown>
    expect(ins.approved).toBe(false)
    expect(ins.source).toBe('icloud')
    expect(ins.ig_permalink).toBeNull()
    expect(ins.media_kind).toBe('photo')
    expect(String(ins.url)).toMatch(/^https:\/\/cdn\.example\/media\/icloud\//)
    expect(JSON.stringify(ins)).not.toContain('icloud.com')
    expect('approved_by' in ins).toBe(false)
  })

  it('a row that fails screening never reaches the converter or the bucket', async () => {
    const { sb, log, uploads } = fakeSb([])
    let converted = 0
    const conv = async () => { converted++; return null }
    for (const over of [{ identifiable_child_face: 'yes' }, { identifiable_child_face: 'unsure' }, { notes: 'flyer' }, { media_url: '../x.jpg' }]) {
      expect((await importLocalPhoto(sb, album(over), new Uint8Array([1]), 'a', conv)).kind).toBe('skipped')
    }
    expect(converted).toBe(0)
    expect(uploads).toHaveLength(0)
    expect(log.some(l => l.op === 'insert')).toBe(false)
  })

  it('a photo already in the library is only RE-TAGGED: no upload, and approval and the face flag are untouched', async () => {
    const s = screenLocalRow(album())
    if (!s.ok) throw new Error('fixture')
    const { sb, log, uploads } = fakeSb([s.candidate.sourceKey])
    const out = await importLocalPhoto(sb, album(), new Uint8Array([1]), 'a', okConvert)
    expect(out.kind).toBe('retagged')
    expect(uploads).toHaveLength(0)
    const up = log.find(l => l.op === 'update')?.payload as Record<string, unknown>
    for (const k of ['approved', 'approved_by', 'approved_at', 'no_identifiable_faces', 'url']) expect(k in up).toBe(false)
    expect(log.some(l => l.op === 'insert')).toBe(false)
  })

  it('a missing file, an oversize file or an unreadable image is a failure, not an insert', async () => {
    const { sb, log } = fakeSb([])
    expect((await importLocalPhoto(sb, album(), null, 'a', okConvert)).kind).toBe('failed')
    expect((await importLocalPhoto(sb, album(), new Uint8Array(16 * 1024 * 1024), 'a', okConvert)).kind).toBe('failed')
    expect((await importLocalPhoto(sb, album(), new Uint8Array([1]), 'a', async () => null)).kind).toBe('failed')
    expect(log.some(l => l.op === 'insert')).toBe(false)
  })

  describe('EXIF and GPS are stripped (real bytes, real sharp)', () => {
    async function jpegWithGps(): Promise<Buffer> {
      const sharp = (await import('sharp')).default
      return sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 120, b: 90 } } })
        .withMetadata({
          orientation: 6,
          exif: {
            IFD0: { Make: 'TestPhone', Model: 'GPS-Cam', Copyright: 'Client Family Home' },
            IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40 51 0', GPSLongitudeRef: 'W', GPSLongitude: '72 20 0' },
          },
        })
        .jpeg().toBuffer()
    }

    it('the fixture really carries EXIF with GPS (otherwise the test below proves nothing)', async () => {
      const sharp = (await import('sharp')).default
      const meta = await sharp(await jpegWithGps()).metadata()
      expect(meta.exif).toBeDefined()
      const exif = (meta.exif as Buffer).toString('latin1')
      expect(exif).toContain('TestPhone')
      expect(exif).toContain('Client Family Home')
      expect(meta.orientation).toBe(6)
    })

    it('convertImageBuffer returns a WebP with NO EXIF, XMP or ICC chunk, and applies the rotation first', async () => {
      const sharp = (await import('sharp')).default
      const out = await convertImageBuffer(await jpegWithGps())
      expect(out).not.toBeNull()
      if (!out) return
      const chunks = webpChunks(out.bytes)
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks).toEqual(expect.arrayContaining([expect.stringMatching(/^VP8/)]))
      for (const c of METADATA_CHUNKS) expect(chunks).not.toContain(c)
      const meta = await sharp(Buffer.from(out.bytes)).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.exif).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
      expect(meta.icc).toBeUndefined()
      const latin = Buffer.from(out.bytes).toString('latin1')
      for (const needle of ['TestPhone', 'Client Family Home', 'GPS-Cam', 'GPSLatitude']) expect(latin).not.toContain(needle)
      // Orientation 6 = rotate 90°: the 640x480 source is now portrait.
      expect(out.w).toBe(480)
      expect(out.h).toBe(640)
    })

    it('importLocalPhoto uploads exactly those metadata-free bytes', async () => {
      const { sb, uploads } = fakeSb([])
      const out = await importLocalPhoto(sb, album(), new Uint8Array(await jpegWithGps()), 'a')
      expect(out.kind).toBe('imported')
      expect(uploads).toHaveLength(1)
      const chunks = webpChunks(uploads[0].bytes)
      expect(chunks.length).toBeGreaterThan(0)
      for (const c of METADATA_CHUNKS) expect(chunks).not.toContain(c)
      expect(Buffer.from(uploads[0].bytes).toString('latin1')).not.toContain('Client Family Home')
    })

    it('webpChunks refuses to call a non-WebP clean, and sees a metadata chunk when one is present', () => {
      expect(webpChunks(new Uint8Array([1, 2, 3]))).toEqual([])
      const riff = (chunks: [string, number][]) => {
        const parts: number[] = []
        for (const [tag, size] of chunks) parts.push(...Array.from(tag).map(c => c.charCodeAt(0)), size, 0, 0, 0, ...new Array(size + (size % 2)).fill(0))
        const body = [...Array.from('WEBP').map(c => c.charCodeAt(0)), ...parts]
        return new Uint8Array([...Array.from('RIFF').map(c => c.charCodeAt(0)), body.length, 0, 0, 0, ...body])
      }
      expect(webpChunks(riff([['VP8X', 10], ['EXIF', 5], ['VP8 ', 4]]))).toEqual(['VP8X', 'EXIF', 'VP8 '])
    })

    it('an Instagram download goes through the same stripping function', () => {
      const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'media.ts'), 'utf8')
      expect(src).toMatch(/fetchAndConvert[\s\S]{0,400}convertImageBuffer\(/)
      expect(src).not.toMatch(/from\('sharp'\)|import\('sharp'\)/) // sharp is only ever called inside mediaImage.ts
    })
  })
})

describe('A5b: Instagram re-tagging reports unknown tags and records the kind', () => {
  it('writes media_kind and review_flag with the tags, never approval', async () => {
    const { sb, log } = fakeSb(['ig:ReelFake001:1'])
    const r = await importMuseRows(sb, [ig({ ig_permalink: 'https://www.instagram.com/reel/ReelFake001/', media_type: 'video_thumbnail', activities: 'hula-hooping' })], 'a')
    const up = log.find(l => l.op === 'update')?.payload as Record<string, unknown>
    expect(up.media_kind).toBe('reel')
    expect(up.ig_permalink).toBe('https://www.instagram.com/reel/ReelFake001/')
    for (const k of ['approved', 'approved_by', 'approved_at', 'no_identifiable_faces', 'url']) expect(k in up).toBe(false)
    if (r.kind === 'ok') expect(r.data.unknownTags).toEqual(['activity:hula-hooping'])
  })
})

/** A fake whose update chain records filters and returns chosen rows. */
function fakeBulk(returned: string[]) {
  const seen: { op: string; args: unknown[] }[] = []
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'select') return async () => ({ data: returned.map(id => ({ id })), error: null })
      return (...args: unknown[]) => { seen.push({ op: prop, args }); return chain }
    },
  })
  return { sb: { from: () => chain } as never, seen }
}
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('A6: bulk approval', () => {
  it('approving filters on the face check IN THE DATABASE and on not-yet-approved, and stamps the actor', async () => {
    const { sb, seen } = fakeBulk([U(1), U(2)])
    const r = await bulkSetApproval(sb, [U(1), U(2), U(3)], true, 'admin:a@b.c')
    expect(r).toEqual({ ok: true, changed: [U(1), U(2)], unchanged: [U(3)] })
    const upd = seen.find(s => s.op === 'update')?.args[0] as Record<string, unknown>
    expect(upd.approved).toBe(true)
    expect(upd.approved_by).toBe('admin:a@b.c')
    expect(typeof upd.approved_at).toBe('string')
    expect(seen.map(s => JSON.stringify([s.op, s.args[0], s.args[1]]))).toEqual(expect.arrayContaining(['["eq","no_identifiable_faces",true]', '["eq","approved",false]']))
  })

  it('withdrawing clears who approved it and does not need the face check', async () => {
    const { sb, seen } = fakeBulk([U(1)])
    const r = await bulkSetApproval(sb, [U(1)], false, 'admin:a@b.c')
    expect(r).toEqual({ ok: true, changed: [U(1)], unchanged: [] })
    const upd = seen.find(s => s.op === 'update')?.args[0] as Record<string, unknown>
    expect(upd).toMatchObject({ approved: false, approved_by: null, approved_at: null })
    expect(seen.some(s => s.op === 'eq' && s.args[0] === 'no_identifiable_faces')).toBe(false)
  })

  it('refuses nothing-selected, too many, and ids that are not uuids — without touching the database', async () => {
    const { sb, seen } = fakeBulk([])
    expect(await bulkSetApproval(sb, [], true, 'a')).toMatchObject({ ok: false, status: 400 })
    expect(await bulkSetApproval(sb, 'x', true, 'a')).toMatchObject({ ok: false, status: 400 })
    expect(await bulkSetApproval(sb, Array.from({ length: 101 }, (_, i) => U(i)), true, 'a')).toMatchObject({ ok: false, status: 400 })
    expect(await bulkSetApproval(sb, [U(1), "x' or 1=1"], true, 'a')).toMatchObject({ ok: false, status: 400 })
    expect(seen).toEqual([])
  })

  it('a database error is surfaced, never reported as "approved"', async () => {
    const chain: any = new Proxy({}, { get: (_t, p: string) => (p === 'select' ? async () => ({ data: null, error: { message: 'boom' } }) : () => chain) })
    expect(await bulkSetApproval({ from: () => chain } as never, [U(1)], true, 'a')).toMatchObject({ ok: false, status: 500 })
  })

  it('the approve branch of the source carries the face-check filter (a rule on the construct, not a word in the file)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'media.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export async function bulkSetApproval'))
    const approveBranch = fn.slice(fn.indexOf('const base = approve'), fn.indexOf(': sb.from', fn.indexOf('const base = approve')))
    expect(approveBranch).toMatch(/\.eq\('no_identifiable_faces',\s*true\)/)
    expect(approveBranch).toMatch(/approved_by:\s*actor/)
  })

  it('the route sends a bulk PATCH through bulkSetApproval with the signed-in actor and nothing else', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'admin', 'photo-library', 'route.ts'), 'utf8')
    expect(src).toMatch(/bulkSetApproval\(getSupabase\(\),\s*b\.ids,\s*b\.approved,\s*adminActorId\(req\)\)/)
    expect(src).not.toMatch(/media_assets/)
  })
})

describe('A7: the admin list', () => {
  const rowsOf = (n: Partial<Record<string, unknown>>[]) => n.map((x, i) => ({
    id: U(i), source: 'icloud', url: `https://cdn.example/${i}.webp`, alt: '', party_type: null, venue: null, theme_slug: null, activities: [], decor_tags: [],
    description: null, ig_permalink: null, posted_at: null, quality: 3, tag_confidence: 'medium', notes: null, no_identifiable_faces: true, approved: false,
    approved_by: null, sort: 0, media_kind: 'photo', review_flag: null, ...x,
  }))
  function fakeList(data: unknown[]) {
    const seen: { op: string; args: unknown[] }[] = []
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data, error: null })
        return (...args: unknown[]) => { seen.push({ op: prop, args }); return chain }
      },
    })
    return { sb: { from: () => chain } as never, seen }
  }

  it('a filter that is not a plain tag, a known source or a known kind matches NOTHING and never queries', async () => {
    const { sb, seen } = fakeList(rowsOf([{}]))
    for (const f of [{ partyType: "x' or 1=1" }, { theme: 'A B' }, { activity: '%' }, { source: 'tiktok' }, { kind: 'gif' }]) {
      expect(await listForAdmin(sb, { status: 'all', ...f })).toEqual({ kind: 'ok', data: { photos: [], total: 0 } })
    }
    expect(seen).toEqual([])
  })

  it('applies each filter in the query', async () => {
    const { sb, seen } = fakeList([])
    await listForAdmin(sb, { status: 'candidates', source: 'icloud', partyType: 'mobile_party', theme: 'barbie-party', activity: 'slime', kind: 'video_still', flagged: true })
    const ops = seen.map(s => JSON.stringify([s.op, ...s.args]))
    expect(ops).toEqual(expect.arrayContaining([
      '["eq","approved",false]', '["eq","source","icloud"]', '["eq","party_type","mobile_party"]', '["eq","theme_slug","barbie-party"]',
      '["contains","activities",["slime"]]', '["eq","media_kind","video_still"]', '["not","review_flag","is",null]',
    ]))
  })

  it('sorts by Muse confidence high → medium → low (not alphabetically), then by quality, and pages', async () => {
    const data = rowsOf([
      { tag_confidence: 'low', quality: 5 }, { tag_confidence: 'high', quality: 3 }, { tag_confidence: 'medium', quality: 4 },
      { tag_confidence: 'high', quality: 5 }, { tag_confidence: null, quality: 5 },
    ])
    const { sb } = fakeList(data)
    const r = await listForAdmin(sb, { status: 'all', sort: 'confidence' })
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.data.photos.map(p => [p.tag_confidence, p.quality])).toEqual([['high', 5], ['high', 3], ['medium', 4], ['low', 5], [null, 5]])
    expect(r.data.total).toBe(5)
    const page = await listForAdmin(fakeList(data).sb, { status: 'all', sort: 'confidence', offset: 1, limit: 2 })
    if (page.kind !== 'ok') throw new Error('unavailable')
    expect(page.data.photos).toHaveLength(2)
    expect(page.data.total).toBe(5)
  })

  it('facets count the distinct tags and list the ones in no vocabulary', async () => {
    const { sb } = fakeList([
      { source: 'icloud', media_kind: 'photo', party_type: 'mobile_party', theme_slug: 'barbie-party', activities: ['slime', 'hula-hooping'], decor_tags: ['backdrop'], review_flag: 'x' },
      { source: 'instagram', media_kind: 'reel', party_type: null, theme_slug: 'dino-party', activities: ['slime'], decor_tags: [], review_flag: null },
    ])
    const f = await facetsForAdmin(sb, 'all')
    expect(f.kind === 'ok' && f.data).toMatchObject({
      sources: { icloud: 1, instagram: 1 }, kinds: { photo: 1, reel: 1 }, themes: { 'barbie-party': 1, 'dino-party': 1 }, activities: { slime: 2, 'hula-hooping': 1 },
      flagged: 1, unknown: ['activity:hula-hooping', 'theme:dino-party'],
    })
  })
})

describe('A8: the migration and the album route', () => {
  const root = path.join(process.cwd(), '..', '..')
  it('migration 087 allows the icloud source and the three kinds, and backfills reels from the permalink', () => {
    const sql = fs.readFileSync(path.join(root, 'starting_plan', 'migration_087_media_kind.sql'), 'utf8')
    expect(sql).toMatch(/source IN \('instagram', 'gallery', 'admin', 'icloud'\)/)
    expect(sql).toMatch(/media_kind IN \('photo', 'reel', 'video_still'\)/)
    expect(sql).toMatch(/UPDATE public\.media_assets SET media_kind = 'reel' WHERE ig_permalink LIKE 'https:\/\/www\.instagram\.com\/reel\/%'/)
    expect(sql).not.toMatch(/share\.icloud\.com/)
  })

  it('the album route is admin-gated first and only passes the catalogue columns to the importer', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'admin', 'photo-library', 'album', 'route.ts'), 'utf8')
    expect(src.indexOf('isAdminAuthorized(req)')).toBeGreaterThan(-1)
    expect(src.indexOf('isAdminAuthorized(req)')).toBeLessThan(src.indexOf('req.formData()'))
    expect(src.indexOf('isAdminAuthorized(req)')).toBeLessThan(src.indexOf('req.json()'))
    expect(src).toMatch(/for \(const k of ROW_KEYS\)/)
    expect(src).not.toMatch(/media_assets/)
  })
})
