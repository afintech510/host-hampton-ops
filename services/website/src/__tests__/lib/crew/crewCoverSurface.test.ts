/**
 * Backing out of a committed spot is discouraged (Adam, 2026-11-05), and the
 * pieces that make that true are structural, so they are pinned off disk:
 *
 *   - there is no Undo: no button, no route, no rule that decides one;
 *   - a spot is taken only after a dialog the person confirms, never by one tap;
 *   - "Find Cover" reads first and writes only when the person confirms;
 *   - the read route writes nothing and the release route has no instant release.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8')
const squash = (s: string) => s.replace(/\s+/g, ' ')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('no Undo', () => {
  it('has no unclaim route', () => {
    expect(fs.existsSync(path.join(SRC, 'app', 'api', 'crew', 'unclaim'))).toBe(false)
  })

  it('names no undo anywhere in the crew app or its library', () => {
    const files = [...walk(path.join(SRC, 'app', 'crew')), ...walk(path.join(SRC, 'app', 'api', 'crew')), ...walk(path.join(SRC, 'lib', 'crew'))]
    const offenders = files.filter(f => /crew\/unclaim|canUndo|\bUndo\b/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(SRC, f))
    expect(files.length).toBeGreaterThanOrEqual(60)
    expect(offenders).toEqual([])
  })
})

describe('Commit to Party', () => {
  const card = squash(read('app', 'crew', '_components', 'PartyCard.tsx'))
  const commit = squash(read('app', 'crew', '_components', 'CommitButton.tsx'))

  it('the card offers "Commit to Party" through the dialog, and the old labels are gone', () => {
    expect(card).toMatch(/<CommitButton /)
    expect(card).toMatch(/Commit to Party\$\{s\.role === 'lead' \? ' as Party Lead' : ''\}/)
    expect(card).not.toMatch(/Take a crew spot|Take the Lead spot|Taking it/)
  })

  it('the card never posts a claim itself', () => {
    expect(card).not.toMatch(/endpoint="\/api\/crew\/claim"/)
  })

  it('the button only opens the dialog; the claim is posted from the confirm button alone', () => {
    // The trigger: opens, nothing else.
    expect(commit).toMatch(/className="crew-btn" onClick=\{\(\) => \{ setError\(null\); setOpen\(true\) \}\}/)
    // The claim call lives inside commit(), and commit() is wired to exactly one control.
    const fn = commit.slice(commit.indexOf('async function commit()'), commit.indexOf('return ('))
    expect(fn).toMatch(/fetch\('\/api\/crew\/claim'/)
    expect(commit.match(/fetch\(/g)).toHaveLength(1)
    expect(commit.match(/onClick=\{commit\}/g)).toHaveLength(1)
    expect(commit).toMatch(/can&apos;t just remove yourself/)
  })
})

describe('Find Cover', () => {
  const fc = squash(read('app', 'crew', '_components', 'FindCover.tsx'))

  it('the first button only reads; the release is posted from send(), behind the confirm button', () => {
    expect(fc).toMatch(/<button type="button" className="crew-btn crew-btn-ghost" onClick=\{show\}>Find Cover<\/button>/)
    const showFn = fc.slice(fc.indexOf('async function show()'), fc.indexOf('async function send()'))
    expect(showFn).toMatch(/\/api\/crew\/slots\/\$\{props\.slotId\}\/cover/)
    expect(showFn).not.toMatch(/method: 'POST'|\/release/)
    const sendFn = fc.slice(fc.indexOf('async function send()'), fc.indexOf('const close'))
    expect(sendFn).toMatch(/\/release`/)
    expect(fc.match(/onClick=\{send\}/g)).toHaveLength(1)
    expect(fc.match(/\/release`/g)).toHaveLength(1)
  })

  it('with nobody on the waitlist it offers no send button, only who to ask and how to reach Allie', () => {
    const none = fc.slice(fc.indexOf('standbys.length === 0 && ('))
    expect(none).toMatch(/Join the waitlist/)
    expect(none).not.toMatch(/onClick=\{send\}/)
  })

  it('is offered on a committed, upcoming spot of mine, on the party details page only', () => {
    const card = squash(read('app', 'crew', '_components', 'PartyCard.tsx'))
    expect(card).toMatch(/!linkToDetail && v\.mySlot && v\.mySlot\.status === 'assigned' && b\.upcoming && \( <FindCover /)
    // The details page renders the card without the link; the Work page renders it with.
    expect(squash(read('app', 'crew', 'parties', '[id]', 'page.tsx'))).toMatch(/<PartyCard b=\{b\} canLead=\{member\.can_lead\} linkToDetail=\{false\} \/>/)
    expect(squash(read('app', 'crew', 'page.tsx'))).not.toMatch(/linkToDetail=\{false\}/)
    expect(card.match(/<FindCover /g)).toHaveLength(1)
  })
})

describe('the whole party tile is the link to its details', () => {
  const card = squash(read('app', 'crew', '_components', 'PartyCard.tsx'))
  const layout = squash(read('app', 'crew', 'layout.tsx'))

  it('the card is marked clickable only when it links, and the title link is the one anchor', () => {
    expect(card).toMatch(/className=\{`crew-card crew-party\$\{linkToDetail \? ' crew-party-click' : ''\}`\}/)
    expect(card).toMatch(/<Link className="crew-link crew-party-link" href=\{`\/crew\/parties\/\$\{v\.id\}`\} prefetch>/)
    expect(card.match(/<Link /g)).toHaveLength(1)
  })

  it('the link stretches over the whole tile, and the buttons on it stay above and clickable', () => {
    expect(layout).toMatch(/\.crew-party\{position:relative;/)
    expect(layout).toMatch(/\.crew-party-link::after\{content:'';position:absolute;inset:0;z-index:0;/)
    expect(layout).toMatch(/\.crew-party-click \.crew-btn,\.crew-party-click button\{position:relative;z-index:1\}/)
  })

  it('keyboard focus on the link outlines the tile, not just the words', () => {
    expect(layout).toMatch(/\.crew-party-click:has\(\.crew-party-link:focus-visible\)\{outline:3px solid var\(--c-accent\)/)
  })
})

describe('the routes', () => {
  it('the cover read route changes nothing', () => {
    const src = read('app', 'api', 'crew', 'slots', '[id]', 'cover', 'route.ts')
    expect(src).toMatch(/export async function GET/)
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    expect(src).toMatch(/requireCrewMember\(req\)/)
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/)
  })

  it('the release route has no instant-release answer', () => {
    const src = read('app', 'api', 'crew', 'slots', '[id]', 'release', 'route.ts')
    expect(src).not.toMatch(/'released'/)
    expect(src).toMatch(/case 'requested'/)
  })

  it('a release is always handed to the database as a cover request', () => {
    const src = read('lib', 'crew', 'db.ts')
    const fn = src.slice(src.indexOf('export async function releaseSlot'), src.indexOf('export type DropResult'))
    expect(fn).toMatch(/p_kind: 'late_cancel'/)
    expect(fn).not.toMatch(/early_release/)
  })
})
