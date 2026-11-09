/**
 * The planner's add-on menus (food, desserts, drinks, decor...) on a phone.
 *
 * Measured on production at 375px: every add-on card was 734px wide and its price sat at x=733,
 * off the screen. The grid was `grid sm:grid-cols-2` with no column set below `sm`, so the column
 * is `auto`-sized and the no-wrap `truncate` description made it as wide as the longest line of
 * text. `grid-cols-1` is `minmax(0, 1fr)`: the column can never be wider than its container.
 */
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe.each([
  ['app/party-builder/PartyBuilderContent.tsx'],
  ['app/kids-party-menu/KidsPartyMenuContent.tsx'],
])('%s add-on menus', file => {
  const src = read(file)

  it('both add-on grids give a phone one column that cannot outgrow the screen', () => {
    for (const name of ['AddOnGrid', 'AddOnGridWithQty']) {
      const at = src.indexOf(`function ${name}(`)
      expect(at).toBeGreaterThan(-1)
      const body = src.slice(at, src.indexOf('\n}\n', at))
      expect(body).toMatch(/className="grid grid-cols-1 sm:grid-cols-2 gap-3"/)
    }
  })

  it('both cards may shrink below their text, so the price stays beside the name', () => {
    for (const name of ['SelectableAddOnCard', 'SelectableAddOnCardWithQty']) {
      const at = src.indexOf(`function ${name}(`)
      expect(at).toBeGreaterThan(-1)
      const body = src.slice(at, src.indexOf('\n}\n', at))
      // On the card's own outer element: the inner text wrapper already has min-w-0 and is not the fix.
      expect(body).toMatch(name === 'SelectableAddOnCard' ? /<button type="button" onClick=\{onClick\}\s+className=\{`text-left min-w-0 / : /<div className=\{`min-w-0 rounded-xl /)
      // The price is the part that must never be pushed off or wrapped away.
      expect(body).toMatch(/shrink-0[\s\S]{0,200}whitespace-nowrap/)
    }
  })
})
