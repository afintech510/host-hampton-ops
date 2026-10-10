import fs from 'fs'
import path from 'path'

/**
 * Source tripwires for the P04 render modules. CRLF-tolerant (the text is
 * normalised first) and comment-blind (prose cannot satisfy or trip a rule).
 * Each rule that walks a list asserts how many sites it examined.
 */

const SRC = path.join(process.cwd(), 'src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

/** Source with block and line comments blanked. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, p: string) => p)
}

const RENDER_FILES = [
  'lib/evites/render.ts',
  'lib/evites/assets.ts',
  'lib/evites/layout.ts',
  'components/evites/InviteCanvas.tsx',
  'components/evites/OgCard.tsx',
  'lib/evites/templates/types.ts',
  'lib/evites/templates/glow.ts',
  'lib/evites/templates/plain.ts',
  'lib/evites/templates/index.ts',
  'lib/evites/templates/slotText.ts',
]
const COMPONENTS = ['components/evites/InviteCanvas.tsx', 'components/evites/OgCard.tsx']

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

describe('evites render surface', () => {
  it('examines every render module (the count guards the loops)', () => {
    expect(RENDER_FILES).toHaveLength(10)
    for (const f of RENDER_FILES) expect(read(f).length).toBeGreaterThan(200)
  })

  it('no next/og, no @vercel/og, no loadAdditionalAsset: Satori is called directly with no asset loader', () => {
    for (const f of RENDER_FILES) {
      const c = code(read(f))
      expect(c).not.toMatch(/next\/og/)
      expect(c).not.toMatch(/@vercel\/og/)
      expect(c).not.toMatch(/loadAdditionalAsset/)
      expect(c).not.toMatch(/ImageResponse/)
    }
    const r = code(read('lib/evites/render.ts'))
    expect(r).toMatch(/import\('satori'\)/)
    expect(r).toMatch(/embedFont:\s*true/)
  })

  it('no module in the render path can reach the network', () => {
    for (const f of RENDER_FILES) {
      const c = code(read(f))
      expect(c).not.toMatch(/\bfetch\s*\(/)
      expect(c).not.toMatch(/from ['"](https?|net|node:https?|node:net|undici|axios|node-fetch)['"]/)
      expect(c).not.toMatch(/XMLHttpRequest/)
      expect(c).not.toMatch(/https?:\/\//) // not even a URL literal
    }
  })

  it('render.ts is the one place that talks to Supabase, and never selects *', () => {
    for (const f of RENDER_FILES) {
      const c = code(read(f))
      expect(c).not.toMatch(/select\(\s*['"`]\*['"`]/)
      if (f !== 'lib/evites/render.ts') expect(c).not.toMatch(/\.from\(\s*['"]/)
    }
  })

  it('no `.or()` with an interpolated value (AGENTS.md: .or() is a raw filter expression)', () => {
    expect(code(read('lib/evites/render.ts'))).not.toMatch(/\.or\(/)
  })

  it('every Supabase result in render.ts has its error read', () => {
    const c = code(read('lib/evites/render.ts'))
    const heads = Array.from(c.matchAll(/const (\{[^}]*\}|\w+) = await supabase\b/g))
    expect(heads.length).toBeGreaterThanOrEqual(8) // evite, booking, payments, claim x2, upload, finalize, ...
    let examined = 0
    for (const m of heads) {
      const name = m[1]
      const after = c.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 900)
      if (name.startsWith('{')) expect(after).toMatch(/if \(error\)/)
      else expect(after).toContain(`${name}.error`)
      examined++
    }
    expect(examined).toBe(heads.length)
  })

  it('the claim, the finalize and the release are all conditional on the claim token', () => {
    const c = code(read('lib/evites/render.ts'))
    expect(c).toMatch(/\.is\('render_claim', null\)/)
    expect(c).toMatch(/\.lt\('render_claimed_at', staleBefore\)/)
    // finalize and release both filter on OUR token
    const eqToken = c.match(/\.eq\('render_claim', token\)/g) ?? []
    expect(eqToken.length).toBe(2)
    // and each conditional update is read back with .select('id')
    expect((c.match(/\.select\('id'\)/g) ?? []).length).toBe(3)
  })

  it('uploads are write-once with a year of cache', () => {
    const c = code(read('lib/evites/render.ts'))
    expect(c).toMatch(/\{ contentType: 'image\/jpeg', cacheControl: '31536000', upsert: false \}/)
    expect(c).not.toMatch(/upsert:\s*true/)
    expect(c).toMatch(/randomBytes\(16\)/) // image_key
    expect(c).toMatch(/randomBytes\(2\)/) // per-attempt suffix
  })

  it('the 300,000-byte assert is there and fails with og-too-large before anything is uploaded', () => {
    const c = code(read('lib/evites/render.ts'))
    expect(c).toMatch(/OG_MAX_BYTES\s*=\s*300_000/)
    const check = c.indexOf("throw new RenderFailure('og-too-large')")
    const upload = c.indexOf('.upload(')
    expect(check).toBeGreaterThan(0)
    expect(upload).toBeGreaterThan(check)
  })

  it('every image-bound string is screened, and every size comes from fit.ts', () => {
    const layout = code(read('lib/evites/layout.ts'))
    expect((layout.match(/screenForImage\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(layout).toMatch(/fitFontSize\(/)
    for (const f of COMPONENTS) expect(code(read(f))).not.toMatch(/screenForImage|opentype|from 'fs'/)
  })

  it('the components are pure: no hooks, no client directive, no server-only imports', () => {
    for (const f of COMPONENTS) {
      // a type-only import is erased at build time and carries nothing server-side
      const c = code(read(f)).replace(/^import type [^\n]*\n/gm, '')
      expect(c).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Memo|Callback|Context|Reducer|Id)\b/)
      expect(read(f)).not.toMatch(/['"]use client['"]/)
      expect(c).not.toMatch(/@\/lib\/evites\/(render|assets|glyphs|fit|layout|hash|state|ensure)['"]/)
      expect(c).not.toMatch(/from ['"](fs|path|sharp|satori)['"]/)
    }
  })

  it('no client component imports render-side code (it reads the disk and bundles wasm)', () => {
    const files = walk(SRC)
    const clients = files.filter((f) => /^\s*['"]use client['"]/m.test(fs.readFileSync(f, 'utf8')))
    expect(files.length).toBeGreaterThan(200)
    expect(clients.length).toBeGreaterThan(20)
    for (const f of clients) {
      const c = code(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
      expect(c).not.toMatch(/@\/lib\/evites\/(render|assets|glyphs|fit|layout)['"]/)
    }
  })

  it('no module under lib/evites or components/evites uses a local-time Date setter', () => {
    for (const f of [...RENDER_FILES]) {
      expect(read(f)).not.toMatch(/setHours|\.setDate\(|\.setMonth\(/)
    }
  })
})
