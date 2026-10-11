/**
 * A tiny in-memory PostgREST, for the EVITE RSVP e2e (e2e/evite-rsvp.spec.ts) and NOTHING else.
 *
 * WHY A SEPARATE SERVER AND NOT A FIXTURE ROUTE. The app's database client talks HTTP to SUPABASE_URL, so
 * pointing that variable at this process swaps the whole database for the duration of one test run with no
 * change to production code at all: there is no test-only route, no flag and no branch in the app that could
 * ever be reached in production. The app under test is the real `next start` build.
 *
 * It listens on 127.0.0.1 only, holds data in memory, and implements just the PostgREST subset the RSVP flow
 * uses (eq / neq / in / is / not.is / gte / lte / ilike / cs, order, limit, select projection, single-object
 * Accept, return=representation, count=exact with HEAD, rpc). An unsupported request is a loud 501, so a new
 * query in the app fails the test instead of silently reading nothing.
 *
 * Storage: GET /storage/v1/object/public/evites/<key>/<object> serves one fixture JPEG (the 1085 x 1530 Glow
 * background from public/evites/), so an invitation with a stored render exercises the page's <img> path.
 *
 * Test hooks (never reachable through the app): GET /__state, POST /__reset.
 */

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54399)

/** YYYY-MM-DD in America/New_York, `days` from now. */
function etDate(days) {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const EVITE_ID = '11111111-1111-4111-8111-111111111111'
const BOOKING_ID = '22222222-2222-4222-8222-222222222222'
const SLUG = 'mia-glow-7kq2'
const BOOKING2_ID = '44444444-4444-4444-8444-444444444444'
/** A second booking (HH-E2E-2), identical but for a stored render (image_key + invite_object + og_object), for the <img> path. */
const IMG_SLUG = 'mia-glow-mg47'
const IMG_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const FIXTURE_JPEG = fileURLToPath(new URL('../../public/evites/glow/background.jpg', import.meta.url))

function seed() {
  return {
    evites: [
      {
        id: EVITE_ID,
        booking_id: BOOKING_ID,
        slug: SLUG,
        template_slug: 'glow',
        theme_word: null,
        theme_sub: null,
        host_contact_name: null,
        host_contact_phone: null,
        show_host_contact: true,
        host_note: null,
        gift_note: null,
        rsvp_deadline: null,
        image_key: null,
        invite_object: null,
        og_object: null,
        archived_at: null,
        previous_slugs: [],
        created_at: '2026-10-01T12:00:00Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        booking_id: BOOKING2_ID,
        slug: IMG_SLUG,
        template_slug: 'glow',
        theme_word: null,
        theme_sub: null,
        host_contact_name: null,
        host_contact_phone: null,
        show_host_contact: true,
        host_note: null,
        gift_note: null,
        rsvp_deadline: null,
        image_key: IMG_KEY,
        invite_object: 'invite-v1-ab12.jpg',
        og_object: 'og-v1-ab12.jpg',
        archived_at: null,
        previous_slugs: [],
        created_at: '2026-10-01T12:00:00Z',
      },
    ],
    bookings: [
      {
        id: BOOKING_ID,
        booking_ref: 'HH-E2E-1',
        status: 'deposit_paid',
        party_type: 'in_studio_theme',
        event_type: null,
        party_date: etDate(30),
        party_time: '14:00',
        package_type: 'Glow Party',
        guest_count_approx: 12,
        child_name: 'Mia',
        child_age: 7,
        contact_name: 'Pat Example',
        contact_email: 'pat@example.com',
        party_tags: { location_type: 'host_hampton' },
        quote_snapshot: null,
        created_at: '2026-10-01T12:00:00Z',
      },
      {
        id: BOOKING2_ID,
        booking_ref: 'HH-E2E-2',
        status: 'deposit_paid',
        party_type: 'in_studio_theme',
        event_type: null,
        party_date: etDate(30),
        party_time: '14:00',
        package_type: 'Glow Party',
        guest_count_approx: 12,
        child_name: 'Mia',
        child_age: 7,
        contact_name: 'Pat Example',
        contact_email: 'pat@example.com',
        party_tags: { location_type: 'host_hampton' },
        quote_snapshot: null,
        created_at: '2026-10-01T12:00:00Z',
      },
    ],
    booking_payments: [
      { id: 'p1', booking_id: BOOKING_ID, amount_cents: 25000, payment_type: 'deposit' },
      { id: 'p2', booking_id: BOOKING2_ID, amount_cents: 25000, payment_type: 'deposit' },
    ],
    booking_line_items: [
      { id: 'l1', booking_id: BOOKING_ID, name: 'Glow Party', category: 'theme', pricing_item_id: 'pi-glow' },
      { id: 'l2', booking_id: BOOKING2_ID, name: 'Glow Party', category: 'theme', pricing_item_id: 'pi-glow' },
    ],
    party_themes: [{ id: 't1', name: 'Glow Party', slug: 'glow-party', pricing_item_id: 'pi-glow' }],
    evite_consent_texts: [{ version: 'club-v1', channel: 'email', wording: 'Send me party & craft ideas from Host Hampton', created_at: '2026-10-10T00:00:00Z' }],
    evite_rsvps: [],
    evite_events: [],
    contacts: [],
  }
}

let db = seed()
const log = []

/* ── PostgREST filter parsing ─────────────────────────────────── */

function likeToRegExp(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
}

function parseList(s) {
  return s
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''))
}

function predicate(col, spec) {
  const dot = spec.indexOf('.')
  const op = spec.slice(0, dot)
  const val = spec.slice(dot + 1)
  const get = (r) => r[col]
  const text = (r) => (get(r) === null || get(r) === undefined ? null : String(get(r)))
  switch (op) {
    case 'eq':
      return (r) => text(r) === val
    case 'neq':
      return (r) => text(r) !== val
    case 'in': {
      const vals = parseList(val)
      return (r) => text(r) !== null && vals.includes(text(r))
    }
    case 'is':
      if (val === 'null') return (r) => get(r) === null || get(r) === undefined
      return (r) => String(get(r)) === val
    case 'not': {
      const inner = predicate(col, val)
      return (r) => !inner(r)
    }
    case 'gte':
      return (r) => text(r) !== null && text(r) >= val
    case 'lte':
      return (r) => text(r) !== null && text(r) <= val
    case 'gt':
      return (r) => text(r) !== null && text(r) > val
    case 'lt':
      return (r) => text(r) !== null && text(r) < val
    case 'ilike': {
      const re = likeToRegExp(val)
      return (r) => re.test(text(r) ?? '')
    }
    case 'cs': {
      const want = parseList(val.replace(/^\{|\}$/g, ''))
      return (r) => Array.isArray(get(r)) && want.every((w) => get(r).includes(w))
    }
    default:
      throw new Error(`unsupported filter operator ${op}`)
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function filtersOf(params) {
  const preds = []
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue
    if (k === 'or' || k === 'and') throw new Error('unsupported or()/and() filter')
    preds.push(predicate(k, v))
  }
  return preds
}

function project(row, select) {
  if (!select || select === '*') return { ...row }
  if (select.includes('(')) throw new Error('unsupported embedded select')
  const out = {}
  for (const c of select.split(',').map((x) => x.trim()).filter(Boolean)) out[c] = row[c] === undefined ? null : row[c]
  return out
}

function derived(table, row) {
  if (table === 'evite_rsvps') {
    row.child_count = Array.isArray(row.children) ? row.children.length : 0
  }
  return row
}

function applyOrder(rows, order) {
  if (!order) return rows
  const [col, dir] = order.split('.')
  const mult = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => mult * String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
}

/* ── handler ──────────────────────────────────────────────────── */

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const t = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(t ? JSON.parse(t) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__state') return send(res, 200, db)
  if (url.pathname === '/__reset') {
    db = seed()
    log.length = 0
    return send(res, 200, { ok: true })
  }
  if (url.pathname === '/__health') return send(res, 200, { ok: true })
  if (url.pathname.startsWith('/storage/v1/object/public/evites/')) {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
    return res.end(readFileSync(FIXTURE_JPEG))
  }

  const m = /^\/rest\/v1\/(.+)$/.exec(url.pathname)
  if (!m) return send(res, 404, { message: 'not found' })
  const name = m[1]
  const prefer = String(req.headers.prefer || '')
  const wantsObject = String(req.headers.accept || '').includes('application/vnd.pgrst.object+json')

  try {
    if (name.startsWith('rpc/')) {
      const fn = name.slice(4)
      if (fn === 'evite_reminder_email_recent') return send(res, 200, 0)
      return send(res, 501, { message: `unsupported rpc ${fn}` })
    }

    const table = name
    if (!db[table]) return send(res, 501, { message: `unsupported table ${table}` })
    log.push(`${req.method} ${table}`)
    const preds = filtersOf(url.searchParams)
    const matching = () => db[table].filter((r) => preds.every((p) => p(r)))
    const select = url.searchParams.get('select')

    const respondRows = (rows, status = 200, extra = {}) => {
      if (wantsObject) {
        if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` })
        return send(res, status, project(rows[0], select), extra)
      }
      return send(res, status, rows.map((r) => project(r, select)), extra)
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      let rows = applyOrder(matching(), url.searchParams.get('order'))
      const total = rows.length
      const limit = url.searchParams.get('limit')
      if (limit) rows = rows.slice(0, Number(limit))
      const headers = prefer.includes('count=exact') ? { 'content-range': `0-${Math.max(0, total - 1)}/${total}` } : {}
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json', ...headers })
        return res.end()
      }
      return respondRows(rows, 200, headers)
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const list = Array.isArray(body) ? body : [body]
      const made = []
      for (const raw of list) {
        const row = derived(table, {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(table === 'evite_rsvps' ? { revision: 1 } : {}),
          ...(table === 'contacts' ? { status: 'lead', email_opt_in: false, sms_opt_in: false } : {}),
          ...raw,
        })
        if (table === 'contacts' && row.email && db.contacts.some((c) => c.email === row.email)) {
          return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "contacts_email_key"' })
        }
        db[table].push(row)
        made.push(row)
      }
      if (prefer.includes('return=representation')) return respondRows(made, 201)
      res.writeHead(201)
      return res.end()
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const hit = matching()
      for (const r of hit) {
        Object.assign(r, body, { updated_at: new Date().toISOString() })
        derived(table, r)
      }
      if (prefer.includes('return=representation')) return respondRows(hit, 200)
      res.writeHead(204)
      return res.end()
    }

    return send(res, 501, { message: `unsupported method ${req.method}` })
  } catch (e) {
    return send(res, 501, { message: `mock-supabase: ${e instanceof Error ? e.message : String(e)} (${req.method} ${req.url})` })
  }
}

http
  .createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { message: String(e) }))
  })
  .listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`mock-supabase listening on 127.0.0.1:${PORT}\n`)
  })
