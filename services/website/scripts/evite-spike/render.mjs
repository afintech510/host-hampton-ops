// EVITE P01 render spike: Satori -> SVG -> sharp(librsvg) -> JPEG. ZERO network at render time.
//
//   local : node scripts/evite-spike/render.mjs
//   box   : docker run --rm --network none -m 512m -v <dir>:/w node:20-alpine node /w/render.mjs
//
// Assets are resolved relative to THIS file: `<here>/public/evites` when it exists (the self-contained
// box folder built by build-box.mjs), else `<here>/../../public/evites` (the repo). Output goes to `<here>/out`.
// Env: RENDER_ENGINE=librsvg (default) | resvg   (resvg needs @resvg/resvg-js installed; comparison only)
//      WARM_RUNS=3   extra timed passes after the first (cold) pass
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'

// ---------------------------------------------------------------- network guard (installed FIRST)
const net_calls = []
const forbid = (what) => (...a) => {
  net_calls.push(what)
  throw new Error(`NETWORK CALL BLOCKED: ${what} ${String(a[0]?.href ?? a[0]?.host ?? a[0]).slice(0, 80)}`)
}
globalThis.fetch = forbid('fetch')
for (const m of [http, https]) { m.request = forbid(`${m === http ? 'http' : 'https'}.request`); m.get = forbid(`${m === http ? 'http' : 'https'}.get`) }
net.connect = forbid('net.connect'); net.createConnection = forbid('net.createConnection')

const { default: satori } = await import('satori')
const { default: sharp } = await import('sharp')
const { default: opentype } = await import('opentype.js')
let Resvg = null
if (process.env.RENDER_ENGINE === 'resvg') ({ Resvg } = await import('@resvg/resvg-js'))

// ---------------------------------------------------------------- paths + assets
const here = path.dirname(fileURLToPath(import.meta.url))
const EV = fs.existsSync(path.join(here, 'public/evites')) ? path.join(here, 'public/evites') : path.resolve(here, '../../public/evites')
const OUT = path.join(here, process.env.RENDER_ENGINE === 'resvg' ? 'out-resvg' : 'out')
fs.mkdirSync(OUT, { recursive: true })
const rd = (p) => fs.readFileSync(path.join(EV, p))
const dataUri = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`

const FONT_FILES = {
  monoton: ['Monoton', 400, 'fonts/monoton-latin-400-normal.woff'],
  bungee: ['Bungee Outline', 400, 'fonts/bungee-outline-latin-400-normal.woff'],
  neon: ['Neonderthaw', 400, 'fonts/neonderthaw-latin-400-normal.woff'],
  poppins400: ['Poppins', 400, 'fonts/poppins-latin-400-normal.woff'],
  poppins600: ['Poppins', 600, 'fonts/poppins-latin-600-normal.woff'],
}
const satoriFonts = []
const otFonts = {}
for (const [k, [name, weight, file]] of Object.entries(FONT_FILES)) {
  const buf = rd(file)
  satoriFonts.push({ name, data: buf, weight, style: 'normal' })
  otFonts[k] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const FAMILY = { monoton: 'Monoton', bungee: 'Bungee Outline', neon: 'Neonderthaw', poppins400: 'Poppins', poppins600: 'Poppins' }
const WEIGHT = { poppins600: 600 }

const IMG = {
  bgJpg: dataUri('image/jpeg', rd('glow/background.jpg')),
  strip: dataUri('image/png', rd('glow/icon-strip.png')),
  squiggle: dataUri('image/png', rd('glow/squiggle.png')),
  star: dataUri('image/png', rd('glow/star.png')),
}
const SQUIGGLE_AR = 292 / 480, STAR_AR = 252 / 240, STRIP_AR = 1640 / 234
const BG_COLOR = '#1b0630'

// ---------------------------------------------------------------- tiny element helpers (no JSX)
const h = (type, style, children) => ({ type, props: { style, ...(children === undefined ? {} : { children }) } })
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: Math.round(w), height: Math.round(ht), style: { width: w, height: ht, ...style } } })
// Glow = stacked shadows: [[color, blurPx], ...]. (Spec Glow {color, radii} cannot express GLOW's two-colour glow.)
const shadow = (glow, mult = 1) => glow.map(([c, r]) => `0 0 ${r}px ${c}`).join(', ')
const boxGlow = shadow

// width of `text` in px at `size` for font key, incl. letter spacing (opentype.js, kerning on)
function measure(fk, text, size, lsPx = 0) {
  return otFonts[fk].getAdvanceWidth(text, size, { kerning: true }) + lsPx * [...text].length
}
// largest size in [min, max] whose width <= maxWidth; `fits` false if even min overflows
function fit(fk, text, max, min, maxWidth, lsPx = 0) {
  let size = max
  while (size > min && measure(fk, text, size, lsPx / max * size) > maxWidth) size -= 1
  const width = measure(fk, text, size, lsPx / max * size)
  return { size, width, fits: width <= maxWidth }
}

// ---------------------------------------------------------------- layout (spec §6 shape, from glow.layout.json)
const W = 1085, H = 1530
const GLOW_FILL = 'linear-gradient(90deg, #ff3df2, #ffd23f 35%, #3dd9ff 70%, #b84dff)'
const TX = (c) => [[c, 6], [c, 18], [c, 40]] // layout.glow_text_shadow "0 0 6px c, 0 0 18px c, 0 0 40px c"

// The design mock's boxes use CSS `line-height: normal` except where the layout says 1. `normal` is not portable
// (Satori would use another value), so every slot carries an explicit numeric lineHeight = the font's normal ratio.
const NORMAL_LH = { poppins400: 1.5, poppins600: 1.5, bungee: 1.32, neon: 1.35, monoton: 1.558 }
// Satori applies letterSpacing between glyphs but NOT after a space; wordSpacing = letterSpacing restores Chrome's metrics.
// Chrome also counts the trailing letter-space in the centred width (visible glyphs sit ls/2 left): shift the box left by ls/2 (Satori ignores paddingRight here).
const spaced = (ls) => (ls ? { letterSpacing: ls, wordSpacing: ls, left: -ls / 2 } : {})

function textLine(fk, text, size, top, style, lh = 1) {
  return h('div', {
    position: 'absolute', left: 0, top, width: W, display: 'flex', justifyContent: 'center',
    fontFamily: FAMILY[fk], fontWeight: WEIGHT[fk] ?? 400, fontSize: size, lineHeight: lh, whiteSpace: 'nowrap', ...style,
  }, text)
}

function inviteElement(facts, variant = {}) {
  const { hasName, honoree, ageOrdinal, themeWord, themeSub, dateLine, placeLine, hostLine } = facts
  const kids = []
  const notes = []

  // layers: bar, brackets, squiggles (drawn first, under text)
  kids.push(img(IMG.bgJpg, W, H, { position: 'absolute', left: 0, top: 0 }))
  kids.push(h('div', {
    position: 'absolute', left: 170, top: 653, width: 745, height: 7, borderRadius: 4,
    backgroundImage: 'linear-gradient(90deg,#ff2bd6,#b45cff 55%,#3d8bff)',
    boxShadow: '0 0 8px #ff2bd6, 0 0 22px #a24bff, 0 0 40px #5b6bff',
  }))
  const bracket = (left, side) => h('div', {
    position: 'absolute', left, top: 1285, width: 30, height: 148, boxSizing: 'border-box',
    borderStyle: 'solid', borderWidth: 5, borderColor: '#ff3df2',
    ...(side === 'l' ? { borderRightWidth: 0, borderRadius: '32px 0 0 32px' } : { borderLeftWidth: 0, borderRadius: '0 32px 32px 0' }),
    boxShadow: '0 0 10px #ff3df2, 0 0 24px #c92bff',
  })
  kids.push(bracket(135, 'l'), bracket(920, 'r'))
  const sq = (left, top, ht, rot) => img(IMG.squiggle, ht * SQUIGGLE_AR, ht, { position: 'absolute', left, top, transform: `rotate(${rot}deg)` })
  kids.push(sq(70, 430, 210, -40), sq(960, -10, 170, 10))

  // invited line
  kids.push(textLine('poppins400', "YOU'RE INVITED TO A", 30, 118, { color: '#fbf9f1', opacity: 0.95, ...spaced(0.33 * 30) }, NORMAL_LH.poppins400))

  // GLOW word: gradient clip + neon glow.
  //   'filter' (default): one gradient-clipped layer + `filter: drop-shadow(..) drop-shadow(..)` (Satori 0.47 supports it;
  //     identical to the Chrome mock, drop-shadows compound exactly like the reference CSS).
  //   'shadow' (fallback): a transparent-fill copy carrying stacked textShadow, UNDER the gradient-clipped copy.
  const glowMode = variant.glowMode ?? process.env.GLOW_MODE ?? 'filter'
  const gw = fit('monoton', themeWord, 250, 120, 1000)
  const glowTop = 160
  if (glowMode === 'shadow') {
    kids.push(textLine('monoton', themeWord, gw.size, glowTop, { color: 'transparent', textShadow: shadow([['#ff3df2', 10], ['#8a3dff', 26]]) }))
  }
  kids.push(textLine('monoton', themeWord, gw.size, glowTop, {
    color: 'transparent', backgroundImage: GLOW_FILL, backgroundClip: 'text',
    ...(glowMode === 'filter' ? { filter: 'drop-shadow(0 0 10px #ff3df2) drop-shadow(0 0 26px #8a3dff)' } : {}),
  }))

  // PARTY
  kids.push(textLine('bungee', themeSub, 138, 470, { color: '#ff5a6e', textShadow: shadow(TX('#ff3355')) }))
  // icon strip
  kids.push(h('div', { position: 'absolute', left: 0, top: 700, width: W, display: 'flex', justifyContent: 'center' }, img(IMG.strip, 820, 820 / STRIP_AR)))

  // honoree: name, or BIRTHDAY + star
  const nm = fit('bungee', honoree, 165, 90, hasName ? 960 : 960 - 150)
  notes.push(`honoree "${honoree}" size ${nm.size} width ${Math.round(nm.width)} fits=${nm.fits}`)
  const honoreeStyle = { color: '#fff028', textShadow: shadow(TX('#ffe100')) }
  if (hasName) {
    kids.push(textLine('bungee', honoree, nm.size, 835, honoreeStyle))
  } else {
    const starH = Math.round(nm.size * 0.9)
    kids.push(h('div', { position: 'absolute', left: 0, top: 835, width: W, height: 165, display: 'flex', justifyContent: 'center', alignItems: 'center' }, [
      h('div', { display: 'flex', fontFamily: 'Bungee Outline', fontSize: nm.size, lineHeight: 1, whiteSpace: 'nowrap', ...honoreeStyle }, honoree),
      img(IMG.star, starH * STAR_AR, starH, { marginLeft: 24 }),
    ]))
  }

  // age row: "7TH" + script "Birthday!" (baseline aligned)
  if (ageOrdinal) {
    const age = ageOrdinal.toUpperCase()
    const aw = measure('bungee', age, 128), sw = measure('neon', 'Birthday!', 132)
    notes.push(`age row ${Math.round(aw + 22 + sw)}px of 1000`)
    kids.push(h('div', { position: 'absolute', left: 0, top: 1035, width: W, display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 22, whiteSpace: 'nowrap' }, [
      h('div', { display: 'flex', fontFamily: 'Bungee Outline', fontSize: 128, lineHeight: NORMAL_LH.bungee, color: '#ffffff', textShadow: shadow(TX('#c77dff')) }, age),
      h('div', { display: 'flex', fontFamily: 'Neonderthaw', fontSize: 132, lineHeight: NORMAL_LH.neon, color: '#ffffff', textShadow: shadow(TX('#ff4fd8')) }, 'Birthday!'),
    ]))
  }

  // date / place / host
  const dt = fit('poppins600', dateLine.toUpperCase(), 36, 20, 760, 0.04 * 36)
  kids.push(textLine('poppins600', dateLine.toUpperCase(), dt.size, 1292, { color: '#fbf9f1', ...spaced(0.04 * dt.size) }, NORMAL_LH.poppins600))
  const pl = fit('poppins400', placeLine, 25, 16, 760, 0.06 * 25)
  kids.push(textLine('poppins400', placeLine, pl.size, 1345, { color: '#fbf9f1', ...spaced(0.06 * pl.size) }, NORMAL_LH.poppins400))
  if (hostLine) {
    const hl = fit('poppins400', hostLine, 25, 16, 760, 0.06 * 25)
    kids.push(textLine('poppins400', hostLine, hl.size, 1388, { color: '#ffd6f6', ...spaced(0.06 * hl.size) }, NORMAL_LH.poppins400))
  }
  return { el: h('div', { position: 'relative', display: 'flex', width: W, height: H, backgroundColor: BG_COLOR, overflow: 'hidden' }, kids), notes }
}

async function ogElement(facts, portraitJpg) {
  const { honoree, themeWord, cardDate, cardPlace, hostCard } = facts
  const title = facts.hasName ? `${honoree}'S ${themeWord} PARTY` : `${themeWord} BIRTHDAY PARTY` // no-name wording is a P03 decision
  const ogBg = await sharp(rd('glow/background.jpg')).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 80 }).toBuffer()
  const portraitUri = dataUri('image/jpeg', portraitJpg)
  const line = (t, extra = {}) => h('div', { display: 'flex', fontSize: 30, lineHeight: 1.5, ...extra }, t)
  return h('div', {
    display: 'flex', alignItems: 'center', width: 1200, height: 630, padding: '0 64px', boxSizing: 'border-box',
    backgroundColor: BG_COLOR, backgroundImage: `url(${dataUri('image/jpeg', ogBg)})`, backgroundSize: '1200px 630px',
    color: '#fbf9f1', fontFamily: 'Poppins', fontWeight: 400, overflow: 'hidden',
  }, [
    img(portraitUri, 397, 560, { borderRadius: 14, boxShadow: '0 0 40px #b84dff88, 0 10px 30px #0008', marginRight: 56 }),
    h('div', { display: 'flex', flexDirection: 'column', width: 619 }, [
      h('div', { display: 'flex', fontSize: 24, ...spaced(0.3 * 24), opacity: 0.85 }, "YOU'RE INVITED"),
      h('div', { display: 'flex', fontFamily: 'Bungee Outline', fontSize: 74, lineHeight: 1.05, color: '#fff028', textShadow: shadow(TX('#ffe100')), margin: '14px 0 26px 0' }, title),
      line(cardDate), line(cardPlace),
      hostCard ? line(hostCard, { fontSize: 24, color: '#ffd6f6', marginTop: 6 }) : null,
      h('div', { display: 'flex', marginTop: 24 }, h('div', {
        display: 'flex', fontWeight: 600, fontSize: 28, padding: '14px 30px', borderRadius: 999,
        backgroundColor: '#ff3df2', color: '#1b0630', boxShadow: '0 0 24px #ff3df2',
      }, 'Tap to RSVP')),
    ].filter(Boolean)),
  ])
}

// ---------------------------------------------------------------- facts (hand-built; real InviteFacts is P03)
const base = {
  themeWord: 'GLOW', themeSub: 'PARTY',
  dateLine: 'Saturday, November 14 · 2–4 PM', placeLine: 'Host Hampton · 295 Montauk Hwy, Speonk',
  hostLine: 'Any questions? Ask Allie · 631-998-9325',
  cardDate: 'Sat, Nov 14 · 2–4 PM', cardPlace: 'Host Hampton, Speonk', hostCard: 'Questions? Ask Allie · 631-998-9325',
}
const VARIANTS = {
  mia: { ...base, hasName: true, honoree: 'MIA', ageOrdinal: '7th' },
  noname: { ...base, hasName: false, honoree: 'BIRTHDAY', ageOrdinal: '7th' },
  longname: { ...base, hasName: true, honoree: 'ALEXANDRIA-ROSE', ageOrdinal: '7th' },
}

// ---------------------------------------------------------------- instrumentation
const loop = monitorEventLoopDelay({ resolution: 5 })
let peakRss = 0
const sampleRss = () => { const r = process.memoryUsage().rss; if (r > peakRss) peakRss = r; return r }
const mb = (b) => (b / 1048576).toFixed(0) + 'MB'
const rssTimer = setInterval(sampleRss, 20); rssTimer.unref()

async function toJpeg(svg, quality, width, height) {
  if (Resvg) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng()
    return sharp(png).flatten({ background: BG_COLOR }).jpeg({ quality, mozjpeg: true }).toBuffer()
  }
  return sharp(Buffer.from(svg)).flatten({ background: BG_COLOR }).jpeg({ quality, mozjpeg: true }).toBuffer()
}

async function renderPair(key, opts = {}) {
  const facts = VARIANTS[key]
  const t0 = performance.now()
  loop.reset(); loop.enable()
  const { el, notes } = inviteElement(facts, opts)
  const tS0 = performance.now()
  const svg = await satori(el, { width: W, height: H, fonts: satoriFonts, embedFont: true })
  const tS1 = performance.now()
  const invite = await toJpeg(svg, 86, W, H)
  const tR1 = performance.now()
  const portrait = await sharp(invite).resize(397, 560, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer()
  const ogSvg = await satori(await ogElement(facts, portrait), { width: 1200, height: 630, fonts: satoriFonts, embedFont: true })
  const tO1 = performance.now()
  const og = await toJpeg(ogSvg, 82, 1200, 630)
  const t1 = performance.now()
  loop.disable()
  sampleRss()
  return {
    invite, og, svgBytes: [svg.length, ogSvg.length], notes, svg, ogSvg,
    ms: { total: t1 - t0, inviteSatori: tS1 - tS0, inviteRaster: tR1 - tS1, ogSatori: tO1 - tR1, ogRaster: t1 - tO1 },
    maxBlockMs: loop.max / 1e6, rss: process.memoryUsage().rss,
  }
}

// ---------------------------------------------------------------- run
console.log(`engine: ${Resvg ? 'satori + @resvg/resvg-js + sharp' : 'satori + sharp(librsvg)'}`)
console.log('node', process.version, process.platform, process.arch, '| versions:', JSON.stringify({ v8: process.versions.v8, icu: process.versions.icu, sharp: sharp.versions }))
console.log('assets:', EV)
const pretty = (r) => `total ${r.ms.total.toFixed(0)}ms (invite satori ${r.ms.inviteSatori.toFixed(0)} + raster ${r.ms.inviteRaster.toFixed(0)}; og satori ${r.ms.ogSatori.toFixed(0)} + raster ${r.ms.ogRaster.toFixed(0)}) | max event-loop block ${r.maxBlockMs.toFixed(0)}ms | rss ${mb(r.rss)}`

const fileOf = { mia: ['invite_mia', 'og_mia'], noname: ['invite_noname', 'og_noname'], longname: ['invite_longname', null] }
const results = {}
for (const key of Object.keys(VARIANTS)) {
  const r = await renderPair(key)
  results[key] = r
  const [iname, oname] = fileOf[key]
  fs.writeFileSync(path.join(OUT, `${iname}.jpg`), r.invite)
  const im = await sharp(r.invite).metadata()
  console.log(`\n[${key}] cold-ish #${Object.keys(results).length}: ${pretty(r)}`)
  console.log(`  ${iname}.jpg ${r.invite.length}B ${im.width}x${im.height} ${im.space}`)
  if (oname) {
    fs.writeFileSync(path.join(OUT, `${oname}.jpg`), r.og)
    const om = await sharp(r.og).metadata()
    console.log(`  ${oname}.jpg ${r.og.length}B ${om.width}x${om.height} ${om.space} (${om.channels}ch) ${r.og.length < 300000 && om.width === 1200 && om.height === 630 && om.channels === 3 ? 'OK' : 'FAIL'}  <300000: ${r.og.length < 300000}`)
  }
  console.log('  svg bytes (invite, og):', r.svgBytes.join(', '), '|', r.notes.join(' | '))
  if (key === 'mia') { fs.writeFileSync(path.join(OUT, 'invite_mia.svg'), r.svg); fs.writeFileSync(path.join(OUT, 'og_mia.svg'), r.ogSvg) }
}

// experimental: GLOW via the two-layer text-shadow approach (compare with the default filter mode)
if (process.env.EXPERIMENT_FILTER) {
  const { el } = inviteElement(VARIANTS.mia, { glowMode: 'shadow' })
  const svg = await satori(el, { width: W, height: H, fonts: satoriFonts, embedFont: true })
  fs.writeFileSync(path.join(OUT, 'exp_shadow.jpg'), await toJpeg(svg, 86, W, H))
  console.log('\nexperiment: wrote exp_shadow.jpg (two-layer textShadow GLOW)')
}

const warmRuns = Number(process.env.WARM_RUNS ?? 3)
console.log(`\nwarm passes (mia pair x${warmRuns}):`)
for (let i = 0; i < warmRuns; i++) console.log(`  warm ${i + 1}: ${pretty(await renderPair('mia'))}`)

clearInterval(rssTimer)
sampleRss()
const ru = process.resourceUsage()
console.log(`\npeak RSS (sampled 20ms): ${mb(peakRss)} | maxRSS (resourceUsage): ${mb(ru.maxRSS * 1024)}`)
console.log(`network: ${net_calls.length}${net_calls.length ? '  ' + net_calls.join(',') : ''}`)
if (net_calls.length) process.exitCode = 1
