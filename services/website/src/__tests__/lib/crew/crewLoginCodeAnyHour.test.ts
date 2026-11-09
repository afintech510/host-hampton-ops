/**
 * The crew sign-in code text goes out at any hour (Adam, 2026-11-08: "allow login sms codes to go out 24/7").
 * It is a reply to something the person just asked for on the login page, so quiet hours (8am-9pm ET) never apply.
 * When no code arrives, the log says why: the request route answers { ok: true } to every refusal.
 */
import fs from 'fs'
import path from 'path'
import { sendLoginCodeSms, type CrewSenders } from '@/lib/crew/notify'

const SRC = path.join(__dirname, '..', '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

function senders(): { s: CrewSenders; texts: Array<{ to: string; body: string }> } {
  const texts: Array<{ to: string; body: string }> = []
  const s: CrewSenders = {
    sms: async (to, body) => { texts.push({ to, body }); return 'QUOtest' },
    email: async () => ({ kind: 'sent' }) as any,
  }
  return { s, texts }
}

describe('sendLoginCodeSms at every hour', () => {
  afterEach(() => jest.useRealTimers())

  // ET is UTC-5 in November: the box runs UTC, so these are 3am, 7am, 10:45pm and midnight Eastern.
  const HOURS = ['2026-11-09T08:00:00Z', '2026-11-09T12:00:00Z', '2026-11-09T03:45:00Z', '2026-11-09T05:00:00Z']

  it.each(HOURS)('texts the code at %s', async (iso) => {
    jest.useFakeTimers().setSystemTime(new Date(iso))
    const { s, texts } = senders()
    await expect(sendLoginCodeSms('+16315550123', '123456', s)).resolves.toBe(true)
    expect(texts).toHaveLength(1)
    expect(texts[0].to).toBe('+16315550123')
    expect(texts[0].body).toContain('123456')
  })

  it('reports a Quo failure as not sent, whatever the hour', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-09T03:45:00Z'))
    const { s } = senders()
    s.sms = async () => null
    await expect(sendLoginCodeSms('+16315550123', '123456', s)).resolves.toBe(false)
  })

  it('neither the sender nor the request route consults quiet hours', () => {
    const route = read('app/api/crew/auth/request/route.ts')
    expect(route).not.toMatch(/from '@\/lib\/quietHours'|checkSmsQuietHours\(/)
    const notify = read('lib/crew/notify.ts')
    const i = notify.indexOf('export async function sendLoginCodeSms(')
    expect(i).toBeGreaterThan(-1)
    // The function's own body: up to its closing brace at column 0 (not the next function's doc comment).
    const body = notify.slice(i, notify.slice(i).search(/\r?\n\}\r?\n/) + i)
    expect(body.length).toBeGreaterThan(100)
    expect(body).not.toMatch(/checkSmsQuietHours|quiet/i)
  })
})

describe('a refusal that answers { ok: true } is logged with its reason', () => {
  const route = read('app/api/crew/auth/request/route.ts')

  it('every silent exit calls noCode first, and the log names no number or address', () => {
    expect(route).toMatch(/function noCode\(reason: string, channel: 'email' \| 'phone'\)/)
    // not on the roster / may not enter, no destination, the in-memory limit, the hourly cap.
    expect(route.match(/\bnoCode\(/g)?.length).toBe(5)
    for (const call of route.matchAll(/noCode\(([^\r\n]*)\)/g)) {
      expect(call[1]).not.toMatch(/identity\.(phone|email|key)|destination/)
    }
  })

  it('every { ok: true } refusal before the code is stored is preceded by a noCode in the same block', () => {
    const lines = route.split(/\r?\n/)
    const refusals = lines.map((l, i) => (/return NextResponse\.json\(\{ ok: true \}\)/.test(l) ? i : -1)).filter(i => i >= 0)
    // The five refusals, then the three success returns after the code is sent.
    const early = refusals.filter(i => lines.slice(0, i).join('\n').lastIndexOf('const secret = portalSigningSecret()') < 0)
    expect(early).toHaveLength(4)
    for (const i of early) {
      expect(lines.slice(Math.max(0, i - 3), i).join('\n')).toMatch(/noCode\(/)
    }
  })
})
