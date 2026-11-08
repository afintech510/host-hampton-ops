/**
 * The website Host Assistant, held as one surface (lib/chat/*, /api/chat/*, ChatWidget).
 *
 *   C1  /api/chat refuses in this order: availability, rate limit, Origin, then (new session) the
 *       stricter bucket, Turnstile, the session row, and only then the turn;
 *   C2  a turn spends nothing until the caps, the price and the budgets have all said yes;
 *   C3  the bubble never appears where it must not (admin, crew, plan, payment, token links);
 *   C4  nothing in the chat can write a booking except the signed card replayed by confirm.ts;
 *   C5  it ships OFF, and stays off in production without Turnstile;
 *   C6  there is no booking lookup by email or phone anywhere in the chat.
 *
 * Comments are blanked (offsets kept) before any rule reads source, and every rule counts what it examined.
 */
import fs from 'fs'
import path from 'path'
import { chatHiddenOn } from '@/lib/chat/chrome'
import { chatAvailability, chatEnabled } from '@/lib/chat/config'

const SRC = path.join(process.cwd(), 'src')
const REPO = path.join(process.cwd(), '..', '..')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}
const CHAT_FILES = [...walk(path.join(SRC, 'lib', 'chat')), ...walk(path.join(SRC, 'app', 'api', 'chat')), path.join(SRC, 'components', 'ChatWidget.tsx')]
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

/** Positions of each needle in order; fails loudly if one is missing or they are out of order. */
function inOrder(src: string, needles: (string | RegExp)[]): number[] {
  const at = needles.map(n => (typeof n === 'string' ? src.indexOf(n) : src.search(n)))
  needles.forEach((n, i) => expect({ needle: String(n), found: at[i] > -1 }).toEqual({ needle: String(n), found: true }))
  for (let i = 1; i < at.length; i++) expect({ before: String(needles[i - 1]), after: String(needles[i]), ok: at[i - 1] < at[i] }).toEqual({ before: String(needles[i - 1]), after: String(needles[i]), ok: true })
  return at
}

describe('C0: the walker sees the surface', () => {
  it('finds the chat files, not a remembered list', () => {
    const names = CHAT_FILES.map(rel)
    expect(names).toEqual(expect.arrayContaining([
      'lib/chat/run.ts', 'lib/chat/tools.ts', 'lib/chat/confirm.ts', 'lib/chat/card.ts', 'app/api/chat/route.ts', 'app/api/chat/confirm/route.ts', 'components/ChatWidget.tsx',
    ]))
    expect(names.length).toBeGreaterThanOrEqual(14)
  })
})

describe('C1: /api/chat refuses before it spends', () => {
  const route = read('app/api/chat/route.ts')
  const post = route.slice(route.indexOf('export async function POST'))

  it('availability, rate limit, Origin, the body, THEN the session work', () => {
    inOrder(post, ['chatAvailability()', 'guardRate(req, chatRule())', 'originAllowed(req)', 'req.json()', 'cleanVisitorText(', 'loadSession(', 'runChatTurn('])
  })

  it('a NEW session pays the stricter bucket, then Turnstile, then gets a row, then the model', () => {
    inOrder(post, ['guardRate(req, chatStartRule())', 'verifyTurnstile(', "challenge === 'failed'", 'createSession(', 'runChatTurn('])
  })

  it('the browser sends a message and a token — history, roles and tool results come from the server', () => {
    expect(post).not.toMatch(/body\.(messages|history|role|tools?|toolResults?|price|total)/)
    expect(post).toMatch(/loadSession\(supabase, id\)/)
  })

  it('confirm also needs availability and Origin before it reads anything', () => {
    const c = read('app/api/chat/confirm/route.ts')
    inOrder(c.slice(c.indexOf('export async function POST')), ['chatAvailability()', 'originAllowed(req)', 'confirmBooking('])
  })
})

describe('C2: a turn spends nothing until it is allowed to', () => {
  const run = read('lib/chat/run.ts')
  const body = run.slice(run.indexOf('export async function runChatTurn'))

  it('turn cap → priced model → daily USD cap → monthly budget → the model → the reply screen', () => {
    inOrder(body, ['MAX_TURNS_PER_SESSION', 'assertModelPriced(', 'spentTodayUsd(', 'dailyUsdCap(', 'assertLlmBudget(', 'runToolLoop(', 'screenReply('])
  })

  it('an unreadable ledger is a handoff, not "nothing spent today"', () => {
    const fn = run.slice(run.indexOf('export async function spentTodayUsd'), run.indexOf('export async function spentTodayUsd') + 1500)
    expect(fn).toMatch(/return null/)
    expect(body).toMatch(/spent === null|spent == null/)
  })

  it('every model call is recorded as it happens (a turn that dies still billed what it spent)', () => {
    expect(body.indexOf('onCall')).toBeGreaterThan(-1)
    expect(body).toMatch(/recordLlmSpend\(/)
  })
})

describe('C3: where the bubble never appears', () => {
  it('hidden on admin, crew, plan, payment, planner and token-link paths — and where there is no path', () => {
    for (const p of ['/admin', '/admin/assistant', '/crew', '/crew/login', '/plan/HH-PTY-AB12C/summary', '/my-booking', '/checkout/x', '/party-builder', '/party-planner', '/studio-rental',
      '/checkin/abc', '/review/abc', '/unsubscribe', '/troop2514', '/s/abc', '/r/abc', null, undefined, '']) {
      expect({ p, hidden: chatHiddenOn(p as string | null) }).toEqual({ p, hidden: true })
    }
  })

  it('shown on the marketing pages', () => {
    for (const p of ['/', '/gallery', '/book', '/birthday-parties', '/events', '/faq']) expect({ p, hidden: chatHiddenOn(p) }).toEqual({ p, hidden: false })
  })

  it('the widget asks chatHiddenOn, and the root layout mounts it once', () => {
    expect(read('components/ChatWidget.tsx')).toMatch(/chatHiddenOn\(/)
    const layout = read('app/layout.tsx')
    expect((layout.match(/<ChatWidget\b/g) ?? []).length).toBe(1)
  })
})

describe('C4: only the signed card can write a booking', () => {
  const tools = read('lib/chat/tools.ts')

  it('the model can name exactly these tools, and only two can write anything', () => {
    const names = Array.from(tools.matchAll(/name:\s*'([a-z_]+)'/g)).map(m => m[1])
    expect(names.sort()).toEqual(['check_availability', 'check_date_availability', 'find_photos', 'get_booking_link', 'get_business_overview', 'get_party_menu', 'get_quote', 'get_reviews', 'list_party_themes', 'list_upcoming_events', 'propose_booking', 'start_inquiry'])
  })

  it('no tool saves a plan: the planner save route is imported by confirm.ts alone', () => {
    const importers = CHAT_FILES.filter(f => /party-builder\/save\/route/.test(decomment(fs.readFileSync(f, 'utf8')))).map(rel)
    expect(importers).toEqual(['lib/chat/confirm.ts'])
    expect(tools).not.toMatch(/savePlan\(|mintPortalLink\(/)
  })

  it('propose_booking only mints a card; start_inquiry is the one other write and goes through /api/lead', () => {
    expect(tools).toMatch(/mintCard\(/)
    expect(tools).toMatch(/leadRoute\(/)
    // Table writes: session.ts owns the chat_sessions rows; card.ts's `.delete(` is an in-memory Map.
    const writers = CHAT_FILES.filter(f => /\.(insert|update|upsert|delete)\s*\(/.test(decomment(fs.readFileSync(f, 'utf8')))).map(rel).sort()
    expect(writers).toEqual(['lib/chat/card.ts', 'lib/chat/session.ts'])
    expect(read('lib/chat/card.ts')).not.toMatch(/\.from\(\s*['"`]/)
  })

  it('the card is verified, then claimed, then the planner save runs, then the invoice link, then the email — in that order', () => {
    const c = read('lib/chat/confirm.ts')
    const fn = c.slice(c.indexOf('export async function confirmBooking'))
    inOrder(fn, ['verifyCard(', 'claimCard(', 'savePlan(', 'mintPortalLink(', 'sendPlanSummaryEmail('])
  })

  it('model output passes the foreign-contact screen before the visitor sees it', () => {
    expect(read('lib/chat/text.ts')).toMatch(/containsForeignContact\(/)
    expect(read('lib/chat/run.ts')).toMatch(/screenReply\(/)
  })
})

describe('C5: it ships off', () => {
  it('PUBLIC_CHAT_ENABLED must be exactly "true"; production also needs Turnstile and a provider key', () => {
    for (const v of [undefined, '', 'TRUE', '1', 'yes', ' true']) expect(chatEnabled({ PUBLIC_CHAT_ENABLED: v } as never)).toBe(false)
    expect(chatEnabled({ PUBLIC_CHAT_ENABLED: 'true' } as never)).toBe(true)
    expect(chatAvailability({ PUBLIC_CHAT_ENABLED: 'true', NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' } as never)).toEqual({ ok: false, reason: 'no_turnstile' })
    expect(chatAvailability({ PUBLIC_CHAT_ENABLED: 'true', NODE_ENV: 'development' } as never)).toEqual({ ok: false, reason: 'no_provider' })
  })

  it('docker-compose maps the switch with a false default', () => {
    expect(fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8')).toMatch(/PUBLIC_CHAT_ENABLED=\$\{PUBLIC_CHAT_ENABLED:-false\}/)
  })
})

describe('C6: no booking lookup by email or phone', () => {
  it('nothing in the chat imports the contact or booking lookups', () => {
    const offenders = CHAT_FILES.filter(f => /findBookingsByContactEmail|findContactsByEmail|findContactsByPhone|crewMembersByPhone|from\('bookings'\)/.test(decomment(fs.readFileSync(f, 'utf8')))).map(rel)
    expect(offenders).toEqual([])
  })
})
