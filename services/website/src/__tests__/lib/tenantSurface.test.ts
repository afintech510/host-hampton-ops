/**
 * The white-label surface: `src/tenant/` is the one place a business's facts
 * live, and the count of those facts still typed out elsewhere only goes DOWN.
 *
 * T1 is a RATCHET, not a ban. There are hundreds of brand literals left in page
 * copy, and moving them is ongoing work — so the rule is that no change may add
 * one. When you move some, lower the ceiling to the new count in the same
 * commit; the failure message prints it.
 */
import fs from 'fs'
import path from 'path'
import { TENANT, featureEnabled, toEnvSuffix } from '@/tenant'
import { HOST_HAMPTON } from '@/tenant/hosthampton'
import { PAYMENT_PHONE_DISPLAY, PUBLIC_PHONE_DISPLAY, venmoHandle } from '@/lib/paymentContacts'
import { STUDIO_ADDRESS_LINE, STUDIO_PHONE_DISPLAY, STUDIO_PHONE_E164 } from '@/lib/studioLocation'
import { SITE_URL, TITLE_SUFFIX } from '@/lib/seo'
import { DEFAULT_OWNER_EMAIL } from '@/lib/ownerNotify'
import { ALLOWED_REQUEST_HOSTS } from '@/lib/publicOrigin'

const SRC = path.join(process.cwd(), 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p)
  }
  return out.sort()
}

function appFiles(): string[] {
  return walk(SRC).filter(f => {
    const rel = path.relative(SRC, f).split(path.sep)
    return !rel.includes('__tests__') && rel[0] !== 'tenant'
  })
}

/**
 * Ceilings measured 2026-11-02, after the first tenant pass (layout, Nav,
 * Footer, shared email blocks, and the constant modules). Raw occurrences,
 * comments included — a comment naming the business is copy a clone must edit
 * too.
 */
const CEILINGS: Record<string, number> = {
  'Host Hampton': 627,
  'hosthampton.com': 203,
  'hosthampton295@gmail.com': 30,
  '998-9325': 95,
  '6319989325': 42,
  '599-2469': 7,
  'Montauk H': 81,
  'instagram.com/hosthampton': 9,
  'facebook.com/hosthampton': 1,
  'host-hampton-logo': 4,
  Allie: 216,
}

describe('tenant surface', () => {
  it('T1: no change adds a hard-coded brand literal outside src/tenant/', () => {
    const files = appFiles()
    expect(files.length).toBeGreaterThan(500)
    const counts: Record<string, number> = {}
    for (const lit of Object.keys(CEILINGS)) counts[lit] = 0
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8')
      for (const lit of Object.keys(CEILINGS)) counts[lit] += s.split(lit).length - 1
    }
    const over = Object.keys(CEILINGS)
      .filter(lit => counts[lit] > CEILINGS[lit])
      .map(lit => `${lit}: ${counts[lit]} > ceiling ${CEILINGS[lit]} — read it from TENANT instead`)
    expect(over).toEqual([])
  })

  it('T2: the active tenant is chosen in exactly one file', () => {
    const importers = walk(SRC)
      .filter(f => !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter(f => path.relative(SRC, f) !== path.join('tenant', 'index.ts'))
      .filter(f => /from ['"](?:@\/tenant|\.)\/hosthampton['"]/.test(fs.readFileSync(f, 'utf8')))
    expect(importers).toEqual([])
    expect(TENANT).toBe(HOST_HAMPTON)
  })

  it('T3: the constant modules are views of the tenant, not second copies', () => {
    expect(PUBLIC_PHONE_DISPLAY).toBe(TENANT.contact.phoneDisplay)
    expect(STUDIO_PHONE_DISPLAY).toBe(TENANT.contact.phoneDisplay)
    expect(STUDIO_PHONE_E164).toBe(TENANT.contact.phoneE164)
    expect(PAYMENT_PHONE_DISPLAY).toBe(TENANT.payments.phoneDisplay)
    expect(SITE_URL).toBe(TENANT.business.siteUrl)
    expect(TITLE_SUFFIX).toBe(` | ${TENANT.business.name}`)
    expect(DEFAULT_OWNER_EMAIL).toBe(TENANT.email.ownerNotifyDefault)
    expect(ALLOWED_REQUEST_HOSTS).toContain(TENANT.business.apexHost)
    expect(STUDIO_ADDRESS_LINE.startsWith(TENANT.location.street)).toBe(true)
  })

  it('T4: the payment number and the public line stay distinct (Venmo finds nothing on the public line)', () => {
    expect(TENANT.payments.phoneDisplay.replace(/\D/g, '')).not.toBe(TENANT.contact.phoneDigits)
    expect(TENANT.contact.phoneE164.endsWith(TENANT.contact.phoneDigits)).toBe(true)
  })

  it('T5: the Venmo handle still prefers the env', () => {
    const prev = process.env.VENMO_HANDLE
    try {
      delete process.env.VENMO_HANDLE
      expect(venmoHandle()).toBe(`@${TENANT.payments.venmoHandle}`)
      process.env.VENMO_HANDLE = '@SomeoneElse'
      expect(venmoHandle()).toBe('@SomeoneElse')
    } finally {
      if (prev === undefined) delete process.env.VENMO_HANDLE
      else process.env.VENMO_HANDLE = prev
    }
  })
})

describe('featureEnabled', () => {
  it('names the env var predictably', () => {
    expect(toEnvSuffix('publicMcpInquiry')).toBe('PUBLIC_MCP_INQUIRY')
    expect(toEnvSuffix('managerAssistant')).toBe('MANAGER_ASSISTANT')
  })

  it('defaults to the tenant file', () => {
    expect(featureEnabled('publicMcp', {} as NodeJS.ProcessEnv)).toBe(TENANT.features.publicMcp)
  })

  it('an env var can switch a feature OFF, and any value but "true" counts as off', () => {
    expect(featureEnabled('publicMcp', { FEATURE_PUBLIC_MCP: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(featureEnabled('publicMcp', { FEATURE_PUBLIC_MCP: 'yes' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(featureEnabled('publicMcp', { FEATURE_PUBLIC_MCP: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(TENANT.features.publicMcp)
  })

  it('an env var cannot grant a feature the tenant file withholds', () => {
    const was = TENANT.features.publicMcp
    try {
      TENANT.features.publicMcp = false
      expect(featureEnabled('publicMcp', { FEATURE_PUBLIC_MCP: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    } finally {
      TENANT.features.publicMcp = was
    }
  })
})
