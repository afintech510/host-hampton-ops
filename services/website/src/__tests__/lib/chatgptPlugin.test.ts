/**
 * The ChatGPT directory package (integrations/chatgpt-plugin), held to OpenAI's
 * published limits and to the tools that really exist, so a renamed tool cannot
 * quietly invalidate a test case a reviewer will run.
 */
import fs from 'fs'
import path from 'path'

jest.mock('@/app/api/lead/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/llms.txt/route', () => ({ GET: jest.fn() }))
jest.mock('@/app/api/availability/route', () => ({ GET: jest.fn() }))
jest.mock('@/app/api/events/route', () => ({ GET: jest.fn() }))
jest.mock('@/lib/mcp/readers', () => ({}))

import { GET as challenge } from '@/app/.well-known/openai-apps-challenge/route'
import { listTools } from '@/lib/mcp/server'

const DIR = path.join(process.cwd(), '..', '..', 'integrations', 'chatgpt-plugin')
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'))
const openai = manifest.extensions['com.openai']
const listing = openai.interface

describe('the listing', () => {
  it('fits the limits', () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(listing.displayName.length).toBeLessThanOrEqual(30)
    expect(listing.shortDescription.length).toBeLessThanOrEqual(30)
    expect(listing.longDescription.length).toBeLessThanOrEqual(4000)
    expect(listing.developerName.length).toBeLessThanOrEqual(80)
    expect(listing.defaultPrompt.length).toBeLessThanOrEqual(3)
    for (const p of listing.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128)
    for (const k of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) expect(listing[k]).toMatch(/^https:\/\//)
  })

  it('advertises no price and carries the logo it names', () => {
    const copy = [listing.displayName, listing.shortDescription, listing.longDescription, ...listing.defaultPrompt].join(' ')
    expect(copy).not.toMatch(/\$\d|discount|promo|free trial/i)
    expect(fs.existsSync(path.join(DIR, listing.logo))).toBe(true)
  })

  it('declares one server, at the public URL, with no headers', () => {
    const servers = JSON.parse(fs.readFileSync(path.join(DIR, 'mcp.json'), 'utf8')).mcpServers
    const all = Object.values(servers) as { url: string; headers?: unknown }[]
    expect(all).toHaveLength(1)
    expect(all[0].url).toMatch(/^https:\/\/.+\/api\/mcp$/)
    expect(all[0].headers).toBeUndefined()
  })
})

describe('the review cases', () => {
  const cases = openai.review.test_cases

  it('are exactly five positive and three negative, complete', () => {
    expect(cases.positive).toHaveLength(5)
    expect(cases.negative).toHaveLength(3)
    for (const c of cases.positive) for (const k of ['description', 'prompt', 'expected_behavior']) expect(c[k]).toBeTruthy()
    for (const c of cases.negative) for (const k of ['description', 'prompt']) expect(c[k]).toBeTruthy()
  })

  it('name only tools the server lists, and no positive case fires a real inquiry at the reviewer', () => {
    const tools = listTools({} as NodeJS.ProcessEnv).map(t => t.name)
    for (const c of cases.positive) {
      expect(c.tools_triggered.length).toBeGreaterThan(0)
      for (const t of c.tools_triggered) expect(tools).toContain(t)
      expect(c.tools_triggered).not.toContain('start_inquiry')
    }
  })
})

describe('/.well-known/openai-apps-challenge', () => {
  const env = process.env.OPENAI_APPS_CHALLENGE
  afterEach(() => { process.env.OPENAI_APPS_CHALLENGE = env })

  it('is the bare token as plain text, and 404 on every day it is not set', async () => {
    delete process.env.OPENAI_APPS_CHALLENGE
    expect((await challenge()).status).toBe(404)
    process.env.OPENAI_APPS_CHALLENGE = ' tok-123 \n'
    const res = await challenge()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('tok-123')
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
  })
})
