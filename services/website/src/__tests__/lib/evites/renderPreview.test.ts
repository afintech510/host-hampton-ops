import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { renderEvite } from '@/lib/evites/render'
import { makeFakeEviteDb } from '../../helpers/fakeEviteDb'
import { NOW, tablesFor } from '../../helpers/eviteFixtures'

/**
 * Renders the review images through the REAL path (`renderEvite` -> InviteCanvas
 * satori mode -> sharp). Always asserts the sizes; writes the files only when
 * EVITE_PREVIEW_DIR is set:
 *
 *   EVITE_PREVIEW_DIR=scripts/evite-spike/out-p04 npx jest renderPreview
 */

// A render is ~2-3 s of librsvg, and the whole suite runs in parallel.
jest.setTimeout(90_000)

const DIR = process.env.EVITE_PREVIEW_DIR

const VARIANTS: Record<string, Record<string, unknown>> = {
  mia: { child_name: 'Mia' },
  noname: { child_name: null },
  longname: { child_name: 'Alexandria-Rose' },
}

describe('evites render preview (the real pipeline)', () => {
  beforeAll(() => {
    process.env.EVITES_PAGES = 'on'
    if (DIR) fs.mkdirSync(path.resolve(DIR), { recursive: true })
  })

  it.each(Object.keys(VARIANTS))('%s: renders a 1085x1530 portrait and a 1200x630 OG card', async (key) => {
    const db = makeFakeEviteDb({ tables: tablesFor({ booking: VARIANTS[key] }) })
    const t0 = Date.now()
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    const ms = Date.now() - t0
    expect(out.kind).toBe('rendered')
    const [invite, og] = Array.from(db.uploaded.values())
    const im = await sharp(invite).metadata()
    const om = await sharp(og).metadata()
    expect([im.width, im.height, im.channels]).toEqual([1085, 1530, 3])
    expect([om.width, om.height, om.channels]).toEqual([1200, 630, 3])
    expect(og.length).toBeLessThan(300_000)
    // eslint-disable-next-line no-console
    console.log(`[preview ${key}] ${ms} ms, invite ${invite.length} B, og ${og.length} B`)
    if (DIR) {
      fs.writeFileSync(path.resolve(DIR, `p04_invite_${key}.jpg`), invite)
      fs.writeFileSync(path.resolve(DIR, `p04_og_${key}.jpg`), og)
    }
  })
})
