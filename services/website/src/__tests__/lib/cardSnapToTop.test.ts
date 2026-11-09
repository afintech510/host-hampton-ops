/**
 * An opened card (lead, booking, crew member) is brought to the top of the screen, under the sticky menu,
 * after the previously open card has closed. The arithmetic is `snapTarget`; the wiring is read off disk.
 */
import fs from 'fs'
import path from 'path'
import { snapTarget } from '@/app/admin/crew/_components/useSnapToTop'

const SRC = path.join(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

describe('snapTarget', () => {
  it('puts the card top just under the menu', () => {
    // Card is 600px down the viewport, page scrolled 1000, menu 64px tall, 8px gap.
    expect(snapTarget(600, 1000, 64)).toBe(1528)
  })

  it('works when the card is above the viewport (scrolled past it)', () => {
    expect(snapTarget(-300, 1000, 64)).toBe(628)
  })

  it('never asks for a negative scroll', () => {
    expect(snapTarget(10, 0, 64)).toBe(0)
  })

  it('treats a missing menu as zero height', () => {
    expect(snapTarget(200, 100, 0)).toBe(292)
  })
})

describe('the hook is wired to every expandable card', () => {
  it('measures in a layout effect, only when open, against the sticky bar', () => {
    const h = read('app/admin/crew/_components/useSnapToTop.ts')
    expect(h).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!open\) return/)
    expect(h).toContain('[data-crew-admin-bar]')
    expect(h).toContain('window.scrollTo')
    expect(read('app/admin/crew/_components/CrewAdminBar.tsx')).toContain('data-crew-admin-bar')
  })

  it('PartyTile (every Lead and Booking card) uses it on its article', () => {
    const t = read('app/admin/crew/_components/PartyTile.tsx')
    expect(t).toMatch(/useSnapToTop\(cardRef, open\)/)
    expect(t).toMatch(/<article\s+ref=\{cardRef\}/)
  })

  it('the Staff card uses it on its outer element', () => {
    const m = read('app/admin/crew/members/page.tsx')
    expect(m).toMatch(/useSnapToTop\(cardRef, open\)/)
    expect(m).toMatch(/<div ref=\{cardRef\} className=\{`bg-white rounded-2xl shadow-sm/)
  })
})
