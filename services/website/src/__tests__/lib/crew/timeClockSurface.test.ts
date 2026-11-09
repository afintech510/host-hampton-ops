import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

describe('time clock surface', () => {
  it('TC1: the crew API checks the member has a time clock before doing anything, and answers 404 otherwise', () => {
    const src = read('app/api/crew/time/route.ts')
    expect((src.match(/loadClockMember\(/g) ?? []).length).toBe(2)
    expect((src.match(/if \(!cm\.data\) return notFound\(\)/g) ?? []).length).toBe(2)
  })

  it('TC2: a punch needs the accepted notice, and a location problem never refuses it', () => {
    const src = read('app/api/crew/time/route.ts')
    expect(src).toMatch(/if \(!cm\.data\.noticeAccepted\) return NextResponse\.json\([^)]*needsNotice: true[^)]*409/)
    const lib = read('lib/crew/timeClock.ts')
    // The punch writers take a Fix of any status; nothing branches on it to refuse.
    expect(lib).not.toMatch(/fix\.status\s*[!=]==?\s*'ok'\)\s*return\s*\{\s*kind:\s*'error'/)
  })

  it('TC3: every admin time route opens with the admin check', () => {
    for (const f of ['app/api/admin/crew/time/route.ts', 'app/api/admin/crew/time/punches/route.ts']) {
      const src = read(f)
      const handlers = src.match(/export async function (GET|PUT|PATCH|POST)/g) ?? []
      expect(handlers.length).toBeGreaterThan(0)
      expect((src.match(/if \(!isAdminAuthorized\(req\)\) return unauthorizedResponse\(\)/g) ?? []).length).toBe(handlers.length)
    }
  })

  it('TC4: the crew side never shows location or network detail', () => {
    for (const f of ['app/api/crew/time/route.ts', 'app/crew/time/page.tsx', 'app/crew/_components/TimeClockCard.tsx']) {
      expect(read(f)).not.toMatch(/in_lat|out_lat|_ip\b|on_studio_network|_distance_m/)
    }
  })

  it('TC5: the migration is service-role only and keeps one open shift per person', () => {
    const sql = fs.readFileSync(path.join(SRC, '..', '..', '..', 'starting_plan', 'migration_094_crew_time_clock.sql'), 'utf8')
    expect(sql).toMatch(/uq_crew_time_one_open[\s\S]*WHERE punched_out_at IS NULL/)
    expect(sql).toMatch(/'crew_time_clock_members', 'crew_time_punches', 'crew_time_config'/)
    expect(sql).toMatch(/REVOKE ALL ON public\.%I FROM anon, authenticated/)
  })
})
