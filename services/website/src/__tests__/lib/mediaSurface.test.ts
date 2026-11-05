/**
 * The photo library (lib/media.ts, migration 083).
 *
 *   M1  Muse's rows are screened: only an explicit "no identifiable child", never a flyer;
 *   M2  findPhotos serves approved AND no-faces only, and a junk filter matches nothing;
 *   M3  no other file reads the table — one reader, one rule;
 *   M4  an import never resets a human's approval and never serves its own candidates;
 *   M5  the admin edit: approval needs the face check, withdrawing the check withdraws approval.
 */
import fs from 'fs'
import path from 'path'
import { findPhotos, importMuseRows, importReelTags, screenLocalRow, screenReelRow, REEL_PLACEHOLDER_URL, parseCsv, patchPhoto, screenMuseRow, screenPatch, shortcodeOf, absoluteMediaUrl, type ImageProcessor } from '@/lib/media'

const SRC = path.join(process.cwd(), 'src')
const decomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => (p ?? '') + m.slice((p ?? '').length).replace(/[^\n\r]/g, ' '))
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.(tsx?)$/.test(e.name) ? [p] : []
  })
}

const HEAD = 'ig_permalink,slide_index,media_url,posted_at,media_type,party_type,venue,theme_slug,activities,decor_tags,description,identifiable_child_face,people_count,quality,confidence,notes'
const CDN = 'https://scontent-iad3-1.cdninstagram.com/v/t51/x.jpg?stp=dst-jpg&_nc_cat=1'
const row = (over: Record<string, string> = {}): Record<string, string> => ({
  ig_permalink: 'https://www.instagram.com/p/DfQfLvBu6oq/', slide_index: '1', media_url: CDN, posted_at: '2026-11-02', media_type: 'image',
  party_type: 'in_studio_theme', venue: 'studio', theme_slug: 'glow-party', activities: '', decor_tags: 'balloon-garland|backdrop',
  description: 'Glow party table with a balloon garland', identifiable_child_face: 'no', people_count: '0', quality: '4', confidence: 'high', notes: '', ...over,
})

describe('M1: screening Muse rows', () => {
  it('parses quoted commas, escaped quotes and CRLF', () => {
    const csv = `${HEAD}\r\nhttps://www.instagram.com/p/AbCdE12345/,1,${CDN},2026-01-01,image,mobile_party,at_home,none,"a|b","x","Table, with ""quotes""",no,0,3,high,"n, o"\r\n`
    const r = parseCsv(csv)
    expect(r).toHaveLength(1)
    expect(r[0].description).toBe('Table, with "quotes"')
    expect(r[0].notes).toBe('n, o')
    expect(r[0].activities).toBe('a|b')
    expect(parseCsv('')).toEqual([])
  })

  it('accepts a clear party photo and normalises its tags', () => {
    const s = screenMuseRow(row({ theme_slug: 'none', venue: 'unsure', activities: 'perfume-making|bracelet-making' }))
    expect(s.ok).toBe(true)
    if (s.ok) {
      expect(s.candidate.sourceKey).toBe('ig:DfQfLvBu6oq:1')
      expect(s.candidate.themeSlug).toBeNull()
      expect(s.candidate.venue).toBeNull()
      expect(s.candidate.activities).toEqual(['perfume-making', 'bracelet-making'])
    }
  })

  it('NEVER takes a row where a child may be identifiable (yes, unsure, blank) — they are not even downloaded', () => {
    for (const v of ['yes', 'unsure', '', 'maybe']) expect(screenMuseRow(row({ identifiable_child_face: v }))).toEqual({ ok: false, reason: 'a child may be identifiable' })
  })

  it('refuses flyers, promo graphics, low quality, non-Instagram URLs and empty content', () => {
    expect(screenMuseRow(row({ notes: 'Promo graphic only' })).ok).toBe(false)
    expect(screenMuseRow(row({ description: 'Colourful flyer announcing a holiday market' })).ok).toBe(false)
    expect(screenMuseRow(row({ quality: '2' })).ok).toBe(false)
    expect(screenMuseRow(row({ media_url: 'https://evil.example/x.jpg' })).ok).toBe(false)
    expect(screenMuseRow(row({ media_url: 'http://scontent.cdninstagram.com/x.jpg' })).ok).toBe(false)
    expect(screenMuseRow(row({ ig_permalink: 'https://www.instagram.com/explore/' })).ok).toBe(false)
    expect(screenMuseRow(row({ party_type: 'not_a_party', theme_slug: 'none', decor_tags: '', activities: '' }))).toEqual({ ok: false, reason: 'no party content visible' })
  })

  it('keeps an empty-room SETUP shot: not a party, but decor customers want to see', () => {
    expect(screenMuseRow(row({ party_type: 'not_a_party', theme_slug: 'custom', decor_tags: 'balloon-garland|backdrop' })).ok).toBe(true)
  })

  it('shortcodeOf handles p, reel and rejects others', () => {
    expect(shortcodeOf('https://www.instagram.com/reel/De8ONlhO2L9/')).toBe('De8ONlhO2L9')
    expect(shortcodeOf('https://example.com/p/abcdef/')).toBeNull()
  })
})

function fakeSb(rows: unknown[] = []) {
  const log: { table: string; op: string; args?: unknown[]; payload?: unknown }[] = []
  const from = (table: string) => {
    const calls: [string, unknown[]][] = []
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data: rows, error: null })
        return (...args: unknown[]) => {
          calls.push([prop, args])
          if (['insert', 'update', 'upsert'].includes(prop)) log.push({ table, op: prop, payload: args[0] })
          if (prop === 'select' || prop === 'eq' || prop === 'in' || prop === 'contains' || prop === 'order' || prop === 'limit') log.push({ table, op: prop, args })
          return chain
        }
      },
    })
    return chain
  }
  const storage = { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.example/media/${p}` } }) }) }
  return { sb: { from, storage } as never, log }
}

describe('M2: findPhotos', () => {
  it('always filters approved = true AND no_identifiable_faces = true', async () => {
    const { sb, log } = fakeSb([{ id: 'a'.repeat(8) + '-0000-0000-0000-' + 'b'.repeat(12), url: '/images/gallery/x.webp', alt: 'x', w: 1, h: 2, party_type: 'in_studio_theme', theme_slug: null, activities: null, ig_permalink: null }])
    const r = await findPhotos(sb, { partyType: 'in_studio_theme', activity: 'slime-making' })
    expect(r.kind).toBe('ok')
    const eqs = log.filter(l => l.op === 'eq').map(l => JSON.stringify(l.args))
    expect(eqs).toEqual(expect.arrayContaining(['["approved",true]', '["no_identifiable_faces",true]', '["party_type","in_studio_theme"]']))
    if (r.kind === 'ok') expect(r.data[0].url).toMatch(/^https:\/\/.+\/images\/gallery\/x\.webp$/)
  })

  it('a filter that is not a plain tag returns nothing and never queries (never "drop the filter")', async () => {
    const { sb, log } = fakeSb([{ id: 'x' }])
    for (const bad of ["x' or 1=1", 'A B', '%', '..', '']) {
      expect(await findPhotos(sb, { partyType: bad })).toEqual({ kind: 'ok', data: [] })
      expect(await findPhotos(sb, { activity: bad })).toEqual({ kind: 'ok', data: [] })
    }
    expect(log).toEqual([])
  })

  it('bounds the page size, and explicit ids that are not uuids match nothing', async () => {
    const { sb, log } = fakeSb([])
    await findPhotos(sb, { limit: 5000 })
    expect(log.find(l => l.op === 'limit')?.args).toEqual([12])
    expect(await findPhotos(sb, { ids: ['nope', '1; drop'] })).toEqual({ kind: 'ok', data: [] })
  })

  it('absoluteMediaUrl leaves our storage URLs alone and anchors relative ones to our origin', () => {
    expect(absoluteMediaUrl('https://x.supabase.co/a.webp')).toBe('https://x.supabase.co/a.webp')
    expect(absoluteMediaUrl('/images/a.webp')).toMatch(/^https:\/\/[^/]+\/images\/a\.webp$/)
  })
})

describe('M3: one reader', () => {
  it('no file but lib/media.ts names the table', () => {
    const offenders = walk(SRC)
      .filter(f => !f.includes(`${path.sep}__tests__${path.sep}`) && !f.endsWith(`${path.sep}lib${path.sep}media.ts`))
      .filter(f => /media_assets/.test(decomment(fs.readFileSync(f, 'utf8'))))
    expect(offenders.map(f => path.relative(SRC, f))).toEqual([])
  })

  it('findPhotos is the only public reader and its source carries both filters, ahead of any caller filter', () => {
    const src = decomment(fs.readFileSync(path.join(SRC, 'lib', 'media.ts'), 'utf8'))
    const fn = src.slice(src.indexOf('export async function findPhotos'), src.indexOf('/* ── Seeding'))
    expect(fn).toMatch(/\.eq\('approved',\s*true\)\.eq\('no_identifiable_faces',\s*true\)/)
    expect(fn.indexOf("eq('approved', true)")).toBeLessThan(fn.indexOf("query = query.eq('party_type'"))
  })
})

describe('M4: importing', () => {
  const proc: ImageProcessor & { urls: string[] } = {
    urls: [],
    async fetchAndConvert(url) { this.urls.push(url); return { bytes: new Uint8Array([1, 2, 3]), w: 800, h: 600 } },
  }

  it('downloads only rows that pass the screen, and inserts them as UNAPPROVED candidates with our own URL', async () => {
    const { sb, log } = fakeSb([])
    proc.urls = []
    const r = await importMuseRows(sb, [
      row(),
      row({ ig_permalink: 'https://www.instagram.com/p/FlyerFlyer1/', notes: 'Promo graphic only' }),
      row({ ig_permalink: 'https://www.instagram.com/p/FaceFaceFa1/', identifiable_child_face: 'yes' }),
    ], 'admin:a@b.c', proc)
    expect(r.kind).toBe('ok')
    expect(proc.urls).toEqual([CDN])
    const ins = log.find(l => l.op === 'insert')?.payload as Record<string, unknown>
    expect(ins.approved).toBe(false)
    expect(ins.source).toBe('instagram')
    expect(String(ins.url)).toMatch(/^https:\/\/cdn\.example\/media\/ig\/DfQfLvBu6oq-1\.webp$/)
    expect(String(ins.url)).not.toMatch(/instagram|fbcdn/)
    if (r.kind === 'ok') {
      expect(r.data.imported).toBe(1)
      expect(r.data.skipped.map(s => s.reason).sort()).toEqual(['a child may be identifiable', 'a flyer or promo graphic'])
    }
  })

  it('a row already in the library is only RE-TAGGED: the update never touches approval or the face flag', async () => {
    const { sb, log } = fakeSb([{ source_key: 'ig:DfQfLvBu6oq:1' }])
    proc.urls = []
    const r = await importMuseRows(sb, [row()], 'admin:a@b.c', proc)
    expect(proc.urls).toEqual([]) // not downloaded again
    const up = log.find(l => l.op === 'update')?.payload as Record<string, unknown>
    expect(up).toBeDefined()
    for (const k of ['approved', 'approved_by', 'approved_at', 'no_identifiable_faces', 'url']) expect(k in up).toBe(false)
    expect(log.some(l => l.op === 'insert')).toBe(false)
    if (r.kind === 'ok') expect(r.data.updated).toBe(1)
  })

  it('an image that cannot be fetched is reported, not inserted', async () => {
    const { sb, log } = fakeSb([])
    const r = await importMuseRows(sb, [row()], 'a', { fetchAndConvert: async () => null })
    expect(log.some(l => l.op === 'insert')).toBe(false)
    if (r.kind === 'ok') expect(r.data.failed[0]).toMatch(/could not be downloaded/)
  })

  it('collapses a duplicate row in one file', async () => {
    const { sb } = fakeSb([])
    proc.urls = []
    await importMuseRows(sb, [row(), row()], 'a', proc)
    expect(proc.urls).toHaveLength(1)
  })
})

describe('M7: reel tags (one row per reel; the reel is watched on Instagram)', () => {
  const reel = (over: Record<string, string> = {}): Record<string, string> => ({
    ig_permalink: 'https://www.instagram.com/reel/DbQkynuOyvb/', slide_index: '1', media_url: '', posted_at: '2026-03-02', media_type: 'video_thumbnail',
    party_type: 'in_studio_theme', venue: 'studio', theme_slug: 'glow-party', activities: 'dance-party', decor_tags: 'glow-lights',
    description: 'Glow party with blue lights', identifiable_child_face: 'no', people_count: '3', quality: '4', confidence: 'high', notes: 'reel of 5 sampled frames', ...over,
  })
  function spySb(existing: string[] = []) {
    const writes: { op: string; payload: Record<string, unknown> }[] = []
    const uploads: string[] = []
    const from = () => {
      const chain: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: (v: unknown) => void) => res({ data: existing.map(k => ({ source_key: k })), error: null })
          return (...args: unknown[]) => {
            if (['insert', 'update'].includes(prop)) writes.push({ op: prop, payload: args[0] as Record<string, unknown> })
            return chain
          }
        },
      })
      return chain
    }
    const storage = { from: () => ({ upload: async (p: string) => { uploads.push(p); return { error: null } }, getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.example/media/${p}` } }) }) }
    return { sb: { from, storage } as never, writes, uploads }
  }
  const conv = async () => ({ bytes: new Uint8Array([1]), w: 640, h: 360 })
  const POSTER = { DbQkynuOyvb: new Uint8Array([7, 7]) }

  it('turns a blank, odd or non-"no" verdict into a state, never into "no"', () => {
    for (const v of ['', 'maybe', 'unsure']) { const s = screenReelRow(reel({ identifiable_child_face: v })); expect(s.ok && s.reel.childVerdict).toBe('unsure') }
    const y = screenReelRow(reel({ identifiable_child_face: 'YES' })); expect(y.ok && y.reel.childVerdict).toBe('yes')
    const n = screenReelRow(reel()); expect(n.ok && n.reel.childVerdict).toBe('no'); expect(n.ok && n.reel.sourceKey).toBe('ig:DbQkynuOyvb:1')
  })

  it('still refuses what a photo is refused for: no permalink, a flyer, low quality, nothing to see', () => {
    expect(screenReelRow(reel({ ig_permalink: 'https://example.com/x' })).ok).toBe(false)
    expect(screenReelRow(reel({ description: 'Colourful flyer announcing a holiday market' })).ok).toBe(false)
    expect(screenReelRow(reel({ quality: '2' })).ok).toBe(false)
    expect(screenReelRow(reel({ party_type: 'not_a_party', theme_slug: 'none', activities: '', decor_tags: '' })).ok).toBe(false)
  })

  it('an existing reel flagged for a child loses its face flag AND its approval in the SAME write', async () => {
    const { sb, writes } = spySb(['ig:DbQkynuOyvb:1'])
    const r = await importReelTags(sb, [reel({ identifiable_child_face: 'yes' })], {}, 'a', conv)
    const w = writes.find(x => x.op === 'update')!.payload
    expect(w.no_identifiable_faces).toBe(false)
    expect(w.approved).toBe(false)
    expect(w.approved_by).toBeNull()
    expect(w.media_kind).toBe('reel')
    expect(String(w.review_flag)).toMatch(/child/)
    if (r.kind === 'ok') { expect(r.data.updated).toBe(1); expect(r.data.withdrawn).toEqual(['ig:DbQkynuOyvb:1']) }
  })

  it('an existing all-"no" reel is only RE-TAGGED: approval, face flag and url are never touched', async () => {
    const { sb, writes } = spySb(['ig:DbQkynuOyvb:1'])
    await importReelTags(sb, [reel()], POSTER, 'a', conv)
    const w = writes.find(x => x.op === 'update')!.payload
    for (const k of ['approved', 'approved_by', 'approved_at', 'no_identifiable_faces', 'url', 'source']) expect(k in w).toBe(false)
    expect(writes.some(x => x.op === 'insert')).toBe(false)
  })

  it('a NEW all-"no" reel takes its poster, as an unapproved candidate that Muse called face-free', async () => {
    const { sb, writes, uploads } = spySb([])
    const r = await importReelTags(sb, [reel()], POSTER, 'a', conv)
    const ins = writes.find(x => x.op === 'insert')!.payload
    expect(uploads).toEqual(['ig/DbQkynuOyvb-1.webp'])
    expect(ins.approved).toBe(false)
    expect(ins.no_identifiable_faces).toBe(true)
    expect(ins.source).toBe('instagram')
    expect(ins.media_kind).toBe('reel')
    expect(String(ins.url)).toBe('https://cdn.example/media/ig/DbQkynuOyvb-1.webp')
    if (r.kind === 'ok') expect(r.data.placeholders).toBe(0)
  })

  it('a NEW reel flagged for a child is added WITHOUT any picture: no child face is ever stored', async () => {
    for (const verdict of ['yes', 'unsure']) {
      const { sb, writes, uploads } = spySb([])
      const r = await importReelTags(sb, [reel({ identifiable_child_face: verdict })], POSTER, 'a', conv)
      const ins = writes.find(x => x.op === 'insert')!.payload
      expect(uploads).toEqual([])
      expect(ins.url).toBe(REEL_PLACEHOLDER_URL)
      expect(ins.no_identifiable_faces).toBe(false)
      expect(ins.approved).toBe(false)
      if (r.kind === 'ok') expect(r.data.placeholders).toBe(1)
    }
  })

  it('a NEW all-"no" reel with no poster gets the placeholder, and a bad poster is reported, not inserted', async () => {
    const a = spySb([])
    await importReelTags(a.sb, [reel()], {}, 'a', conv)
    expect(a.writes.find(x => x.op === 'insert')!.payload.url).toBe(REEL_PLACEHOLDER_URL)
    const b = spySb([])
    const r = await importReelTags(b.sb, [reel()], POSTER, 'a', async () => null)
    expect(b.writes.some(x => x.op === 'insert')).toBe(false)
    if (r.kind === 'ok') expect(r.data.failed[0]).toMatch(/poster could not be read/)
  })

  it('a row exported by photo-pipeline/pipeline.py is accepted by the phone-album screen (one importer for both)', () => {
    const row = {
      ig_permalink: 'studio-library-pilot', slide_index: '1', media_url: 'items/local-5b0958254bbe.webp', posted_at: '2024-12-07', media_type: 'image',
      party_type: 'in_studio_theme', venue: 'studio', theme_slug: 'toddler-party', activities: 'soft-play', decor_tags: '',
      description: 'White and grey soft-play pen with a ball pit', identifiable_child_face: 'no', people_count: '0', quality: '4', confidence: 'high', notes: '',
    }
    const s = screenLocalRow(row)
    expect(s.ok).toBe(true)
    if (s.ok) { expect(s.candidate.mediaKind).toBe('photo'); expect(s.candidate.storagePath).toMatch(/^icloud\/[0-9a-f]{8}-local-5b0958254bbe\.webp$/) }
    expect(screenLocalRow({ ...row, identifiable_child_face: 'unsure' }).ok).toBe(false)
  })

  it('a dry run reports the plan and writes and uploads NOTHING', async () => {
    const { sb, writes, uploads } = spySb(['ig:DbQkynuOyvb:1'])
    const r = await importReelTags(sb, [reel({ identifiable_child_face: 'yes' }), reel({ ig_permalink: 'https://www.instagram.com/reel/NewReel12345/' })], { NewReel12345: new Uint8Array([1]) }, 'a', conv, { dryRun: true })
    expect(writes).toEqual([])
    expect(uploads).toEqual([])
    if (r.kind === 'ok') expect(r.data).toMatchObject({ updated: 1, imported: 1, placeholders: 0, withdrawn: ['ig:DbQkynuOyvb:1'] })
  })

  it('the reel importer can never approve: no approved: true in its source, and the placeholder file exists', () => {
    const src = decomment(fs.readFileSync(path.join(SRC, 'lib', 'media.ts'), 'utf8'))
    const fn = src.slice(src.indexOf('export async function importReelTags'), src.indexOf('export type LocalImportOutcome'))
    expect(fn.length).toBeGreaterThan(800)
    expect(fn.length).toBeLessThan(6000)
    expect(fn).toMatch(/approved:\s*false/)
    expect(fn).not.toMatch(/approved:\s*true/)
    expect(fs.existsSync(path.join(process.cwd(), 'public', 'images', 'reel-placeholder.svg'))).toBe(true)
  })
})

describe('M5: the admin edit', () => {
  it('approval is allowed on its own; clearing the face check withdraws approval in the same write', () => {
    expect(screenPatch({ approved: true })).toEqual({ ok: true, patch: { approved: true } })
    expect(screenPatch({ no_identifiable_faces: false })).toEqual({ ok: true, patch: { no_identifiable_faces: false, approved: false } })
    expect(screenPatch({ no_identifiable_faces: false, approved: true })).toEqual({ ok: true, patch: { no_identifiable_faces: false, approved: false } })
  })

  it('refuses malformed fields and an empty edit', () => {
    for (const b of [{}, { approved: 'yes' }, { alt: 5 }, { theme_slug: 'Has Space' }, { activities: ['OK', 'x'] }, { activities: 'a' }, { sort: 1.5 }, { sort: 99999 }]) {
      expect(screenPatch(b as never).ok).toBe(false)
    }
    expect(screenPatch({ theme_slug: null })).toEqual({ ok: true, patch: { theme_slug: null } })
  })

  it('patchPhoto stamps who approved, clears it on withdrawal, and maps the CHECK violation to a 409', async () => {
    const writes: Record<string, unknown>[] = []
    const mk = (error: unknown, data: unknown[]) => ({ from: () => ({ update: (row: Record<string, unknown>) => { writes.push(row); return { eq: () => ({ select: async () => ({ data, error }) }) } } }) }) as never
    const id = '11111111-1111-4111-8111-111111111111'
    expect(await patchPhoto(mk(null, [{ id }]), id, { approved: true }, 'admin:a@b.c')).toEqual({ ok: true })
    expect(writes[0].approved_by).toBe('admin:a@b.c')
    await patchPhoto(mk(null, [{ id }]), id, { approved: false }, 'admin:a@b.c')
    expect(writes[1].approved_by).toBeNull()
    expect(await patchPhoto(mk({ code: '23514', message: 'x' }, []), id, { approved: true }, 'a')).toMatchObject({ ok: false, status: 409 })
    expect(await patchPhoto(mk(null, []), id, { approved: true }, 'a')).toMatchObject({ ok: false, status: 404 })
    expect(await patchPhoto(mk(null, [{ id }]), 'not-a-uuid', { approved: true }, 'a')).toMatchObject({ ok: false, status: 404 })
  })
})
