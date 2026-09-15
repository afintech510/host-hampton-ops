import fs from 'fs'
import path from 'path'
import {
  FUNDRAISER_TEAMS,
  FUNDRAISER_TEAM_SLUGS,
  DEFAULT_FUNDRAISER_TEAM,
  isFundraiserTeamSlug,
  resolveFundraiserTeam,
} from '@/lib/fundraiserTeams'

describe('resolveFundraiserTeam', () => {
  it('defaults an absent team to cm-cheer, so the pages that predate the field keep working', () => {
    // `/cm-cheer` and `/li-high` do not send `team`. If absence stopped being
    // the default they would start 400ing on a live order form.
    for (const absent of [undefined, null, '']) {
      expect(resolveFundraiserTeam(absent)?.slug).toBe('cm-cheer')
    }
    expect(DEFAULT_FUNDRAISER_TEAM).toBe('cm-cheer')
  })

  it('resolves each known team to itself', () => {
    for (const slug of FUNDRAISER_TEAM_SLUGS) {
      expect(resolveFundraiserTeam(slug)?.slug).toBe(slug)
    }
    expect(resolveFundraiserTeam('esm-sharks')?.slug).toBe('esm-sharks')
  })

  it('refuses an unknown team rather than defaulting it', () => {
    // Defaulting here would file a Sharks order under CM Cheer — silently, and
    // in the wrong booster club's money.
    expect(resolveFundraiserTeam('esm-sharkz')).toBeNull()
    expect(resolveFundraiserTeam('li-high')).toBeNull()
  })

  it('refuses a non-string team', () => {
    for (const bad of [0, 1, true, {}, [], { slug: 'esm-sharks' }]) {
      expect(resolveFundraiserTeam(bad)).toBeNull()
    }
  })

  /**
   * The bug this file exists for.
   *
   * `FUNDRAISER_TEAMS` is an object literal, so it inherits Object.prototype.
   * A bare `FUNDRAISER_TEAMS[value]` returns a FUNCTION for these keys — truthy,
   * so it survives `?? null` and is handed back as a team. Its `.slug` is
   * undefined, a Supabase insert drops undefined, and the column default files
   * the order under `cm-cheer`. An attacker-chosen string becomes another
   * fundraiser's order.
   */
  it('does not resolve inherited Object.prototype keys as teams', () => {
    for (const inherited of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      '__proto__',
      'propertyIsEnumerable',
      'toLocaleString',
    ]) {
      expect(isFundraiserTeamSlug(inherited)).toBe(false)
      expect(resolveFundraiserTeam(inherited)).toBeNull()
    }
  })
})

describe('the team table itself', () => {
  it('keys agree with each entry’s own slug', () => {
    // A mismatch means `?team=x` filters on one value while the page posts
    // another, and the orders land where no dashboard looks.
    for (const [key, team] of Object.entries(FUNDRAISER_TEAMS)) {
      expect(team.slug).toBe(key)
    }
  })

  it('gives every team a distinct order-ref prefix', () => {
    const prefixes = FUNDRAISER_TEAM_SLUGS.map(s => FUNDRAISER_TEAMS[s].orderPrefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('never points two teams at the same Venmo account', () => {
    // Two fundraisers sharing a payment handle means neither booster club can
    // tell which of their parents actually paid.
    const handles = FUNDRAISER_TEAM_SLUGS.map(s => FUNDRAISER_TEAMS[s].venmoHandle.toLowerCase())
    expect(new Set(handles).size).toBe(handles.length)
  })
})

describe('agreement with the database', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..')
  const migration = path.join(repoRoot, 'starting_plan', 'migration_051_fundraiser_team.sql')

  /**
   * `order_ref` is minted by a DB trigger; `orderPrefix` here is a display copy.
   * If the two drift, a confirmation email quotes an order number that does not
   * exist — so this reads the migration rather than trusting the comment.
   */
  it('mints the prefix each team claims', () => {
    const sql = fs.readFileSync(migration, 'utf8')
    for (const slug of FUNDRAISER_TEAM_SLUGS) {
      expect(sql).toContain(`'${FUNDRAISER_TEAMS[slug].orderPrefix}'`)
    }
  })

  it('constrains the team column to exactly the teams this module knows', () => {
    const sql = fs.readFileSync(migration, 'utf8')
    const check = sql.match(/CHECK \(team IN \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    const allowed = check![1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
    expect(allowed).toEqual([...FUNDRAISER_TEAM_SLUGS].sort())
  })
})
