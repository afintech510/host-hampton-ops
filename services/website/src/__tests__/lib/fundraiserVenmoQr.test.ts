import fs from 'fs'
import path from 'path'
import { FUNDRAISER_TEAMS } from '@/lib/fundraiserTeams'

/**
 * Where a parent's money goes, checked in the three places it is written.
 *
 * A QR code is the one thing on the order page nobody can proofread, so the
 * defence is that it is GENERATED from a string, and that string, the handle in
 * the markup and the handle in the confirmation email are all the same value.
 * These tests read the actual files rather than trusting the comments in them.
 */

const websiteRoot = path.resolve(__dirname, '../../..')
const qrScript = path.join(websiteRoot, 'scripts', 'build-venmo-qr.mjs')
const pageFile = path.join(websiteRoot, 'src', 'app', 'esm-sharks', 'page.tsx')
const qrPng = path.join(websiteRoot, 'public', 'images', 'esm-venmo-qr.png')

const team = FUNDRAISER_TEAMS['esm-sharks']

/** Read as text, tolerating CRLF — the repo checks out with native line endings. */
function read(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

describe('the ESM Sharks Venmo account', () => {
  it('is the PTO, not the Host Hampton placeholder', () => {
    expect(team.venmoHandle).toBe('@Eastport-tuttlepto-1')
    expect(team.venmoHandle.toLowerCase()).not.toContain('hosthampton')
    expect(team.venmoUrl.toLowerCase()).not.toContain('hosthampton')
    expect(team.venmoEmailHandle.toLowerCase()).not.toContain('hosthampton')
  })

  it('names the same account on the page and in the email', () => {
    // CM Cheer's two disagree and nobody knows which is right. This one must not
    // be allowed to drift into the same state.
    expect(team.venmoEmailHandle).toBe(team.venmoHandle)
  })

  it('builds its URL from its own handle', () => {
    expect(team.venmoUrl).toBe(`https://www.venmo.com/u/${team.venmoHandle.replace(/^@/, '')}`)
  })
})

describe('the generated QR code', () => {
  it('encodes exactly the URL the team record names', () => {
    const src = read(qrScript)
    const match = src.match(/^const VENMO_URL = '([^']+)'$/m)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(team.venmoUrl)
  })

  it('has actually been generated', () => {
    expect(fs.existsSync(qrPng)).toBe(true)
    // A truncated or zero-byte PNG still "exists"; check it is a real one.
    const buf = fs.readFileSync(qrPng)
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  /**
   * The committed image IS the code for the current handle — not a leftover from
   * a previous one, and not something pasted in by hand.
   *
   * Nobody can proofread a QR, so this re-renders it and compares bytes. The
   * options below must match `build-venmo-qr.mjs`; if you change them there,
   * change them here, and the failure in between is the point — it forces a
   * human to look at the one thing on the page that decides where money goes.
   */
  it('is byte-identical to a fresh render of that URL', async () => {
    const QRCode = require('qrcode')
    const fresh: Buffer = await QRCode.toBuffer(team.venmoUrl, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 512,
      color: { dark: '#0C2340', light: '#FFFFFF' },
    })
    expect(fresh.equals(fs.readFileSync(qrPng))).toBe(true)
  })

  it('is NOT the code for the old placeholder account', async () => {
    // Proves the comparison above can actually fail: a QR for a different
    // handle must not match the committed bytes.
    const QRCode = require('qrcode')
    const placeholder: Buffer = await QRCode.toBuffer('https://www.venmo.com/u/hostHampton', {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 512,
      color: { dark: '#0C2340', light: '#FFFFFF' },
    })
    expect(placeholder.equals(fs.readFileSync(qrPng))).toBe(false)
  })
})

describe('the order page holds no handle of its own', () => {
  /**
   * Counts what it examined rather than asserting on one lucky match: a guard
   * that silently inspects nothing passes forever.
   */
  it('contains no hardcoded venmo URL or @handle', () => {
    const src = read(pageFile)
    expect(src.length).toBeGreaterThan(1000)

    const urls = src.match(/venmo\.com\/u\/[A-Za-z0-9_-]+/g) || []
    expect(urls).toEqual([])

    // Any @handle literal in the markup, including the old placeholder.
    const handles = src.match(/['">]@[A-Za-z][A-Za-z0-9_-]{2,}/g) || []
    expect(handles).toEqual([])

    expect(src.toLowerCase()).not.toContain('hosthampton')
  })

  it('reads the account from the team record', () => {
    const src = read(pageFile)
    expect(src).toContain("FUNDRAISER_TEAMS['esm-sharks']")
    // Both the link and the visible handle must come from it.
    expect(src).toContain('TEAM.venmoUrl')
    expect(src).toContain('TEAM.venmoHandle')
  })
})
