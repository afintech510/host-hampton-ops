/**
 * The crew app's surface, read off disk (prompt 03). The behaviour is pinned by
 * `auth.test.ts` and `api/crewTestLogin.test.ts`; these rules hold the WIRING
 * those tests cannot see — a new page that forgets the gate, a route that reads
 * another member's row directly, a login door that stops asking who may enter.
 *
 * Comments are stripped before any rule runs, and every anchor tolerates CRLF
 * (this repository is core.autocrlf=true; a fresh worktree gets CRLF).
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const APP_CREW = path.join(SRC, 'app', 'crew')
const API_CREW = path.join(SRC, 'app', 'api', 'crew')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const read = (p: string) => decomment(fs.readFileSync(p, 'utf8'))

function walk(dir: string, pick: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, pick))
    else if (pick(e.name)) out.push(p)
  }
  return out.sort()
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

const PAGES = walk(APP_CREW, n => n === 'page.tsx')
const ROUTES = walk(API_CREW, n => n === 'route.ts')
const ALL_CREW_APP_FILES = [...walk(APP_CREW, n => /\.tsx?$/.test(n)), ...ROUTES]

describe('R0: the walker sees the surface', () => {
  it('finds the pages and routes Phase 2 built, not a remembered list', () => {
    expect(PAGES.map(rel)).toEqual(expect.arrayContaining([
      'app/crew/page.tsx', 'app/crew/login/page.tsx', 'app/crew/parties/[id]/page.tsx',
      'app/crew/availability/page.tsx', 'app/crew/skills/page.tsx', 'app/crew/pay/page.tsx',
    ]))
    expect(ROUTES.length).toBeGreaterThanOrEqual(10)
  })
})

describe('R1: every signed-in page stands behind requireCrewPage', () => {
  const gated = PAGES.filter(p => !rel(p).startsWith('app/crew/login/'))

  it('awaits it and acts on "unavailable" before reading anything else', () => {
    const offenders: string[] = []
    for (const p of gated) {
      const src = read(p)
      const body = src.slice(src.search(/export\s+default\s+async\s+function/))
      const gate = /const\s+(\w+)\s*=\s*await\s+requireCrewPage\s*\(\s*\)\s*\r?\n\s*if\s*\(\s*\1\s*===\s*'unavailable'\s*\)\s*return\b/.exec(body)
      const firstAwait = body.search(/\bawait\b/)
      if (!gate || firstAwait !== gate.index + gate[0].indexOf('await')) offenders.push(rel(p))
    }
    expect(gated.length).toBeGreaterThanOrEqual(5)
    expect(offenders).toEqual([])
  })

  it('the login page 404s with the app closed, like the gate does', () => {
    const src = read(path.join(APP_CREW, 'login', 'page.tsx'))
    expect(src).toMatch(/if\s*\(\s*!\s*crewAppOpen\s*\(\s*\)\s*\)\s*notFound\s*\(\s*\)/)
  })

  it('the layout 404s with the app closed and is dynamic, so the flag is read per request', () => {
    const src = read(path.join(APP_CREW, 'layout.tsx'))
    expect(src).toMatch(/if\s*\(\s*!\s*crewAppOpen\s*\(\s*\)\s*\)\s*notFound\s*\(\s*\)/)
    expect(src).toMatch(/export\s+const\s+dynamic\s*=\s*'force-dynamic'/)
  })
})

describe('R2: no crew page or route reads another member directly', () => {
  it('nothing under app/crew or api/crew SELECTs from crew_members', () => {
    // lib/crew/db.ts names its columns (firstNamesFor: id + first_name; the test
    // picker: no email, no phone). A page that read crew_members itself could
    // hand a teammate's phone to the browser in one line.
    const offenders = ALL_CREW_APP_FILES.filter(p =>
      /from\(\s*'crew_members'\s*\)\s*(?:\r?\n\s*)?\.select\s*\(/.test(read(p)))
    expect(offenders.map(rel)).toEqual([])
  })

  it('the teammate read selects exactly id and first_name', () => {
    const db = read(path.join(SRC, 'lib', 'crew', 'db.ts'))
    const fn = db.slice(db.indexOf('export async function firstNamesFor'), db.indexOf('export async function memberStandbyPartyIds'))
    expect(fn).toMatch(/from\('crew_members'\)\.select\('id, first_name'\)/)
  })

  it('the test picker read selects no email and no phone, and only active, is_test, non-owner rows', () => {
    const db = read(path.join(SRC, 'lib', 'crew', 'db.ts'))
    const fn = db.slice(db.indexOf('export async function listTestMembers'), db.indexOf('export async function listLiveStandbys'))
    const cols = /\.select\('([^']*)'\)/.exec(fn)
    expect(cols).not.toBeNull()
    expect(cols![1]).not.toMatch(/email|phone|\*/)
    expect(fn).toMatch(/\.eq\('is_test',\s*true\)/)
    expect(fn).toMatch(/\.eq\('status',\s*'active'\)/)
    expect(fn).toMatch(/\.eq\('is_owner',\s*false\)/)
  })
})

describe('R3: every door asks who may enter', () => {
  it('the session check runs crewMemberMayEnter on the re-read member', () => {
    const auth = read(path.join(SRC, 'lib', 'crew', 'auth.ts'))
    const fn = auth.slice(auth.indexOf('async function sessionFor'), auth.indexOf('export type CrewGate'))
    expect(fn).toMatch(/const\s+read\s*=\s*await\s+getMember\s*\(/)
    expect(fn).toMatch(/if\s*\(\s*!m\s*\|\|\s*!crewMemberMayEnter\s*\(\s*m\s*\)\s*\)\s*return\s*\{\s*kind:\s*'none'\s*\}/)
  })

  it('both email-code routes judge the member with it before touching a code', () => {
    for (const r of ['request', 'verify']) {
      const src = read(path.join(API_CREW, 'auth', r, 'route.ts'))
      const judged = src.search(/!\s*crewMemberMayEnter\s*\(\s*member\s*\)/)
      const codes = src.search(/from\('crew_login_codes'\)/)
      expect(judged).toBeGreaterThan(-1)
      expect(codes).toBeGreaterThan(judged)
    }
  })

  it('the test picker checks its flag first and refuses on all three facts', () => {
    const src = read(path.join(API_CREW, 'auth', 'test-login', 'route.ts'))
    const body = src.slice(src.search(/export\s+async\s+function\s+POST/))
    const first = /\{\s*(?:\r?\n\s*)*if\s*\(\s*!\s*crewTestLoginEnabled\s*\(\s*\)\s*\)\s*return\b[^\n]*404/.exec(body)
    expect(first).not.toBeNull()
    expect(body).toMatch(/if\s*\(\s*!m\s*\|\|\s*m\.is_test\s*!==\s*true\s*\|\|\s*m\.status\s*!==\s*'active'\s*\|\|\s*m\.is_owner\s*\)\s*\{\s*(?:\r?\n\s*)*return[^\n]*403/)
  })

  it('crewMemberMayEnter keeps real members out in test-only mode', () => {
    const s = read(path.join(SRC, 'lib', 'crew', 'settings.ts'))
    const fn = s.slice(s.indexOf('export function crewMemberMayEnter'))
    expect(fn).toMatch(/if\s*\(\s*!\s*crewEnabled\s*\(\s*\)\s*&&\s*!\s*m\.is_test\s*\)\s*return\s+false/)
    expect(fn).toMatch(/if\s*\(\s*m\.status\s*!==\s*'active'\s*\|\|\s*m\.is_owner\s*\)\s*return\s+false/)
  })
})

describe('R4: the shell', () => {
  it('Nav, Footer and the agency credit hide on /crew AFTER their hooks', () => {
    for (const f of ['Nav.tsx', 'Footer.tsx', 'BenchworksAttribution.tsx']) {
      const src = read(path.join(SRC, 'components', f))
      const crew = src.search(/isCrewPath\s*\(\s*pathname\s*\)\s*\)\s*return\s+null/)
      expect(crew).toBeGreaterThan(-1)
      // Every hook call comes before the early return.
      const hooks = Array.from(src.matchAll(/\buse[A-Z]\w*\s*\(/g)).map(m => m.index ?? 0)
      expect(hooks.length).toBeGreaterThan(0)
      expect(Math.max(...hooks)).toBeLessThan(crew)
    }
  })

  it('the banners, Crisp, attribution and the Meta Pixel stand down on /crew', () => {
    for (const f of ['AppointmentBanner.tsx', 'ChristmasMarketBanner.tsx']) {
      expect(read(path.join(SRC, 'components', f))).toMatch(/'\/crew',/)
    }
    expect(read(path.join(SRC, 'components', 'CrispChat.tsx'))).toMatch(/isCrewPath\s*\(\s*pathname\s*\)/)
    expect(read(path.join(SRC, 'components', 'AttributionCapture.tsx'))).toMatch(/isCrewPath\s*\(\s*pathname\s*\)/)
    expect(read(path.join(SRC, 'lib', 'evites', 'chrome.ts'))).toMatch(/isMetaPixelBlockedPath[\s\S]*?\|\|\s*isCrewPath\s*\(\s*pathname\s*\)/)
  })

  it('/crew/:path* carries X-Robots-Tag noindex', () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), 'next.config.js'), 'utf8')
    expect(cfg).toMatch(/source:\s*'\/crew\/:path\*',\s*\r?\n\s*headers:\s*\[\s*\{\s*key:\s*'X-Robots-Tag',\s*value:\s*'noindex, nofollow'/)
  })
})

describe('R5: isCrewPath', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isCrewPath } = require('@/lib/crewChrome')
  it.each([['/crew', true], ['/crew/login', true], ['/crew/parties/x', true], ['/crewneck', false], ['/admin/crew', false], [null, false]])(
    '%p → %p', (p, want) => expect(isCrewPath(p)).toBe(want))
})
