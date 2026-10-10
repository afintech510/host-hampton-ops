import { readSrc } from '../../helpers/sourceScan'

/**
 * Source rules for the admin invitation surface (P08). `adminSurface.test.ts` already
 * walks every admin route for the gate (R1), the credential (R2) and the literal actor
 * (R3); this file adds the rules that are specific to this route, each scoped to the
 * site that matters (AGENTS.md: slice the guard, count what you examined, tolerate CRLF).
 */

const ROUTE = ['app', 'api', 'admin', 'parties', '[id]', 'invitation', 'route.ts']
const route = () => readSrc(...ROUTE)
const squash = (s: string) => s.replace(/\s+/g, ' ')

/** The body of an exported handler or a named function: from its `{` after the parameter list to the matching `}`. */
function bodyOf(src: string, header: RegExp): string {
  const m = header.exec(src)
  expect(m).not.toBeNull()
  let i = (m as RegExpExecArray).index + (m as RegExpExecArray)[0].length
  // paren-match the parameter list first (the default-value `{}` trap), then find the body's brace
  let depth = 1
  while (i < src.length && depth > 0) {
    const c = src[i++]
    if (c === '(') depth++
    else if (c === ')') depth--
  }
  const open = src.indexOf('{', i)
  let d = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}' && --d === 0) return src.slice(open, j + 1)
  }
  throw new Error('unbalanced')
}

const handler = (name: 'GET' | 'POST') => bodyOf(route(), new RegExp(`export async function ${name}\\(`))

describe('P08 admin invitation surface', () => {
  it('both handlers authorize FIRST: isAdminAuthorized precedes every database call', () => {
    for (const name of ['GET', 'POST'] as const) {
      const b = handler(name)
      expect(b.length).toBeGreaterThan(200)
      const gate = b.indexOf('isAdminAuthorized(req)')
      expect(gate).toBeGreaterThan(-1)
      expect(b.indexOf('return unauthorizedResponse()', gate)).toBeGreaterThan(gate)
      const firstDb = b.indexOf('getSupabase()')
      expect(firstDb).toBeGreaterThan(gate)
      expect(b.indexOf('await ', gate)).toBeGreaterThan(gate)
      // Nothing is awaited before the gate.
      expect(b.slice(0, gate)).not.toMatch(/\bawait\b/)
    }
  })

  it('no select("*") and no bare .select() anywhere in the P08 server code', () => {
    const files = [route(), readSrc('lib', 'evites', 'adminLoad.ts'), readSrc('lib', 'evites', 'adminView.ts'), readSrc('lib', 'evites', 'adminHooks.ts')]
    let examined = 0
    for (const src of files) {
      for (const m of Array.from(src.matchAll(/\.select\(([^)]*)\)/g))) {
        examined++
        expect(m[1].trim()).not.toBe('')
        expect(m[1]).not.toMatch(/['"`]\s*\*\s*['"`]/)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(12)
  })

  it('every write in the route reads its {error} (and reads the rows back)', () => {
    const src = route()
    let examined = 0
    for (const m of Array.from(src.matchAll(/\.(update|insert|delete|upsert)\(/g))) {
      examined++
      const before = squash(src.slice(Math.max(0, m.index! - 220), m.index!))
      expect(before).toMatch(/const \{[^}]*\berror\b[^}]*\} = await supabase\s*\.from\(/)
    }
    // archive, unarchive, set_theme, reslug, and the void_rsvp delete.
    expect(examined).toBe(5)
    // Each conditional update / delete is read back with .select(...) so zero rows is an answer.
    for (const m of Array.from(src.matchAll(/\.(?:update|delete)\(/g))) {
      const after = squash(src.slice(m.index!, m.index! + 330))
      expect(after).toMatch(/\.select\('(id|slug)'\)/)
    }
  })

  it('void_rsvp: validates the id, reads the RSVP scoped to THIS invitation, and deletes with the same scope', () => {
    const b = bodyOf(route(), /export async function POST\(/)
    const slice = b.slice(b.indexOf("case 'void_rsvp'"))
    expect(slice.length).toBeGreaterThan(200)
    const check = slice.indexOf('isUuidLike(rsvpId)')
    const read = slice.indexOf('.maybeSingle')
    const del = slice.indexOf('.delete()')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(read)
    expect(read).toBeLessThan(del)
    // both the read and the delete name the invitation: a bare id would remove any guest's answer from any booking's URL
    expect(squash(slice.slice(0, read))).toMatch(/\.eq\('id', rsvpId\) \.eq\('evite_id', evite\.id\)/)
    expect(squash(slice.slice(del, del + 200))).toMatch(/\.eq\('id', rsvpId\)\s*\.eq\('evite_id', evite\.id\)/)
    // the audit text names the RSVP and carries no address
    const audit = slice.slice(slice.indexOf('audit('))
    expect(audit).not.toMatch(/reminder_email|club_email|reminder_phone/)
  })

  it('every write is audited with the human, and no literal actor is written', () => {
    const src = route()
    expect(src).toMatch(/import \{ logBookingChange \} from '@\/lib\/bookingAudit'/)
    expect(src).toMatch(/actor = adminActorId\(req\)/)
    expect((src.match(/audit\(/g) ?? []).length).toBe(8) // ensure, rerender, archive, unarchive, set_theme, reslug, notify_cancelled, void_rsvp
    expect(src).toMatch(/actor: adminActorId\(req\)/) // the reveal
    expect(src).not.toMatch(/\b(?:modified_by|actor|recorded_by)\s*:\s*['"](?:ADMIN|admin)['"]/)
  })

  it('reveal: scoped to THIS booking\'s evite, and the audit row precedes the contact in the response', () => {
    const b = bodyOf(route(), /async function revealContact\(/)
    expect(squash(b)).toMatch(/\.eq\('id', rsvpId\)\s*\.eq\('evite_id', found\.evite\.id\)/)
    const log = b.indexOf('logBookingChange(')
    const out = b.indexOf('reminderEmail: data.reminder_email')
    expect(log).toBeGreaterThan(-1)
    expect(out).toBeGreaterThan(log)
    // A failed audit write refuses the reveal, before the contact is in scope of any return.
    const refusal = b.indexOf('if (!logged)')
    expect(refusal).toBeGreaterThan(log)
    expect(refusal).toBeLessThan(out)
    // The audit text names the RSVP and never the address.
    expect(b.slice(log, out)).not.toMatch(/reminder_email|reminderEmail|club_email|reminder_phone/)
  })

  it('the GET payload is built without the raw contact columns', () => {
    const b = handler('GET')
    expect(b).not.toMatch(/reminder_email|reminder_phone_e164|club_email|reminderEmail|clubEmail/)
    expect(b).toMatch(/ADMIN_CONTACT_PRESENCE_COLUMNS/)
  })

  it('reslug: the went-live refusal comes before any write, and the write is conditional on slug AND went_live_at', () => {
    const b = bodyOf(route(), /export async function POST\(/)
    const at = b.indexOf("case 'reslug'")
    const next = b.indexOf("case 'notify_cancelled'")
    const slice = b.slice(at, next)
    const refusal = slice.indexOf('evite.went_live_at')
    const write = slice.indexOf('.update(')
    expect(refusal).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(refusal)
    expect(slice.slice(0, write)).toMatch(/status|json\(/)
    const chain = squash(slice.slice(write, write + 330))
    expect(chain).toMatch(/\.eq\('id', evite\.id\)\s*\.eq\('slug', evite\.slug\)\s*\.is\('went_live_at', null\)/)
    expect(slice).toMatch(/isSlugCollision\(error\)/)
    expect(slice).toMatch(/MAX_SLUG_ATTEMPTS/)
  })

  it('set_theme validates the template against the registry and screens the text before the write', () => {
    const b = bodyOf(route(), /export async function POST\(/)
    const slice = b.slice(b.indexOf("case 'set_theme'"), b.indexOf("case 'reslug'"))
    const write = slice.indexOf('.update(')
    expect(slice.indexOf('isTemplateSlug(')).toBeGreaterThan(-1)
    expect(slice.indexOf('isTemplateSlug(')).toBeLessThan(write)
    expect(slice.indexOf('screenThemeText(')).toBeLessThan(write)
    expect(slice.indexOf('queueRender(')).toBeGreaterThan(write)
  })

  it('notify_cancelled checks the booking is cancelled before it calls the hook', () => {
    const b = bodyOf(route(), /export async function POST\(/)
    const slice = b.slice(b.indexOf("case 'notify_cancelled'"))
    expect(slice.indexOf("'cancelled'")).toBeGreaterThan(-1)
    expect(slice.indexOf("'cancelled'")).toBeLessThan(slice.indexOf('notifyPartyCancelled('))
  })

  it('no template literal is passed to .or(), and the route reads no forwarded header', () => {
    const src = route()
    expect(src).not.toMatch(/\.or\(\s*`/)
    expect(src).not.toMatch(/x-forwarded-host|NEXT_PUBLIC_SITE_URL/i)
    // Links are built from CANONICAL_ORIGIN.
    expect(src).toMatch(/\$\{CANONICAL_ORIGIN\}\/i\/\$\{evite\.slug\}/)
  })

  it('exports only handlers and route config (a route.ts may export nothing else)', () => {
    const exported = Array.from(route().matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort()
    expect(exported).toEqual(['GET', 'POST', 'dynamic', 'runtime'])
  })

  it('NEGATIVE: the write-reads-its-error rule can tell a checked write from an unchecked one', () => {
    const bad = squash("await supabase.from('evites').update({ a: 1 }).eq('id', 1)")
    const good = squash("const { data, error } = await supabase .from('evites') .update({ a: 1 })")
    const re = /const \{[^}]*\berror\b[^}]*\} = await supabase\s*\.from\(/
    expect(re.test(bad)).toBe(false)
    expect(re.test(good)).toBe(true)
  })
})
