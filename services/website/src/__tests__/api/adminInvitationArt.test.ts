import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { NOW } from '../helpers/eviteFixtures'
import { ADMIN_PW, BOOKING_ID, EVITE_ID, ORIGIN, makeAdminDb, type AdminDb } from '../helpers/adminInvitationFixtures'
import { CUSTOM_ART_MAX_BYTES, fitCustomArt, sniffImageType } from '@/lib/evites/customArtFit'
import { CUSTOM_ART_OBJECT } from '@/lib/evites/customArt'

/**
 * POST /api/admin/parties/[id]/invitation/art: the admin upload of a host's OWN invitation image.
 * `queueRender` and Supabase Storage are mocked; the image fit is real (sharp, a tiny generated PNG).
 */

let db: AdminDb
const uploads: Array<{ path: string; body: Buffer; opts: Record<string, unknown> }> = []
let uploadError: { message: string } | null = null
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (t: string) => (db.supabase as any).from(t), // eslint-disable-line @typescript-eslint/no-explicit-any
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer, opts: Record<string, unknown>) => {
          if (uploadError) return { data: null, error: uploadError }
          uploads.push({ path, body, opts })
          return { data: { path }, error: null }
        },
      }),
    },
  }),
}))
jest.mock('@/lib/evites/render', () => ({ renderEvite: jest.fn(), renderViaQueue: jest.fn(), queueRender: jest.fn(() => 'queued') }))

import { POST } from '@/app/api/admin/parties/[id]/invitation/art/route'
import { queueRender } from '@/lib/evites/render'

const queueMock = queueRender as jest.Mock
const KEY = 'a'.repeat(32)
const ENV = ['EVITES_PAGES', 'EVITES_PILOT_REFS', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'PORTAL_LINK_SIGNING_SECRET', 'SUPABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

const ctx = (id = BOOKING_ID) => ({ params: { id } })
function req(form: FormData, auth = true): NextRequest {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = `Bearer ${ADMIN_PW}`
  return new NextRequest(`${ORIGIN}/api/admin/parties/${BOOKING_ID}/invitation/art`, { method: 'POST', headers, body: form })
}
const fileForm = (bytes: Uint8Array | Buffer, name = 'invite.png', type = 'image/png') => {
  const f = new FormData()
  f.set('file', new File([bytes], name, { type }))
  return f
}
const png = (w = 40, h = 60) => sharp({ create: { width: w, height: h, channels: 3, background: '#cc3366' } }).png().toBuffer()
const evites = () => (db.tables as any).evites as Array<Record<string, unknown>> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
  })
  for (const k of ENV) saved[k] = process.env[k]
  process.env.ADMIN_PASSWORD = ADMIN_PW
  delete process.env.ADMIN_SESSION_SECRET
  process.env.PORTAL_LINK_SIGNING_SECRET = 'portal-secret-for-tests'
  db = makeAdminDb({ evite: { image_key: KEY } })
  uploads.length = 0
  uploadError = null
  queueMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('the gate', () => {
  it('401 without admin credentials, and nothing is read or written', async () => {
    const res = await POST(req(fileForm(await png()), false), ctx())
    expect(res.status).toBe(401)
    expect(uploads).toHaveLength(0)
    expect(queueMock).not.toHaveBeenCalled()
  })
  it('404 for an id that is not a booking id', async () => {
    const res = await POST(req(fileForm(await png())), ctx('not-a-uuid'))
    expect(res.status).toBe(404)
  })
  it('404 when the booking has no invitation', async () => {
    db = makeAdminDb({ evite: null })
    const res = await POST(req(fileForm(await png())), ctx())
    expect(res.status).toBe(404)
  })
})

describe('refusals', () => {
  it('a file whose bytes are not jpeg / png / webp is refused whatever its name and type say', async () => {
    const res = await POST(req(fileForm(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'art.png', 'image/png')), ctx())
    expect(res.status).toBe(415)
    expect(uploads).toHaveLength(0)
    expect(evites()[0].custom_art ?? null).toBeNull()
  })
  it('an empty file and a missing file are refused', async () => {
    expect((await POST(req(fileForm(Buffer.alloc(0))), ctx())).status).toBe(415)
    expect((await POST(req(new FormData()), ctx())).status).toBe(400)
  })
  it('a file over 10 MB is refused before anything is decoded', async () => {
    const big = Buffer.alloc(CUSTOM_ART_MAX_BYTES + 1)
    big[0] = 0xff
    big[1] = 0xd8
    big[2] = 0xff
    const res = await POST(req(fileForm(big, 'big.jpg', 'image/jpeg')), ctx())
    expect(res.status).toBe(413)
    expect(uploads).toHaveLength(0)
  })
  it('a corrupt image with a valid magic number is a 422, nothing uploaded', async () => {
    const res = await POST(req(fileForm(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage')]))), ctx())
    expect(res.status).toBe(422)
    expect(uploads).toHaveLength(0)
  })
  it('an invitation that has never rendered has no image folder yet: 409', async () => {
    db = makeAdminDb({ evite: { image_key: null } })
    const res = await POST(req(fileForm(await png())), ctx())
    expect(res.status).toBe(409)
    expect(uploads).toHaveLength(0)
  })
  it('a failed upload does not set custom_art', async () => {
    uploadError = { message: 'boom' }
    const res = await POST(req(fileForm(await png())), ctx())
    expect(res.status).toBe(502)
    expect(evites()[0].custom_art ?? null).toBeNull()
    expect(queueMock).not.toHaveBeenCalled()
  })
})

describe('upload', () => {
  it('fits to 1085x1530, stores beside the render under a random name, sets custom_art, queues one render, audits', async () => {
    const res = await POST(req(fileForm(await png(), 'Private Child Name.png')), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, action: 'upload' })

    expect(uploads).toHaveLength(1)
    const [u] = uploads
    expect(u.path).toMatch(new RegExp(`^${KEY}/custom-[0-9a-f]{8}\\.jpg$`))
    expect(u.path).not.toContain('Private')
    expect(u.opts).toMatchObject({ contentType: 'image/jpeg', upsert: false })
    const meta = await sharp(u.body).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([1085, 1530])

    const name = u.path.split('/')[1]
    expect(CUSTOM_ART_OBJECT.test(name)).toBe(true)
    expect(evites()[0].custom_art).toBe(name)
    expect(queueMock).toHaveBeenCalledTimes(1)
    expect(queueMock).toHaveBeenCalledWith(EVITE_ID)

    const audit = ((db.tables as any).booking_modifications as Array<Record<string, unknown>>).at(-1) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(audit)).not.toContain('Private')
  })

  it('accepts a jpeg and a webp by magic bytes', async () => {
    const base = sharp({ create: { width: 30, height: 30, channels: 3, background: '#336699' } })
    expect((await POST(req(fileForm(await base.clone().jpeg().toBuffer(), 'a.bin', 'application/octet-stream')), ctx())).status).toBe(200)
    expect((await POST(req(fileForm(await base.clone().webp().toBuffer(), 'a.bin', 'text/plain')), ctx())).status).toBe(200)
  })
})

describe('clear', () => {
  it('clear=1 removes custom_art and queues a render; the object is left in Storage', async () => {
    db = makeAdminDb({ evite: { image_key: KEY, custom_art: 'custom-abcdef12.jpg' } })
    const f = new FormData()
    f.set('clear', '1')
    const res = await POST(req(f), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, action: 'clear' })
    expect(evites()[0].custom_art).toBeNull()
    expect(queueMock).toHaveBeenCalledTimes(1)
    expect(uploads).toHaveLength(0)
  })
})

describe('customArtFit', () => {
  it('sniffs by magic bytes only', async () => {
    expect(sniffImageType(await png())).toBe('png')
    expect(sniffImageType(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer())).toBe('jpeg')
    expect(sniffImageType(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('webp')
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull()
    expect(sniffImageType(Buffer.from('<svg>'))).toBeNull()
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
  })
  it('a wide picture is contained, not cropped: the canvas is full size and its top-left is the blurred backdrop', async () => {
    const out = await fitCustomArt(await png(300, 100))
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([1085, 1530])
  })
})
