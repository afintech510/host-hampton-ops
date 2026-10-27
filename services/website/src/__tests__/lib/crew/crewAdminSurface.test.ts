/**
 * The tripwire for crew scheduling Phase 3 — the admin pages, their routes, and
 * the booking reconcile. Behaviour is proven in `sync.test.ts` and
 * `adminCrew.test.ts`; this file holds the SHAPES those promises rest on, so a
 * refactor cannot quietly drop one:
 *
 *   R1  every /api/admin/crew handler gates on isAdminAuthorized FIRST;
 *   R2  every write names the human: adminActorId(req) is passed on;
 *   R3  nothing in Phase 3 SENDS, except the invite, which is behind CREW_ENABLED;
 *   R4  the reconcile creates DRAFTS and never publishes;
 *   R5  the reconcile never removes a spot, never writes the ledger, never calls a step function;
 *   R6  its idempotency: 23505 on create is "already there"; an update is claimed on updated_at;
 *   R7  steps are never written by an UPDATE — only crew_admin_set_steps moves them;
 *   R8  a spot becomes 'assigned' only inside crew_admin_assign;
 *   R9  /admin links to /admin/crew.
 *
 * Comments are stripped first (a well-documented file is a hazard to a rule
 * that greps it) and every anchor tolerates CRLF. Each rule counts what it
 * examined, so an empty walk cannot pass.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const API = path.join(SRC, 'app', 'api', 'admin', 'crew')
const PAGES = path.join(SRC, 'app', 'admin', 'crew')
const LIB = path.join(SRC, 'lib', 'crew')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const squash = (s: string) => s.replace(/\s+/g, ' ')
const read = (p: string) => decomment(fs.readFileSync(p, 'utf8'))

function walk(dir: string, pick: (n: string) => boolean): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, pick))
    else if (pick(e.name)) out.push(p)
  }
  return out.sort()
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

const ROUTES = walk(API, n => n === 'route.ts')
const PAGE_FILES = walk(PAGES, n => n === 'page.tsx')
const ADMIN_LIBS = ['admin.ts', 'adminActions.ts', 'adminMembers.ts', 'adminForms.ts'].map(f => path.join(LIB, f))
const SYNC = path.join(LIB, 'sync.ts')

type Handler = { file: string; method: string; body: string }
function handlers(abs: string): Handler[] {
  const src = read(abs)
  const marks: { method: string; idx: number }[] = []
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const mt of Array.from(src.matchAll(new RegExp(`export\\s+async\\s+function\\s+${m}\\s*\\(`, 'g')))) marks.push({ method: m, idx: mt.index as number })
  }
  marks.sort((a, b) => a.idx - b.idx)
  return marks.map((mk, i) => ({ file: rel(abs), method: mk.method, body: src.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length) }))
}
const HANDLERS = ROUTES.flatMap(handlers)

/**
 * The body of `function name(`: paren-match the parameter list first (a
 * default like `= {}` is not the body), then take the first `{` that ENDS ITS
 * LINE — a return type such as `Promise<{ id: string }>` is written inline,
 * a body never is — and brace-match from there.
 */
function bodyFrom(src: string, from: number): string {
  let i = src.indexOf('(', from)
  if (i < 0) return ''
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) break }
  }
  const open = src.slice(i).search(/\{[ \t]*\r?\n/)
  if (open < 0) return ''
  const b = i + open
  depth = 0
  for (let j = b; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(b, j + 1) }
  }
  return ''
}

function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function\\s+${name}\\s*\\(`))
  return start < 0 ? '' : bodyFrom(src, start)
}

describe('R0: the walkers see the surface', () => {
  it('finds the Phase 3 routes, pages and libraries', () => {
    expect(ROUTES.map(rel)).toEqual(expect.arrayContaining([
      'app/api/admin/crew/route.ts',
      'app/api/admin/crew/sync/route.ts',
      'app/api/admin/crew/parties/route.ts',
      'app/api/admin/crew/parties/[id]/route.ts',
      'app/api/admin/crew/members/route.ts',
      'app/api/admin/crew/members/[id]/route.ts',
      'app/api/admin/crew/members/[id]/steps/route.ts',
      'app/api/admin/crew/members/[id]/invite/route.ts',
      'app/api/admin/crew/settings/route.ts',
    ]))
    expect(PAGE_FILES.map(rel)).toEqual([
      'app/admin/crew/members/page.tsx', 'app/admin/crew/page.tsx', 'app/admin/crew/parties/[id]/page.tsx', 'app/admin/crew/rules/page.tsx',
    ])
    expect(HANDLERS.length).toBeGreaterThanOrEqual(12)
    for (const f of [...ADMIN_LIBS, SYNC]) expect(fs.existsSync(f)).toBe(true)
  })
})

describe('R1: every handler is gated, and the gate is the first thing it does', () => {
  it('opens with `if (!isAdminAuthorized(req)) return unauthorizedResponse()`', () => {
    const offenders = HANDLERS.filter(h => {
      const body = bodyFrom(h.body, 0)
      if (!body) return true
      const firstStmt = squash(body).replace(/^\{\s*/, '')
      return !firstStmt.startsWith('if (!isAdminAuthorized(req)) return unauthorizedResponse()')
    }).map(h => `${h.file} ${h.method}`)
    expect(offenders).toEqual([])
  })
})

describe('R2: every write names the human', () => {
  it('each POST / PATCH / PUT passes adminActorId(req) on', () => {
    const writes = HANDLERS.filter(h => h.method !== 'GET')
    expect(writes.length).toBeGreaterThanOrEqual(8)
    const offenders = writes.filter(h => !/adminActorId\(req\)/.test(h.body)).map(h => `${h.file} ${h.method}`)
    expect(offenders).toEqual([])
  })

  it('the libraries never fall back to a literal actor', () => {
    for (const f of [...ADMIN_LIBS, SYNC]) {
      expect([rel(f), read(f).match(/\b(?:updated_by|assigned_by|created_by|p_actor|actor)\s*:\s*['"](?:ADMIN|admin)['"]/g)]).toEqual([rel(f), null])
    }
  })
})

const SEND_RE = /\b(?:sendCrewEmail|sendSMSViaQuo|sendSms|sendEmail|sendEviteEmail|notifyOwner\w*|resend\.emails|new Resend)\b/

describe('R3: Phase 3 sends nothing — except an invite, after launch', () => {
  it('the reconcile, the party actions, the loaders and the routes call no sender', () => {
    const files = [SYNC, path.join(LIB, 'admin.ts'), path.join(LIB, 'adminActions.ts'), path.join(LIB, 'adminForms.ts'), ...ROUTES]
    const offenders = files.filter(f => SEND_RE.test(read(f).replace(/^import[^\n]*$/gm, ''))).map(rel)
    expect(offenders).toEqual([])
  })

  it('adminMembers sends in ONE place, inviteMember, and only after the CREW_ENABLED refusal', () => {
    const src = read(path.join(LIB, 'adminMembers.ts')).replace(/^import[^\n]*$/gm, '')
    expect(src.match(/sendCrewEmail\(/g)).toHaveLength(1)
    const body = functionBody(src, 'inviteMember')
    expect(body).not.toBe('')
    const gate = body.search(/if \(!crewEnabled\(\)\) return refuse\(/)
    const send = body.indexOf('sendCrewEmail(')
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(send).toBeGreaterThan(gate)
    // …and the claim (the dedupe row) comes before the send, so a double click mails once.
    const claim = body.indexOf('insertNotification(')
    expect(claim).toBeGreaterThan(gate)
    expect(send).toBeGreaterThan(claim)
  })

  it('a cancelled party QUEUES its notices', () => {
    const body = functionBody(read(SYNC), 'queueCancelled')
    expect(body).not.toBe('')
    expect(squash(body)).toMatch(/insertNotification\(sb, \{[^}]*status: 'queued'/)
    expect(body).not.toMatch(/status: '(?:sent|failed)'/)
  })
})

describe('R4: the reconcile makes drafts and never publishes', () => {
  it("its create row is status 'draft', and no write in it says 'published'", () => {
    const src = squash(read(SYNC))
    expect(src).toMatch(/row: \{ booking_id: b\.id,[^}]*status: 'draft',/)
    expect(src).not.toMatch(/status: 'published'/)
    expect(src).not.toMatch(/published_at:/)
  })
})

describe('R5: the reconcile never removes a spot and never moves a step', () => {
  it('no delete; the one crew_slots update cancels spots of a party it just claimed as cancelled', () => {
    const src = read(SYNC)
    expect(src).not.toMatch(/\.delete\(/)
    // Exactly two: the cancel path's, and the studio-rental Lead-spot → crew-spot change
    // (Adam, 2026-10-27), which may touch only an OPEN, UNHELD spot and only its role.
    const updates = Array.from(src.matchAll(/from\('crew_slots'\)\s*\.update\(/g))
    expect(updates).toHaveLength(2)
    const stmts = updates.map(u => squash(src.slice(u.index as number, (u.index as number) + 220)))
    expect(stmts.filter(s => /^from\('crew_slots'\) ?\.update\(\{ status: 'cancelled' \}\)/.test(s))).toHaveLength(1)
    const crewify = stmts.filter(s => /^from\('crew_slots'\) ?\.update\(\{ role: 'crew' \}\)/.test(s))
    expect(crewify).toHaveLength(1)
    expect(crewify[0]).toMatch(/^from\('crew_slots'\) ?\.update\(\{ role: 'crew' \}\) ?\.in\('id', u\.crewifySlotIds\) ?\.eq\('party_id', u\.partyId\) ?\.eq\('status', 'open'\) ?\.is\('member_id', null\)/)
    const body = functionBody(src, 'applyReconcile')
    const claim = body.search(/from\('crew_parties'\)\s*\.update\(\{ status: 'cancelled'/)
    const slots = body.search(/from\('crew_slots'\)\s*\.update\(\{ status: 'cancelled'/)
    expect(claim).toBeGreaterThan(0)
    expect(slots).toBeGreaterThan(claim)
    // The slot cancel only runs for a WON claim: the 0-row branch continues first.
    expect(squash(body.slice(claim, slots))).toMatch(/if \(\(data \?\? \[\]\)\.length === 0\) \{ summary\.raced\+\+; continue \}/)
  })

  it('it touches no ledger and calls no SQL function', () => {
    const src = read(SYNC)
    expect(src).not.toMatch(/crew_events/)
    expect(src).not.toMatch(/\.rpc\(/)
    expect(src).not.toMatch(/\bsteps\s*:/)
  })
})

describe('R6: the reconcile is idempotent by construction', () => {
  const body = functionBody(read(SYNC), 'applyReconcile')

  it('a create that collides on uq_crew_parties_booking is counted as already there', () => {
    expect(body).not.toBe('')
    expect(squash(body)).toMatch(/from\('crew_parties'\)\.insert\([^)]*\)\.select\('id'\)\.maybeSingle\(\) if \(error\) \{ if \(\(error as \{ code\?: string \}\)\.code === '23505'\) \{ summary\.alreadyThere\+\+; continue \}/)
  })

  it('an update is a claim on the updated_at it read, and spots are added only by the winner', () => {
    const s = squash(body)
    const upd = s.search(/from\('crew_parties'\) ?\.update\(write\) ?\.eq\('id', u\.partyId\) ?\.eq\('updated_at', u\.expectedUpdatedAt\)/)
    expect(upd).toBeGreaterThan(0)
    const lost = s.indexOf("if ((data ?? []).length === 0) { summary.raced++; continue }", upd)
    const add = s.indexOf('insertSlots(sb, u.partyId, u.addRoles)', upd)
    expect(lost).toBeGreaterThan(upd)
    expect(add).toBeGreaterThan(lost)
  })
})

describe('R7: steps move only through crew_admin_set_steps', () => {
  it('no UPDATE anywhere in the admin surface writes `steps`', () => {
    let examined = 0
    const offenders: string[] = []
    for (const f of [...ADMIN_LIBS, SYNC, ...ROUTES]) {
      const src = read(f)
      for (const m of Array.from(src.matchAll(/\.update\(/g))) {
        examined++
        // The update's argument, brace-matched.
        let i = (m.index as number) + '.update('.length
        let depth = 1
        const from = i
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '(') depth++
          else if (src[i] === ')') depth--
        }
        const arg = src.slice(from, i)
        if (/\bsteps\s*:/.test(arg) || /\.\.\.\s*(?:body|input)\b/.test(arg)) offenders.push(`${rel(f)}: .update(${squash(arg).slice(0, 80)})`)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(15)
    expect(offenders).toEqual([])
  })

  it('a new member is inserted at step 0; a starting step is then set by the SQL function', () => {
    const body = functionBody(read(path.join(LIB, 'adminMembers.ts')), 'createMember')
    expect(body).not.toBe('')
    const s = squash(body)
    expect(s).toMatch(/\{ \.\.\.screen\.row, steps: 0, is_owner: false, updated_by: actor \}/)
    const ins = s.indexOf("from('crew_members').insert(row)")
    const set = s.indexOf('adminSetSteps(sb, { memberId: id, steps: screen.startingSteps')
    expect(ins).toBeGreaterThan(0)
    expect(set).toBeGreaterThan(ins)
  })

  it('an edit can never carry steps, and the owner row is refused everything but name, notes and skills', () => {
    const src = squash(read(path.join(LIB, 'adminForms.ts')))
    expect(src).toMatch(/if \(mode\.kind === 'edit' && \('steps' in body \|\| 'job_application_id' in body\)\) \{ return \{ ok: false/)
    expect(src).toMatch(/const OWNER_EDITABLE = new Set\(\['first_name', 'last_name', 'admin_notes', 'skills'\]\)/)
  })
})

describe('R8: a spot is assigned only by crew_admin_assign', () => {
  it("no file in the admin surface writes status 'assigned' itself", () => {
    const offenders = [...ADMIN_LIBS, SYNC, ...ROUTES].filter(f => /status:\s*'assigned'/.test(read(f))).map(rel)
    expect(offenders).toEqual([])
  })

  it('assignMember reaches the database through adminAssign, after the hard refusals', () => {
    const body = squash(functionBody(read(path.join(LIB, 'adminActions.ts')), 'assignMember'))
    expect(body).not.toBe('')
    const hard = body.indexOf("if (hard.length) return refuse(409")
    const soft = body.indexOf("if (soft.length && input.force !== true)")
    const call = body.indexOf('await adminAssign(sb, slot.id, member.id, actor)')
    expect(hard).toBeGreaterThan(0)
    expect(soft).toBeGreaterThan(hard)
    expect(call).toBeGreaterThan(soft)
  })
})

describe('R9: the way in', () => {
  it("/admin's Manage group links to /admin/crew", () => {
    const src = squash(read(path.join(SRC, 'app', 'admin', 'page.tsx')))
    expect(src).toMatch(/\{ href: '\/admin\/crew', label: 'Crew', Icon: \w+, group: 'manage' \}/)
    expect(src).toMatch(/LINKS\.filter\(l => l\.group === group\)\.map/)
  })
})
