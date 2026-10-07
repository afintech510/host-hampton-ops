/**
 * Nav lives in the root layout, so it survives a client-side navigation. If it
 * returns early before one of its hooks, a <Link> into or out of the hidden
 * routes changes the hook count and React throws — which is how the invoice
 * page's "Edit plan" link crashed on every plan ("Application error: a
 * client-side exception has occurred").
 *
 * Rule: no `return` may appear in Nav's body before its last hook call.
 */
import fs from 'fs'
import path from 'path'

const NAV = path.join(process.cwd(), 'src', 'components', 'Nav.tsx')

describe('Nav hook order', () => {
  const src = fs.readFileSync(NAV, 'utf8')
  const start = src.indexOf('export default function Nav(')
  const body = src.slice(src.indexOf('{', src.indexOf(')', start)) + 1)
  const hooks = [...body.matchAll(/\buse[A-Z]\w*\s*\(/g)]
  const lastHook = hooks[hooks.length - 1]?.index ?? -1
  // Top-level early returns only: a line indented exactly two spaces is Nav's
  // own body, not the cleanup `return` inside an effect.
  const firstReturn = body.search(/^  (if\s*\([^\r\n]*\)\s*)?return\b/m)

  it('finds the component, its hooks and its hidden-route return', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(hooks.length).toBeGreaterThanOrEqual(3)
    expect(body).toMatch(/pathname === '\/party-planner'[^\r\n]*return null/)
  })

  it('does not return before its last hook', () => {
    expect(firstReturn).toBeGreaterThan(lastHook)
  })
})
