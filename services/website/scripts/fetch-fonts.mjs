#!/usr/bin/env node
/**
 * Download the web fonts the site uses into src/fonts/ (the latin subset, woff2), so the
 * build never has to ask Google for them.
 *
 * WHY THIS EXISTS. `next/font/google` fetches every face from Google while `next build` runs,
 * and Next 14.2.5 then reads the file extension off each returned URL with
 * `/\.(woff|woff2|...)$/.exec(url)[1]`. Google intermittently answers with extension-less
 * `fonts.gstatic.com/l/font?kit=...` URLs; the regex returns null and the build dies with
 * "TypeError: Cannot read properties of null (reading '1')" from `next/font`. Whether a given
 * deploy hits it is luck, which is why re-running the job "fixed" it. The layouts now use
 * `next/font/local` over the files this script writes, so there is no build-time network
 * dependency at all.
 *
 * Run it only to ADD a face or refresh the files:  node scripts/fetch-fonts.mjs
 * Commit the result. All of these are SIL Open Font License faces (redistribution is allowed).
 *
 * Add a face here AND in the layout that uses it (`next/font/local` needs a literal path).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A modern Chrome user agent makes Google answer with woff2.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36'

/** family, the css2 axis spec, and the file stem. A range ("100..900") is one variable file; a list is one file per weight. */
const FACES = [
  { family: 'Archivo', axis: 'wght@100..900', stem: 'Archivo' },
  { family: 'Archivo Black', axis: '', stem: 'ArchivoBlack' },
  { family: 'Baloo 2', axis: 'wght@400..800', stem: 'Baloo2' },
  { family: 'Cormorant Garamond', axis: 'wght@300..700', stem: 'CormorantGaramond' },
  { family: 'Figtree', axis: 'wght@300..900', stem: 'Figtree' },
  { family: 'Fraunces', axis: 'wght@100..900', stem: 'Fraunces' },
  { family: 'Graduate', axis: '', stem: 'Graduate' },
  { family: 'Inter', axis: 'wght@100..900', stem: 'Inter' },
  { family: 'Manrope', axis: 'wght@200..800', stem: 'Manrope' },
  { family: 'Montserrat', axis: 'wght@100..900', stem: 'Montserrat' },
  { family: 'Outfit', axis: 'wght@100..900', stem: 'Outfit' },
  { family: 'Playfair Display', axis: 'wght@400..900', stem: 'PlayfairDisplay' },
  { family: 'Space Grotesk', axis: 'wght@300..700', stem: 'SpaceGrotesk' },
  { family: 'Space Mono', axis: 'wght@400;700', stem: 'SpaceMono' },
  { family: 'Unbounded', axis: 'wght@200..900', stem: 'Unbounded' },
]

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fonts')

async function get(url, as) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text()
}

await mkdir(OUT, { recursive: true })
let wrote = 0
for (const f of FACES) {
  const q = `${encodeURIComponent(f.family).replace(/%20/g, '+')}${f.axis ? `:${f.axis}` : ''}`
  const css = await get(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, 'text')
  // Only the latin block of each weight.
  const blocks = [...css.matchAll(/\/\* latin \*\/\s*@font-face \{([\s\S]*?)\}/g)].map(m => m[1])
  if (blocks.length === 0) throw new Error(`${f.family}: no latin block in Google's answer`)
  for (const b of blocks) {
    const weight = /font-weight:\s*([^;]+);/.exec(b)?.[1]?.trim().replace(/\s+/g, '-')
    const url = /src:\s*url\(([^)]+\.woff2)\)/.exec(b)?.[1]
    if (!weight || !url) throw new Error(`${f.family}: could not read a latin face from:\n${b}`)
    const buf = await get(url, 'buffer')
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${f.family}: ${url} is not a woff2 file`)
    const file = `${f.stem}-latin-${weight}.woff2`
    await writeFile(path.join(OUT, file), buf)
    console.log(`${file.padEnd(40)} ${(buf.length / 1024).toFixed(1)} KB`)
    wrote++
  }
}
console.log(`\n${wrote} files in ${path.relative(process.cwd(), OUT)}`)
