/**
 * Crew Phase 4 — the send path, held as one surface.
 *
 * What it guards, rule by rule:
 *   N0  the walker sees every Phase 4 file, by name, and each was read;
 *   N1  only lib/crew/notify.ts calls a provider for a crew message (the invite
 *       and the login code, Phase 2/3, are classified by name);
 *   N2  notifyMember asks "may this person be messaged" BEFORE it writes a row,
 *       skips SMS with a reason before claiming, and DEFERS on quiet hours
 *       (status 'queued' + scheduled_for), never cancels;
 *   N3  the owner is never messaged, and a real member is not while CREW_ENABLED is off;
 *   N4  SMS needs CREW_SMS_ENABLED and the member's opt-in;
 *   N5  the queue CLAIMS a row before anything else, bounds its lateness with
 *       the house freshness bound before sending, and defers on quiet hours;
 *   N6  every crew message carries a dedupe key built from an id;
 *   N7  the cron: one credential check first, the reconcile before the flag,
 *       `skipped: 'disabled'` with the flag off, test scope only with CREW_TEST_LOGIN;
 *   N8  the no-Lead alert never fires for a studio rental;
 *   N9  every cover-request state change is a conditional UPDATE, read back;
 *   N10 nothing on the surface writes `steps` — only the SQL functions do;
 *   N11 no crew page renders a cancel reason.
 *
 * Comments are blanked (offsets kept) before any rule reads a file, anchors
 * tolerate CRLF, a function body is brace-matched from the `{` that ends its
 * signature line (never from a return type's braces), and every rule counts
 * what it examined.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
const squash = (s: string) => s.replace(/\s+/g, ' ')

function walk(dir: string, pick: (n: string) => boolean): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, pick))
    else if (pick(e.name)) out.push(path.relative(SRC, p).split(path.sep).join('/'))
  }
  return out.sort()
}

/** Match from an opening bracket at `open` to its partner. */
function matchFrom(src: string, open: number, o: string, c: string): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++
    else if (src[i] === c && --depth === 0) return i
  }
  return -1
}

/**
 * The body of `function name(`. Paren-match the parameters, then take the `{`
 * that ENDS a line — a return type such as `Promise<{ kind: 'ok' }>` opens
 * braces on the signature line that are not the body.
 */
function bodyOf(src: string, name: string): string {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!m) return ''
  const close = matchFrom(src, m.index + m[0].length - 1, '(', ')')
  const brace = /\{[ \t]*\r?\n/.exec(src.slice(close))
  if (!brace) return ''
  const start = close + brace.index
  const end = matchFrom(src, start, '{', '}')
  return end < 0 ? '' : src.slice(start, end + 1)
}

/** Every call `name(…)` in src, with its full argument list. */
function calls(src: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\b${name}\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue
    const end = matchFrom(src, m.index + m[0].length - 1, '(', ')')
    if (end > 0) out.push(src.slice(m.index, end + 1))
  }
  return out
}

const LIBS = ['lib/crew/notify.ts', 'lib/crew/cover.ts', 'lib/crew/jobs.ts', 'lib/crew/confirm.ts', 'lib/crew/inbound.ts']
const ROUTES = [
  'app/api/cron/crew/route.ts',
  'app/api/crew/confirm/route.ts',
  'app/api/crew/slots/[id]/release/route.ts',
  'app/api/crew/swaps/[id]/withdraw/route.ts',
  'app/api/crew/swaps/[id]/drop/route.ts',
  'app/api/crew/swaps/[id]/claim/route.ts',
  'app/api/admin/crew/swaps/[id]/route.ts',
]
const PAGES = ['app/crew/parties/[id]/cant-make-it/page.tsx', 'app/crew/cover/[id]/page.tsx']

describe('N0: the walker sees the Phase 4 surface', () => {
  it('every named file exists and has substance', () => {
    let examined = 0
    for (const f of [...LIBS, ...ROUTES, ...PAGES]) {
      expect({ f, exists: fs.existsSync(path.join(SRC, f)) }).toEqual({ f, exists: true })
      expect(read(f).length).toBeGreaterThan(400)
      examined++
    }
    expect(examined).toBe(14)
  })
})

describe('N1: one send path', () => {
  const PROVIDER = /\b(?:sendSMSViaQuo|sendCrewEmail|sendSms|sendEmail|resend\.emails|new Resend)\b/
  /** Classified by name, with the reason: each predates Phase 4 and sends one thing. */
  const CLASSIFIED: Record<string, string> = {
    'lib/crew/notify.ts': 'THE crew send path',
    'lib/crew/mail.ts': 'the Resend call itself',
    'lib/crew/adminMembers.ts': 'Phase 3: the invite email, behind CREW_ENABLED (crewAdminSurface R3)',
    'app/api/crew/auth/request/route.ts': 'Phase 2: the 6-digit login code email',
  }

  it('no other crew file names a provider', () => {
    const files = [
      ...walk(path.join(SRC, 'lib', 'crew'), n => n.endsWith('.ts')).filter(f => f.startsWith('lib/')),
      ...walk(path.join(SRC, 'app', 'crew'), n => /\.tsx?$/.test(n)),
      ...walk(path.join(SRC, 'app', 'api', 'crew'), n => n === 'route.ts'),
      ...walk(path.join(SRC, 'app', 'api', 'admin', 'crew'), n => n === 'route.ts'),
      'app/api/cron/crew/route.ts', 'app/api/webhooks/quo/route.ts',
    ]
    expect(files.length).toBeGreaterThan(40)
    const offenders = files.filter(f => !(f in CLASSIFIED) && PROVIDER.test(read(f).replace(/^import[^\r\n]*$/gm, '')))
    expect(offenders).toEqual([])
    for (const f of Object.keys(CLASSIFIED)) expect({ f, sends: PROVIDER.test(read(f)) }).toEqual({ f, sends: true })
  })
})

const notify = read('lib/crew/notify.ts')

describe('N2: notifyMember asks first, claims second, defers on quiet hours', () => {
  const body = bodyOf(notify, 'notifyMember')

  it('reads the gate before its first write', () => {
    expect(body).not.toBe('')
    const gate = body.indexOf('crewMessagingAllowed(member)')
    const firstWrite = body.indexOf('insertNotification(')
    expect(gate).toBeGreaterThan(-1)
    expect(firstWrite).toBeGreaterThan(gate)
    expect(squash(body)).toMatch(/if \(allowed === 'owner'\) return \{ kind: 'owner' \}/)
    expect(squash(body)).toMatch(/if \(allowed !== 'ok'\) return \{ kind: 'held', reason: allowed \}/)
  })

  it('an SMS it may not send is written skipped WITH the reason, before any claim or quiet-hours read', () => {
    const skip = body.indexOf('smsSkipReason(member')
    const window = body.indexOf('checkSmsQuietHours(')
    const deliver = body.indexOf('deliverSms(')
    expect(skip).toBeGreaterThan(-1)
    expect(window).toBeGreaterThan(skip)
    expect(deliver).toBeGreaterThan(window)
    expect(squash(body)).toMatch(/if \(skip\) \{ const r = await insertNotification\(ctx\.sb, \{[^}]*status: 'skipped', error: skip/)
  })

  it('the quiet-hours branch writes queued + scheduled_for and returns before any send', () => {
    const m = /if \(window\.kind !== 'open'\) \{([\s\S]*?)\n  \}/.exec(body.replace(/\r/g, ''))
    expect(m).not.toBeNull()
    const branch = m![1]
    expect(branch).toMatch(/status: 'queued'/)
    expect(branch).toMatch(/scheduled_for: until\.toISOString\(\)/)
    expect(branch).toMatch(/return \{ kind: 'done', channels \}/)
    expect(branch).not.toMatch(/'skipped'|'cancelled'|deliverSms\(/)
  })

  it('the disclosure rides on the first text, through its own dedupe row', () => {
    const d = bodyOf(notify, 'deliverSms')
    expect(d).toMatch(/dedupe_key: `sms_disclosure:\$\{member\.id\}`/)
    expect(d).toMatch(/gsm7Sanitize\(carry \? `\$\{text\} \$\{SMS_DISCLOSURE\}` : text\)/)
    expect(d).toMatch(/smsSegmentInfo\(body\)/)
  })
})

describe('N3/N4: who may be messaged, and who may be texted', () => {
  it('the owner first; a real member is out while CREW_ENABLED is off', () => {
    const b = squash(bodyOf(notify, 'crewMessagingAllowed'))
    expect(b.indexOf("if (m.is_owner) return 'owner'")).toBeGreaterThan(-1)
    expect(b).toMatch(/if \(!crewEnabled\(\) && !m\.is_test\) return 'crew_disabled'/)
    expect(b.indexOf("if (m.is_owner)")).toBeLessThan(b.indexOf('crewEnabled()'))
  })

  it('SMS needs the switch and the member’s opt-in (HELP replies excepted)', () => {
    const b = squash(bodyOf(notify, 'smsSkipReason'))
    expect(b).toMatch(/if \(!crewSmsEnabled\(\)\) return 'CREW_SMS_ENABLED is off'/)
    expect(b).toMatch(/if \(!m\.sms_opt_in && !opts\.helpReply\) return 'sms_opt_in is off'/)
    expect(b).toMatch(/if \(!m\.phone\) return/)
  })

  it('the only helpReply in the codebase answers HELP', () => {
    const inbound = read('lib/crew/inbound.ts')
    const uses = [...LIBS, ...ROUTES].flatMap(f => read(f).match(/helpReply:\s*true/g) ?? [])
    expect(uses).toHaveLength(1)
    expect(squash(inbound)).toMatch(/notifyMember\(ctx, member, 'smsHelp', templates\.smsHelp\(\), `sms_help:\$\{replyKey\}`, \{ helpReply: true \}\)/)
  })
})

describe('N5: the queue', () => {
  const body = bodyOf(notify, 'drainCrewQueue')

  it('claims queued → sending, read back, before freshness, consent and any send', () => {
    expect(body).not.toBe('')
    const claim = body.search(/\.update\(\{ status: 'sending', claimed_at: nowIso \}\)\s*\.eq\('id', row\.id\)\.eq\('status', 'queued'\)\s*\.select\('id'\)/)
    const fresh = body.indexOf('checkFreshness(')
    const allowed = body.indexOf('crewMessagingAllowed(member)')
    const smsSkip = body.indexOf('smsSkipReason(member)')
    const send = Math.min(...['deliverEmail(', 'deliverSms('].map(k => body.indexOf(k)).filter(i => i >= 0))
    for (const i of [claim, fresh, allowed, smsSkip]) expect(i).toBeGreaterThan(-1)
    expect(claim).toBeLessThan(fresh)
    expect(fresh).toBeLessThan(allowed)
    expect(allowed).toBeLessThan(send)
    expect(smsSkip).toBeLessThan(body.indexOf('deliverSms('))
    expect(body).toMatch(/if \(\(claimed \?\? \[\]\)\.length === 0\) \{ sum\.raced\+\+; continue \}/)
  })

  it('the bound is the house one, and stale is SKIPPED with the reason (never sent, never left)', () => {
    expect(body).toMatch(/checkFreshness\(row\.scheduled_for, ctx\.now, reminderMaxLatenessMs\(\)/)
    expect(squash(body)).toMatch(/if \(fresh\.kind === 'stale'\) \{ await skip\(fresh\.reason\); continue \}/)
    expect(squash(body)).toMatch(/if \(fresh\.kind === 'unreadable'\)/)
  })

  it('a message whose subject moved on is not sent, and an unreadable subject is left queued', () => {
    expect(squash(body)).toMatch(/if \(relevant === 'unavailable'\) \{ await release\(/)
    expect(squash(body)).toMatch(/if \(relevant === 'no'\) \{ await skip\(/)
  })

  it('quiet hours in the drain put the row back with a later scheduled_for', () => {
    const m = /if \(window\.kind !== 'open'\) \{([\s\S]*?)continue\s*\}/.exec(body)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/status: 'queued', claimed_at: null, scheduled_for: until\.toISOString\(\)/)
    expect(m![1]).not.toMatch(/'skipped'/)
  })
})

describe('N6: every crew message has a dedupe key built from an id', () => {
  it('each notifyMember / notifyAdmin call passes a `prefix:${…}` key', () => {
    let examined = 0
    const offenders: string[] = []
    for (const f of LIBS) {
      const src = read(f)
      for (const fn of ['notifyMember', 'notifyAdmin']) {
        for (const c of calls(src, fn)) {
          examined++
          if (/`[a-z_]+:\$\{/.test(c)) continue
          // A key held in a variable counts only if that variable is bound to such a template in this file.
          const named = Array.from(c.matchAll(/\b(\w+Key)\b/g)).map(x => x[1])
          const bound = named.some(n => new RegExp('const ' + n + ' = `[a-z_]+:\\$\\{').test(src))
          if (!bound) offenders.push(`${f}: ${squash(c).slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
    // 24 call sites at Phase 4 (2026-10-27). A drop means the walker stopped seeing them.
    expect(examined).toBeGreaterThanOrEqual(24)
  })
})

describe('N6b: a crew member and Allie never share a dedupe key', () => {
  /**
   * `(dedupe_key, channel)` is ONE namespace for every recipient. A member notice and an admin alert under the
   * same key make the second a "duplicate" that is never sent — which is how Allie's drop-anyway alert went
   * missing in the 2026-10-27 production probe while every unit test stayed green.
   */
  it('no key prefix is used by both notifyMember and notifyAdmin', () => {
    const prefixes = { member: new Set<string>(), admin: new Set<string>() }
    let examined = 0
    for (const f of LIBS) {
      const src = read(f)
      for (const [fn, set] of [['notifyMember', prefixes.member], ['notifyAdmin', prefixes.admin]] as const) {
        for (const c of calls(src, fn)) {
          for (const m of Array.from(c.matchAll(/`([a-z_]+):\$\{/g))) { set.add(m[1]); examined++ }
          for (const n of Array.from(c.matchAll(/\b(\w+Key)\b/g))) {
            const b = new RegExp('const ' + n[1] + ' = `([a-z_]+):\\$\\{').exec(src)
            if (b) { set.add(b[1]); examined++ }
          }
        }
      }
    }
    const shared = Array.from(prefixes.member).filter(p => prefixes.admin.has(p))
    expect(shared).toEqual([])
    expect(examined).toBeGreaterThanOrEqual(24)
  })
})

describe('N7: the cron route', () => {
  const route = read('app/api/cron/crew/route.ts')
  const handler = route.slice(route.indexOf('export async function GET'))

  it('checks the one credential first', () => {
    expect(/import\s*\{[^}]*isCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cronAuth'/.test(route)).toBe(true)
    expect(squash(handler)).toMatch(/^export async function GET\(req: NextRequest\) \{ if \(!isCronAuthorized\(req\)\) \{/)
  })

  it('reconciles regardless, then stands down unless CREW_ENABLED (or the test scope with CREW_TEST_LOGIN)', () => {
    const rec = handler.indexOf('reconcileCrewParties(')
    const gate = handler.indexOf('if (!crewEnabled() && !(testScope && crewTestLoginEnabled()))')
    const jobs = handler.indexOf('runCrewJobs(')
    expect(rec).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(rec)
    expect(jobs).toBeGreaterThan(gate)
    expect(squash(handler.slice(gate, jobs))).toMatch(/return NextResponse\.json\(\{ ok: reconcile\.ok, skipped: 'disabled', reconcile \}\)/)
    expect(squash(handler)).toMatch(/const scope = crewEnabled\(\) \? 'all' : 'test'/)
  })

  it('answers counts, never a booking ref or a name', () => {
    expect(handler).not.toMatch(/needsTime:\s*rec\.summary\.needsTime\s*[,}]/)
    expect(handler).toMatch(/needsTime:\s*rec\.summary\.needsTime\.length/)
  })
})

describe('N8: a studio rental has no Lead, so no no-Lead alert', () => {
  it('the alert’s own condition excludes it', () => {
    const body = bodyOf(read('lib/crew/jobs.ts'), 'runPartyAlerts')
    expect(body).not.toBe('')
    const at = body.indexOf("'noLead'")
    const cond = body.lastIndexOf('if (', at)
    const condition = body.slice(cond, body.indexOf('{', cond))
    expect(condition).toMatch(/party\.party_kind !== 'studio_rental'/)
  })
})

describe('N9: cover requests change state only by conditional, read-back UPDATE or by SQL function', () => {
  it('every crew_swap_requests UPDATE names the state it expects and reads back', () => {
    let examined = 0
    const offenders: string[] = []
    for (const f of ['lib/crew/cover.ts', 'lib/crew/jobs.ts']) {
      const src = read(f)
      const re = /from\('crew_swap_requests'\)\s*\.update\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        examined++
        const stmt = src.slice(m.index, src.indexOf('\n', src.indexOf('.select(', m.index)))
        const guarded = /\.(?:eq|in)\('status'|\.is\('(?:standbys_notified_at|offered_to_all_at|warned_at)', null\)/.test(stmt)
        if (!guarded || !/\.select\(/.test(stmt)) offenders.push(`${f}: ${squash(stmt).slice(0, 90)}`)
        // A once-only stamp is claimed on ITSELF being null — a status guard alone lets two ticks both stamp it
        // and both send (mutation M28: the in-memory `!swap.warned_at` hid that from every sequential test).
        for (const col of ['standbys_notified_at', 'offered_to_all_at', 'warned_at']) {
          if (new RegExp(`update\\(\\{ ${col}:`).test(stmt) && !new RegExp(`\\.is\\('${col}', null\\)`).test(stmt)) {
            offenders.push(`${f}: ${col} stamped without .is('${col}', null)`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
    expect(examined).toBeGreaterThanOrEqual(6)
  })

  it('release, claim and drop go through the SQL functions, never a direct write', () => {
    const cover = read('lib/crew/cover.ts')
    expect(cover).toMatch(/releaseSlot\(ctx\.sb,/)
    expect(cover).toMatch(/claimSwap\(ctx\.sb, swapId, member\.id\)/)
    expect(cover).toMatch(/claimSwap\(ctx\.sb, swapId, memberId, \{ byAdmin: true, actor \}\)/)
    expect(cover).toMatch(/dropUncovered\(ctx\.sb,/)
    expect(cover).not.toMatch(/from\('crew_slots'\)\s*\.update/)
  })
})

describe('N9b: confirming is one conditional UPDATE, read back', () => {
  it('setConfirmed names the member, the status and confirmed_at IS NULL, and both callers go through it', () => {
    const src = read('lib/crew/confirm.ts')
    const body = squash(bodyOf(src, 'setConfirmed'))
    expect(body).toMatch(/\.update\(\{ confirmed_at: now\.toISOString\(\) \}\) \.eq\('id', slot\.id\)\.eq\('member_id', memberId\)\.eq\('status', 'assigned'\)\.is\('confirmed_at', null\) \.select\('id'\)/)
    for (const fn of ['confirmSpot', 'confirmNextDue']) {
      const b = bodyOf(src, fn)
      expect({ fn, viaClaim: /setConfirmed\(ctx\.sb,/.test(b), direct: /from\('crew_slots'\)/.test(b) }).toEqual({ fn, viaClaim: true, direct: false })
    }
    // The confirmation message is sent only by the winner.
    const next = bodyOf(src, 'confirmNextDue')
    expect(next.indexOf("if (won === 'lost')")).toBeLessThan(next.indexOf('await tell('))
  })
})

describe('N10: nothing on the Phase 4 surface writes steps', () => {
  it('no update payload carries steps', () => {
    let examined = 0
    for (const f of [...LIBS, ...ROUTES]) {
      examined++
      expect({ f, writes: /\.update\(\{[^}]*\bsteps\s*:/.test(read(f)) }).toEqual({ f, writes: false })
    }
    expect(examined).toBe(12)
  })
})

describe('N11: crew never see a cancel reason', () => {
  it('no crew page reads a swap reason', () => {
    const files = walk(path.join(SRC, 'app', 'crew'), n => /\.tsx?$/.test(n))
    expect(files.length).toBeGreaterThan(15)
    const offenders = files.filter(f => /\b(?:swap|live|last|cover)\.reason(?:_note)?\b|reason_note/.test(read(f)))
    expect(offenders).toEqual([])
  })
})
