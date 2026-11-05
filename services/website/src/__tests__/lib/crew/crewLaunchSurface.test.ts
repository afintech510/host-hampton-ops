/**
 * The launch switches, read off disk (2026-11-05). `crewCopy.test.ts`,
 * `view.test.ts` and `rules.test.ts` pin the BEHAVIOUR of the pay game being off;
 * these rules hold the WIRING they cannot see — a new crew page that prints a
 * dollar figure with no guard, a template call that hard-codes the ladder on,
 * a switch that stopped being "exactly true".
 *
 * Comments are stripped first, every anchor tolerates CRLF, and every rule
 * asserts how many sites it examined (a rule that examined none passes for the
 * wrong reason).
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const ROOT = path.join(SRC, '..', '..', '..')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const squash = (s: string) => s.replace(/\s+/g, ' ')
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

const CREW_APP = walk(path.join(SRC, 'app', 'crew'), n => /\.tsx$/.test(n))
const CREW_LIB = walk(path.join(SRC, 'lib', 'crew'), n => /\.ts$/.test(n))

/** The text of a call's parenthesised arguments, matched from the `(` after `at`. */
function callArgs(src: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(openParen + 1, i)
  }
  return ''
}

describe('LS0: the walkers see the surface', () => {
  it('finds the crew pages, components and library', () => {
    expect(CREW_APP.map(rel)).toEqual(expect.arrayContaining([
      'app/crew/page.tsx', 'app/crew/pay/page.tsx', 'app/crew/_components/PartyCard.tsx', 'app/crew/parties/[id]/cant-make-it/page.tsx',
    ]))
    expect(CREW_LIB.map(rel)).toEqual(expect.arrayContaining(['lib/crew/rules.ts', 'lib/crew/jobs.ts', 'lib/crew/cover.ts', 'lib/crew/templates.ts']))
  })
})

describe('LS1: a dollar figure in the crew app is behind a guard', () => {
  // The guards that mean "pay is shown": a null check on a value the view nulled,
  // or the switches themselves.
  const GUARD = /[!=]= null|ladderEnabled|payVisible/
  it('every formatCents call in the crew pages is preceded by one (pay/page.tsx by its early return)', () => {
    let examined = 0
    const offenders: string[] = []
    for (const p of CREW_APP) {
      const src = read(p)
      const re = /formatCents\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        examined++
        if (rel(p) === 'app/crew/pay/page.tsx') {
          // Everything past the launch-mode early return is pay-visible only.
          const early = src.search(/if\s*\(\s*!s\.payVisible\s*\)\s*\{/)
          if (early < 0 || early > m.index) offenders.push(`${rel(p)}@${m.index}`)
          continue
        }
        const window = squash(src.slice(Math.max(0, m.index - 300), m.index))
        if (!GUARD.test(window)) offenders.push(`${rel(p)}@${m.index}`)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(8)
    expect(offenders).toEqual([])
  })

  it('the rate banner and the pay table render only when there is something to show', () => {
    const home = squash(read(path.join(SRC, 'app', 'crew', 'page.tsx')))
    expect(home).toMatch(/\{me\.rateLine \? \(/)
    const pay = squash(read(path.join(SRC, 'app', 'crew', 'pay', 'page.tsx')))
    expect(pay).toMatch(/\{me\.rateLine && \(/)
    expect(pay).toMatch(/\{ladder\.length > 0 && \(/)
  })

  it('the cover page says "counts as two parties" only behind the ladder switch', () => {
    const cover = squash(read(path.join(SRC, 'app', 'crew', 'cover', '[id]', 'page.tsx')))
    expect(cover).toMatch(/First to claim gets it\.\{s\.ladderEnabled \? " Once you've worked it, covering a late cancel counts as two parties toward your rate\." : ''\}/)
    expect(cover).toMatch(/pay \? `Take it \(\$\{pay\}\)` : 'Take it'/)
  })

  it('the bottom tab says "How it works" unless pay is shown', () => {
    const top = squash(read(path.join(SRC, 'app', 'crew', '_components', 'CrewTop.tsx')))
    expect(top).toMatch(/crewShowPayEnabled\(\) \|\| crewPayLadderEnabled\(\) \? 'My pay' : 'How it works'/)
  })
})

describe('LS2: a crew message never hard-codes the ladder or a pay figure', () => {
  const LADDER_TEMPLATES = ['earlyReleased', 'coverOffer', 'coverOpen', 'coveredRequester', 'coverClaimed', 'unclaimedWarning', 'droppedUncovered', 'partyCancelled']
  const PAY_TEMPLATES = ['newParty', 'openSpots', 'claimConfirmed', 'coverOffer', 'coverOpen', 'coverClaimed']

  it('every ladder-aware template call passes the switch, never a literal', () => {
    let examined = 0
    const offenders: string[] = []
    for (const p of CREW_LIB.filter(f => rel(f) !== 'lib/crew/templates.ts')) {
      const src = read(p)
      const re = /templates\.(\w+)\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (!LADDER_TEMPLATES.includes(m[1])) continue
        examined++
        const args = squash(callArgs(src, m.index + m[0].length - 1))
        if (!/\bs\.ladderEnabled\b|crewPayLadderEnabled\(\)/.test(args)) offenders.push(`${rel(p)}: templates.${m[1]}`)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(8)
    expect(offenders).toEqual([])
  })

  it('a pay label reaching a template comes from payLabelFor, not a format of its own', () => {
    let examined = 0
    const offenders: string[] = []
    for (const p of CREW_LIB.filter(f => rel(f) !== 'lib/crew/templates.ts')) {
      const src = read(p)
      const re = /templates\.(\w+)\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        if (!PAY_TEMPLATES.includes(m[1])) continue
        examined++
        const args = squash(callArgs(src, m.index + m[0].length - 1))
        if (/formatCents\(|partyPayCents\(|partyRateCents\(/.test(args)) offenders.push(`${rel(p)}: templates.${m[1]}`)
      }
    }
    // newParty, openSpots, coverOffer, coverOpen, coverClaimed (claimConfirmed is not sent by anything yet).
    expect(examined).toBeGreaterThanOrEqual(5)
    expect(offenders).toEqual([])
  })

  it('nothing past the reconcile can move a step by itself with the switch off: only db.ts calls stepAfter, and rules.ts answers "no change"', () => {
    const callers = CREW_LIB.filter(f => /\bstepAfter\(/.test(read(f)) && rel(f) !== 'lib/crew/rules.ts').map(rel)
    expect(callers).toEqual(['lib/crew/db.ts'])
    const rules = squash(read(path.join(SRC, 'lib', 'crew', 'rules.ts')))
    expect(rules).toMatch(/if \(!s\.ladderEnabled\) return \{ stepsAfter: before, stepsBefore: before, delta: 0, waivedGrace: false, wouldBe: before \}/)
  })
})

describe('LS3: the switches are exactly "true", and mapped', () => {
  it('both read process.env with a strict comparison', () => {
    const src = squash(read(path.join(SRC, 'lib', 'crew', 'settings.ts')))
    expect(src).toMatch(/crewPayLadderEnabled\(\): boolean \{ return process\.env\.CREW_PAY_LADDER === 'true' \}/)
    expect(src).toMatch(/crewShowPayEnabled\(\): boolean \{ return process\.env\.CREW_SHOW_PAY === 'true' \}/)
    // …and loadCrewSettings hands them to the rules, so no other path invents a setting.
    expect(src).toMatch(/settingsFromRows\(rows, \{ ladderEnabled: crewPayLadderEnabled\(\), showPay: crewShowPayEnabled\(\) \}\)/)
  })

  it('docker-compose passes both through, defaulting to false', () => {
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
    expect(compose).toMatch(/- CREW_PAY_LADDER=\$\{CREW_PAY_LADDER:-false\}/)
    expect(compose).toMatch(/- CREW_SHOW_PAY=\$\{CREW_SHOW_PAY:-false\}/)
  })

  it('the code defaults are OFF: a settings object nobody configured has no ladder and no pay', () => {
    const rules = squash(read(path.join(SRC, 'lib', 'crew', 'rules.ts')))
    expect(rules).toMatch(/ladderEnabled: false, payVisible: false, \}/)
  })
})
