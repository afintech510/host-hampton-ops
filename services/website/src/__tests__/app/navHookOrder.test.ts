/**
 * Nav lives in the root layout, so it survives a client-side navigation. If it
 * returns early before one of its hooks, a <Link> into or out of the hidden
 * routes changes the hook count and React throws — which is how the invoice
 * page's "Edit plan" link crashed on every plan ("Application error: a
 * client-side exception has occurred").
 *
 * Rule: no `return` may appear in Nav's body before its last hook call.
 *
 * EVITE (spec §7.1): the same hazard now applies to every component of the site
 * chrome that hides itself on `/i/<slug>` or `/my-booking/invitation`. Each one
 * lives in the root layout, so each one must call ALL its hooks before ANY
 * early return — and a guest arriving by a client-side navigation is exactly
 * the case that would crash. The rules below are read off the component SOURCE,
 * and each asserts the gate it relies on is really there (a rule that finds no
 * gate would pass for the wrong reason).
 */
import fs from 'fs'
import path from 'path'

const COMPONENTS_DIR = path.join(process.cwd(), 'src', 'components')

function read(file: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8')
}

/**
 * The body of `export default function <name>(...) { ... }`, brace-matched from
 * the end of its PARAMETER LIST (AGENTS.md: matching from the name finds the
 * default value in `(opts = {})`). Returns '' if not found, and every caller
 * asserts it is not.
 */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export default function ${name}(`)
  if (start < 0) return ''
  let i = src.indexOf('(', start)
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const open = src.indexOf('{', i)
  if (open < 0) return ''
  depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, j)
    }
  }
  return ''
}

/** Index of the last hook call in a body, and how many there are. */
function hooksOf(body: string): { last: number; count: number } {
  const hooks = Array.from(body.matchAll(/\buse[A-Z]\w*\s*\(/g))
  return { last: hooks[hooks.length - 1]?.index ?? -1, count: hooks.length }
}

/**
 * Top-level early returns only: a line indented exactly two spaces is the
 * component's own body, not a cleanup `return` inside an effect. CRLF-safe.
 */
function firstTopLevelReturn(body: string): number {
  return body.search(/^  (if\s*\([^\r\n]*\)\s*)?return\b/m)
}

describe('Nav hook order', () => {
  const src = read('Nav.tsx')
  const body = bodyOf(src, 'Nav')
  const { last: lastHook, count } = hooksOf(body)
  const firstReturn = firstTopLevelReturn(body)

  it('finds the component, its hooks and its hidden-route return', () => {
    expect(body).not.toBe('')
    expect(count).toBeGreaterThanOrEqual(3)
    expect(body).toMatch(/pathname === '\/party-planner'[^\r\n]*return null/)
  })

  it('does not return before its last hook', () => {
    expect(firstReturn).toBeGreaterThan(lastHook)
  })

  it('hides itself on an invitation, in that same return', () => {
    expect(body).toMatch(/pathname === '\/party-planner'[^\r\n]*isInvitePath\(pathname\)\) return null/)
    expect(src).toMatch(/from '@\/lib\/evites\/chrome'/)
  })
})

describe('the other chrome components hide on /i/ with the hook order intact', () => {
  /** [file, component, hooks it must have at least, the early-return gate]. */
  const RETURNING: Array<[string, string, number, RegExp]> = [
    ['Footer.tsx', 'Footer', 1, /^  if \(isInvitePath\(pathname\)\) return null/m],
    ['BenchworksAttribution.tsx', 'BenchworksAttribution', 1, /^  if \(isInvitePath\(pathname\)\) return null/m],
  ]

  it.each(RETURNING)('%s: gate present, after every hook, and it is a client component', (file, name, minHooks, gate) => {
    const src = read(file)
    expect(src.startsWith("'use client'")).toBe(true) // usePathname is a client hook
    const body = bodyOf(src, name)
    expect(body).not.toBe('')
    const { last, count } = hooksOf(body)
    expect(count).toBeGreaterThanOrEqual(minHooks)
    const gateAt = body.search(gate)
    expect(gateAt).toBeGreaterThan(-1) // the gate exists
    expect(gateAt).toBeGreaterThan(last) // and sits after the last hook
    expect(firstTopLevelReturn(body)).toBe(gateAt) // and it is the FIRST return
  })

  it('Footer owns the fade-out spacer, so it goes with the footer on /i/', () => {
    const body = bodyOf(read('Footer.tsx'), 'Footer')
    expect(body.indexOf('h-40 bg-gradient-to-b')).toBeGreaterThan(body.search(/isInvitePath\(pathname\)\) return null/))
    // And the root layout no longer draws one of its own.
    const layout = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8')
    expect(layout).not.toMatch(/<div className="h-40 bg-gradient-to-b/)
  })

  it('AttributionCapture skips the capture on /i/ INSIDE the effect, before it captures', () => {
    const src = read('AttributionCapture.tsx')
    const body = bodyOf(src, 'AttributionCapture')
    expect(body).not.toBe('')
    const { last, count } = hooksOf(body)
    expect(count).toBeGreaterThanOrEqual(2) // usePathname, useEffect
    const skip = body.search(/if \(isInvitePath\(pathname\)\) return\b/)
    const capture = body.search(/\bcaptureAttribution\(\)/)
    expect(skip).toBeGreaterThan(-1)
    expect(capture).toBeGreaterThan(skip)
    // Re-runs when the path changes, so a guest who walks into the site is still counted.
    expect(body).toMatch(/\[pathname\]/)
    // Its only top-level return is the final `return null`, after the hooks.
    expect(firstTopLevelReturn(body)).toBeGreaterThan(last)
  })

  it('MetaPixel: the PageView effect skips /i/ and the host page, AND the render is null, after all hooks', () => {
    const src = read('MetaPixel.tsx')
    const body = bodyOf(src, 'MetaPixel')
    expect(body).not.toBe('')
    const { last, count } = hooksOf(body)
    expect(count).toBeGreaterThanOrEqual(3) // usePathname, useRef, useEffect

    // The effect gate comes BEFORE the bootstrap bookkeeping and the PageView.
    const effectGate = body.search(/if \(isMetaPixelBlockedPath\(pathname\)\) return\s*$/m)
    const bootstrap = body.search(/bootstrapped\.current = true/)
    const track = body.search(/fbq\?\.\('track', 'PageView'\)/)
    expect(effectGate).toBeGreaterThan(-1)
    expect(bootstrap).toBeGreaterThan(effectGate)
    expect(track).toBeGreaterThan(effectGate)

    // The render gate is a top-level return AFTER the last hook.
    const renderGate = body.search(/^  if \(isMetaPixelBlockedPath\(pathname\)\) return null/m)
    expect(renderGate).toBeGreaterThan(last)
    expect(firstTopLevelReturn(body)).toBeLessThan(renderGate) // the `!META_PIXEL_ID` return precedes it
    expect(firstTopLevelReturn(body)).toBeGreaterThan(last) // ...and is itself after every hook
  })

  it('the pixel is blocked on both paths the spec names, and only those', () => {
    const chrome = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'evites', 'chrome.ts'), 'utf8')
    expect(chrome).toMatch(/startsWith\('\/i\/'\)/)
    expect(chrome).toMatch(/'\/my-booking\/invitation'/)
  })

  it('GoogleAnalytics has no early return before its hook (the /i/ branch is inside the script)', () => {
    const src = read('GoogleAnalytics.tsx')
    const body = bodyOf(src, 'GoogleAnalytics')
    expect(body).not.toBe('')
    const { last, count } = hooksOf(body)
    expect(count).toBe(1)
    expect(firstTopLevelReturn(body)).toBeGreaterThan(last)
    expect(body).toMatch(/gaInitScript\(\{[^}]*pathname/)
  })
})
