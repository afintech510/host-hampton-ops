import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { NOW } from '../helpers/eviteFixtures'
import { OTHER_EVITE_ID, EVITE_ID, PORTAL_SECRET, REF, makeHostDb, portalCookie } from '../helpers/hostInvitationFixtures'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

/** The host's extra pictures: `/api/portal/invitation/images`. Portal-gated; page-only (no render). */

let db: ReturnType<typeof makeHostDb>
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))
const mockRender = jest.fn()
jest.mock('@/lib/evites/render', () => ({ queueRender: (...a: unknown[]) => mockRender(...a) }))

import { GET, POST, DELETE } from '@/app/api/portal/invitation/images/route'

const KEY = 'b'.repeat(32)
const OBJ_A = 'extra-aaaaaaaaaaaaaaaa.jpg'
const OBJ_B = 'extra-bbbbbbbbbbbbbbbb.jpg'
const OBJ_OTHER = 'extra-cccccccccccccccc.jpg'
const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const API = '/api/portal/invitation/images'

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  process.env.PORTAL_LINK_SIGNING_SECRET = PORTAL_SECRET
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  __resetRateLimitForTests()
  mockRender.mockClear()
  db = makeHostDb({ evite: { image_key: KEY, extra_images: [{ object: OBJ_A, alt: 'Raffle' }] } })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const headers = (cookie?: string | null, ip = '203.0.113.9') => {
  const h: Record<string, string> = { 'cf-connecting-ip': ip, 'user-agent': 'UA/1.0' }
  const c = cookie === undefined ? portalCookie() : cookie
  if (c) h.cookie = c
  return h
}
const getReq = (cookie?: string | null) => new NextRequest(`http://localhost:3002${API}`, { method: 'GET', headers: headers(cookie) })
const delReq = (body: unknown, cookie?: string | null) =>
  new NextRequest(`http://localhost:3002${API}`, { method: 'DELETE', headers: { ...headers(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
const postReq = (form: FormData, cookie?: string | null, ip?: string) =>
  new NextRequest(`http://localhost:3002${API}`, { method: 'POST', headers: headers(cookie, ip), body: form })
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function png(w = 800, h = 600): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#cc3366' } }).png().toBuffer()
}
async function formWith(bytes: Buffer, alt?: string, name = 'secret-family-photo.png'): Promise<FormData> {
  const f = new FormData()
  f.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name)
  if (alt !== undefined) f.append('alt', alt)
  return f
}
const eviteRow = () => db.tables.evites.find((r) => r.id === EVITE_ID) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('401 / 404', () => {
  const calls: Array<[string, (c: string | null) => Promise<Response>]> = [
    ['GET', async (c) => GET(getReq(c))],
    ['POST', async (c) => POST(postReq(await formWith(await png()), c))],
    ['DELETE', async (c) => DELETE(delReq({ object: OBJ_A }, c))],
  ]
  it.each(calls)('%s: 401 with no or a forged cookie, nothing read, written or uploaded', async (_n, run) => {
    for (const cookie of [null, `hh_portal=${REF}:${NOW.getTime()}:${'0'.repeat(64)}`, portalCookie(REF, 'other-secret')]) {
      expect((await run(cookie)).status).toBe(401)
    }
    expect(db.selects).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(db.uploads).toHaveLength(0)
  })
  it.each(calls)('%s: 404 no-invitation when the booking has none', async (_n, run) => {
    process.env.EVITES_PAGES = 'off'
    const res = await run(portalCookie())
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: 'no-invitation' })
    expect(db.uploads).toHaveLength(0)
  })
})

describe('GET', () => {
  it('lists this evite only, with public URLs, no-store, and never the evite id', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await json(res)
    expect(body.images).toEqual([{ object: OBJ_A, alt: 'Raffle', url: `https://proj.supabase.co/storage/v1/object/public/evites/${KEY}/${OBJ_A}` }])
    expect(JSON.stringify(body)).not.toContain(EVITE_ID)
  })
})

describe('POST', () => {
  it('stores a resized JPEG in the evite folder, appends the entry, does not re-render, never logs names', async () => {
    const res = await POST(postReq(await formWith(await png(2400, 1200), '  Bring a book  ')))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await json(res)
    expect(body.images).toHaveLength(2)
    expect(body.images[1].alt).toBe('Bring a book')
    expect(db.uploads).toHaveLength(1)
    const up = db.uploads[0]
    expect(up.path).toMatch(new RegExp(`^${KEY}/extra-[0-9a-f]{16}\\.jpg$`))
    expect(up.path).not.toContain('secret')
    expect((await sharp(db.uploaded.get(`evites/${up.path}`) as Buffer).metadata()).width).toBe(1200)
    expect(eviteRow().extra_images).toHaveLength(2)
    expect(eviteRow().extra_images[1].object).toBe(up.path.split('/')[1])
    expect(mockRender).not.toHaveBeenCalled()
    const logged = JSON.stringify([...(console.error as jest.Mock).mock.calls, ...(console.log as jest.Mock).mock.calls])
    expect(logged).not.toContain('secret-family-photo')
  })

  it('409 at four pictures', async () => {
    db.tables.evites.find((r) => r.id === EVITE_ID)!.extra_images = ['1', '2', '3', '4'].map((n) => ({ object: `extra-${n.repeat(16)}.jpg`, alt: '' }))
    const res = await POST(postReq(await formWith(await png())))
    expect(res.status).toBe(409)
    expect(db.uploads).toHaveLength(0)
  })

  it('409 before the invitation has rendered once (no image_key)', async () => {
    db.tables.evites.find((r) => r.id === EVITE_ID)!.image_key = null
    const res = await POST(postReq(await formWith(await png())))
    expect(res.status).toBe(409)
    expect((await json(res)).error).toMatch(/still being made/)
    expect(db.uploads).toHaveLength(0)
  })

  it('409 once the party has happened', async () => {
    jest.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    const res = await POST(postReq(await formWith(await png())))
    expect(res.status).toBe(409)
    expect(db.uploads).toHaveLength(0)
  })

  it('refuses a non-image by magic bytes whatever the name or declared type says (415)', async () => {
    for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('GIF89a....'), Buffer.from('MZ\u0090\u0000')]) {
      const f = new FormData()
      f.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'photo.jpg')
      expect((await POST(postReq(f))).status).toBe(415)
    }
    expect(db.uploads).toHaveLength(0)
  })

  it('422 for bytes that look like an image but cannot be read', async () => {
    const f = new FormData()
    f.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])]), 'x.jpg')
    expect((await POST(postReq(f))).status).toBe(422)
    expect(db.uploads).toHaveLength(0)
  })

  it('413 over 10 MB and 400 with no file', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)])
    expect((await POST(postReq(await formWith(big)))).status).toBe(413)
    expect((await POST(postReq(new FormData()))).status).toBe(400)
    const text = new FormData()
    text.append('image', 'not a file')
    expect((await POST(postReq(text))).status).toBe(400)
    expect(db.uploads).toHaveLength(0)
  })

  it('a failed save removes the orphan object', async () => {
    db.errors.push({ table: 'evites', op: 'update', message: 'boom' })
    const res = await POST(postReq(await formWith(await png())))
    expect(res.status).toBe(503)
    expect(db.removals).toHaveLength(1)
    expect(eviteRow().extra_images).toHaveLength(1)
  })

  it('writes only the cookie\'s own evite', async () => {
    await POST(postReq(await formWith(await png())))
    expect(db.updates.every((u) => u.filters.some((f) => f.col === 'id' && f.val === EVITE_ID))).toBe(true)
    expect(db.updates.some((u) => u.filters.some((f) => f.val === OTHER_EVITE_ID))).toBe(false)
  })

  it('is rate limited per caller', async () => {
    let limited = 0
    for (let i = 0; i < 80; i++) if ((await POST(postReq(new FormData(), undefined, '198.51.100.7'))).status === 429) limited++
    expect(limited).toBeGreaterThan(0)
  })
})

describe('DELETE', () => {
  it('removes the entry and its Storage object', async () => {
    const res = await DELETE(delReq({ object: OBJ_A }))
    expect(res.status).toBe(200)
    expect((await json(res)).images).toEqual([])
    expect(eviteRow().extra_images).toEqual([])
    expect(db.removals).toEqual([`evites/${KEY}/${OBJ_A}`])
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('only entries of THIS evite: an object that is not in its list is a 404 and nothing is removed', async () => {
    db.tables.evites.find((r) => r.id === OTHER_EVITE_ID)!.extra_images = [{ object: OBJ_OTHER, alt: '' }]
    const res = await DELETE(delReq({ object: OBJ_OTHER }))
    expect(res.status).toBe(404)
    expect(db.removals).toHaveLength(0)
    expect(db.tables.evites.find((r) => r.id === OTHER_EVITE_ID)!.extra_images).toHaveLength(1)
    expect((await DELETE(delReq({ object: OBJ_B }))).status).toBe(404)
  })

  it('refuses a malformed or traversing object name (400) and a missing body', async () => {
    for (const object of ['../' + OBJ_A, `${KEY}/${OBJ_A}`, 'invite-v1-abcd.jpg', '', 5, null]) {
      expect((await DELETE(delReq({ object }))).status).toBe(400)
    }
    expect((await DELETE(delReq(null))).status).toBe(400)
    expect(db.removals).toHaveLength(0)
    expect(eviteRow().extra_images).toHaveLength(1)
  })
})
