/**
 * The build must not ask Google for fonts.
 *
 * `next/font/google` fetches every face while `next build` runs. Next 14.2.5 then reads the file
 * extension off each URL Google returns with `/\.(woff|woff2|...)$/.exec(url)[1]`, and Google
 * intermittently answers with extension-less `fonts.gstatic.com/l/font?kit=...` URLs, so the
 * build died with "TypeError: Cannot read properties of null (reading '1')" on a random deploy
 * (it hit troop2514/layout.tsx, then the crew layout). Re-running the job "fixed" it, which is
 * what made it a flake rather than a bug anyone could point at.
 *
 * Every face is now a committed file under src/fonts/ loaded with `next/font/local`
 * (scripts/fetch-fonts.mjs writes them), so the build has no network dependency at all.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')
const FONTS = path.join(SRC, 'fonts')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.next') walk(p, out)
    } else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(SRC).filter(f => !f.includes(`${path.sep}__tests__${path.sep}`))
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')

describe('fonts are files in the repo, not a build-time call to Google', () => {
  it('scans the whole source tree (a rule that reads nothing passes for the wrong reason)', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files.some(f => rel(f) === 'app/crew/layout.tsx')).toBe(true)
  })

  it('nothing imports next/font/google', () => {
    const offenders = files.filter(f => /from\s+['"]next\/font\/google['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  it('every face a layout loads exists, and is a real woff2 file', () => {
    const used: { layout: string; src: string }[] = []
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8')
      if (!/from\s+['"]next\/font\/local['"]/.test(text)) continue
      for (const m of Array.from(text.matchAll(/(?:src|path):\s*'([^']+\.woff2)'/g))) used.push({ layout: rel(f), src: path.resolve(path.dirname(f), m[1]) })
    }
    // The four layouts that use fonts: crew, admin crew, troop 2514, the trucker hat bar.
    expect(new Set(used.map(u => u.layout))).toEqual(new Set([
      'app/crew/layout.tsx', 'app/admin/crew/layout.tsx', 'app/troop2514/layout.tsx', 'app/trucker-hat-bar/layout.tsx',
    ]))
    expect(used.length).toBeGreaterThanOrEqual(17)
    for (const u of used) {
      expect({ layout: u.layout, exists: fs.existsSync(u.src) }).toEqual({ layout: u.layout, exists: true })
      // woff2 files start with the bytes "wOF2".
      expect(fs.readFileSync(u.src).subarray(0, 4).toString('latin1')).toBe('wOF2')
      expect(path.dirname(u.src)).toBe(FONTS)
    }
  })

  it('every font file in src/fonts is used by a layout, and the fetch script lists the same faces', () => {
    const onDisk = fs.readdirSync(FONTS).filter(n => n.endsWith('.woff2')).sort()
    const layoutText = files.filter(f => /layout\.tsx$/.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n')
    for (const n of onDisk) expect({ n, used: layoutText.includes(n) }).toEqual({ n, used: true })
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'fetch-fonts.mjs'), 'utf8')
    const stems = Array.from(script.matchAll(/stem: '(\w+)'/g)).map(m => m[1])
    expect(stems.length).toBe(15)
    for (const s of stems) expect({ s, has: onDisk.some(n => n.startsWith(`${s}-latin-`)) }).toEqual({ s, has: true })
  })

  it('the fetch script explains the bug it exists for', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'fetch-fonts.mjs'), 'utf8')
    expect(script).toMatch(/reading '1'/)
    expect(script).toMatch(/extension-less/)
  })
})
