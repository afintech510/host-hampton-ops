/**
 * scripts/cron/jobs.tsv is the one place a schedule lives. These rules keep it
 * honest: a row pointing at a route that no longer exists is a 404 nobody sees
 * (the draft-newsletter / booking-locks lesson), and the dangerous jobs must not
 * be scheduled by a stray edit.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..')
const rows = fs
  .readFileSync(path.join(ROOT, 'scripts', 'cron', 'jobs.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => {
    const [name, schedule, p, maxAge, mode] = l.split('|')
    return { name, schedule, path: p, maxAge: Number(maxAge), mode }
  })

describe('cron manifest', () => {
  it('has rows, and every row is well-formed', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8)
    for (const r of rows) {
      expect(r.schedule.trim().split(/\s+/)).toHaveLength(5)
      expect(['box', 'cutover']).toContain(r.mode)
      expect(r.maxAge).toBeGreaterThan(0)
      expect(r.path.startsWith('/api/cron/')).toBe(true)
    }
  })

  it('every row names a route that exists', () => {
    for (const r of rows) {
      const dir = r.path.replace('/api/cron/', '').split('?')[0]
      expect(fs.existsSync(path.join(ROOT, 'services/website/src/app/api/cron', dir, 'route.ts'))).toBe(true)
    }
  })

  it('names are unique and paths are unique', () => {
    expect(new Set(rows.map(r => r.name)).size).toBe(rows.length)
    expect(new Set(rows.map(r => r.path)).size).toBe(rows.length)
  })

  it('never schedules the jobs that need a human decision', () => {
    const forbidden = ['process-sequences', 'send-campaigns', 'draft-newsletter', 'social-calendar',
      'weekly-town-drafts', 'birthday-rebooking', 'agent-distill', 'experiment-report']
    for (const r of rows) {
      for (const f of forbidden) expect(r.path).not.toContain(f)
    }
  })
})
