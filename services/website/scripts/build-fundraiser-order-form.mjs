/**
 * Build the ESM Sharks printable ORDER FORM (one letter page, handed to each student).
 *
 * Sibling of build-fundraiser-flyer.mjs, same rules: ONE self-contained HTML file
 * (QR and photos inlined), the QR generated from one URL constant and never copied,
 * and the URL printed in plain text beside it so a human can proofread what a
 * camera cannot.
 *
 *   node services/website/scripts/build-fundraiser-order-form.mjs
 *
 * Writes flyers/esm-sharks-order-form.html, and flyers/esm-sharks-order-form.pdf
 * if playwright's browser is installed.
 *
 * The paper is a REAL order channel (decided 2026-10-12): a family can scan the
 * code, or fill this in and send it back with cash, and the organizer keys it in
 * with "Add paper order" on /esm-sharks/orders (POST /api/cm-cheer-orders). The
 * grid below is the same grid that screen shows, so keying is copying boxes.
 *
 * Money figures that live in code are READ from the source, not retyped, and the
 * build fails if they cannot be found: a price on paper cannot be recalled.
 *   - delivery fee      ← src/lib/fundraiserDelivery.ts  HOME_DELIVERY_FEE_CENTS
 *   - patch pricing     ← src/lib/fundraiserPatches.ts
 *   - venmo handle      ← src/lib/fundraiserTeams.ts     (esm-sharks)
 * Product prices are mirrored from /esm-sharks `PRODUCTS` (JSX), checked below.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const LIB = join(ROOT, 'services/website/src/lib')
const PAGE = join(ROOT, 'services/website/src/app/esm-sharks/page.tsx')
const IMAGES = join(ROOT, 'services/website/public/images')
const OUT = join(ROOT, 'flyers/esm-sharks-order-form.html')
const OUT_PDF = join(ROOT, 'flyers/esm-sharks-order-form.pdf')

/** Where the QR sends people. The only place this URL is written. */
const ORDER_URL = 'https://www.hosthampton.com/esm-sharks'

const grab = (file, re, what) => {
  const m = readFileSync(file, 'utf8').match(re)
  if (!m) throw new Error(`Could not read ${what} from ${file} — refusing to print a guess.`)
  return m[1]
}
const cents = (file, name) => Number(grab(file, new RegExp(`export const ${name} = (\\d+)`), name))

const DELIVERY_CENTS = cents(join(LIB, 'fundraiserDelivery.ts'), 'HOME_DELIVERY_FEE_CENTS')
const PATCH_UNIT = cents(join(LIB, 'fundraiserPatches.ts'), 'PATCH_UNIT_PRICE_CENTS')
const PATCH_TIER_QTY = cents(join(LIB, 'fundraiserPatches.ts'), 'PATCH_TIER_QTY')
const PATCH_TIER = cents(join(LIB, 'fundraiserPatches.ts'), 'PATCH_TIER_PRICE_CENTS')
const PATCH_EXTRA = cents(join(LIB, 'fundraiserPatches.ts'), 'PATCH_EXTRA_PRICE_CENTS')
const teamsSrc = readFileSync(join(LIB, 'fundraiserTeams.ts'), 'utf8')
const VENMO_HANDLE = (teamsSrc.slice(teamsSrc.indexOf("'esm-sharks': {")).match(/venmoHandle: '([^']+)'/) || [])[1]
if (!VENMO_HANDLE) throw new Error('No Venmo handle for esm-sharks — refusing to print one.')

const usd = c => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`)

/** Mirrored from the page's PRODUCTS; verified against it right here. */
const PRODUCTS = [
  { key: 'hat',   name: 'Trucker Hat', price: 25, img: 'esm-hat-navy-circle.webp' },
  { key: 'tote',  name: 'Canvas Tote', price: 40, img: 'esm-tote-navy-circle.webp' },
  { key: 'pouch', name: 'Zip Pouch',   price: 25, img: 'esm-pouch-navy-circle.webp' },
]
const pageSrc = readFileSync(PAGE, 'utf8')
for (const p of PRODUCTS) {
  const block = pageSrc.match(new RegExp(`key: '${p.key}',[\\s\\S]*?price: (\\d+)`))
  if (!block || Number(block[1]) !== p.price) {
    throw new Error(`Price for ${p.name} disagrees with ${PAGE} — fix PRODUCTS before printing.`)
  }
}

const COLORS = [
  { label: 'Navy', swatch: '#0C2340' },
  { label: 'Silver', swatch: '#A2AAAD' },
]
const PATCHES = [
  { label: 'Circle', art: 'esm-sharks-patch.webp' },
  { label: 'Script', art: 'esm-patch-script.webp' },
]

const b64 = async (file, width) => {
  const buf = await sharp(join(IMAGES, file)).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  return `data:image/webp;base64,${buf.toString('base64')}`
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const qr = await QRCode.toString(ORDER_URL, {
  type: 'svg',
  errorCorrectionLevel: 'H', // survives a fold, a crayon and a backpack
  margin: 0,
  color: { dark: '#0C2340', light: '#00000000' },
}).then(s => s.replace('<svg ', '<svg class="qr" '))

const logo = await b64('esm-sharks-logo.webp', 260)
const shots = await Promise.all(PRODUCTS.map(p => b64(p.img, 320)))
const arts = await Promise.all(PATCHES.map(p => b64(p.art, 120)))

// Column heads: colour × patch, in the same order the order page lists them.
const combos = COLORS.flatMap(c => PATCHES.map((p, pi) => ({ c, p, art: arts[pi] })))

const colHeads = combos.map(({ c, p, art }) => `
        <th><span class="dot" style="background:${c.swatch}"></span>${c.label}<br>
          <img src="${art}" alt=""><span class="pl">${p.label}</span></th>`).join('')

const rows = PRODUCTS.map((p, i) => `
      <tr>
        <td class="item"><div class="ii"><img src="${shots[i]}" alt=""><div><b>${esc(p.name)}</b><span>$${p.price}</span></div></div></td>
        ${combos.map(() => '<td><span class="box">QTY</span></td>').join('')}
      </tr>`).join('')

const patchRows = PATCHES.map((p, i) => `
        <div class="ploose"><img src="${arts[i]}" alt=""><b>${p.label} patch</b><span class="box">QTY</span></div>`).join('')

const tierExtra = usd(PATCH_EXTRA)

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESM Sharks Spirit Wear — Order Form</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{--navy:#0C2340;--ink:#071628;--silver:#A2AAAD;--mist:#E6E9EC}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#52565c;font-family:Inter,system-ui,sans-serif;color:var(--ink);padding:24px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .hint{color:#fff;font-size:13px;max-width:8.5in;background:rgba(0,0,0,.25);padding:12px 16px;border-radius:10px}
  .sheet{background:#fff;width:8.5in;height:11in;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}

  .hd{background:var(--navy);color:#fff;display:flex;align-items:center;gap:20px;padding:20px 30px;position:relative}
  .hd::after{content:"";position:absolute;left:0;right:0;bottom:0;height:5px;background:linear-gradient(90deg,var(--silver),#fff,var(--silver))}
  .hd .logo{width:84px;height:84px;border-radius:50%;background:#fff;padding:4px;object-fit:contain;flex:none}
  .hd .txt{flex:1}
  .kicker{font-family:Oswald;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:var(--silver);font-size:10px}
  h1{font-family:Oswald;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:34px;line-height:1.02;margin-top:4px}
  .sub{font-size:11.5px;color:var(--mist);margin-top:6px;line-height:1.4}
  .scan{flex:none;background:#fff;border-radius:12px;padding:9px 9px 6px;text-align:center;color:var(--navy);width:150px}
  .scan .qr{width:132px;height:132px;display:block}
  .scan .t{font-family:Oswald;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin-top:5px}
  .scan .u{font-family:Oswald;font-size:10.5px;letter-spacing:.02em}

  .body{padding:14px 30px 0;flex:1;display:flex;flex-direction:column;gap:11px}
  .steps{display:flex;gap:10px}
  .steps div{flex:1;background:var(--mist);border-radius:8px;padding:7px 10px;font-size:10.5px;line-height:1.35;display:flex;gap:8px;align-items:center}
  .steps b{flex:none;width:20px;height:20px;border-radius:50%;background:var(--navy);color:#fff;font-family:Oswald;display:grid;place-items:center;font-size:11px}

  h2{font-family:Oswald;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);font-size:13px;margin-bottom:4px}
  h2 small{font-family:Inter;font-weight:400;text-transform:none;letter-spacing:0;color:#6b737c;font-size:10.5px;margin-left:6px}

  table{width:100%;border-collapse:collapse}
  th{font-family:Oswald;font-weight:500;text-transform:uppercase;letter-spacing:.05em;font-size:11px;color:var(--ink);padding:5px 4px;border-bottom:2px solid var(--navy);text-align:center;vertical-align:bottom}
  th img{width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:3px}
  th .pl{font-size:10px;color:#6b737c}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;border:1px solid rgba(0,0,0,.25);margin-right:4px}
  td{padding:5px 4px;text-align:center;border-bottom:1px solid var(--mist)}
  td.item{text-align:left;width:34%}
  .ii{display:flex;align-items:center;gap:8px}
  tr{border-bottom:1px solid var(--mist)}
  td.item img{width:62px;height:62px;border-radius:8px;object-fit:cover;border:1px solid var(--mist)}
  td.item .ii div{display:flex;flex-direction:column;font-size:12.5px}
  td.item span{font-family:Oswald;font-weight:700;font-size:19px;color:var(--navy);line-height:1.1}
  .box{display:inline-flex;align-items:center;justify-content:center;width:50px;height:34px;border:1.6px solid var(--navy);border-radius:5px;font-family:Inter;font-weight:400;font-size:8px;letter-spacing:.12em;color:#b3b9c0;line-height:1}

  .patches{display:flex;align-items:center;gap:18px;border:1px solid var(--mist);border-radius:8px;padding:7px 12px}
  .patches .deal{font-size:11px;line-height:1.4;flex:1}
  .patches .deal b{font-family:Oswald;font-size:15px;color:var(--navy)}
  .ploose{display:flex;align-items:center;gap:7px;font-size:11px}
  .ploose img{width:40px;height:40px;object-fit:contain;background:var(--mist);border-radius:6px;padding:2px}

  .fields{display:grid;grid-template-columns:1fr 1fr;gap:9px 18px}
  .f{border-bottom:1.4px solid var(--ink);padding-top:14px;font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b737c;font-weight:600}
  .f.full{grid-column:1/-1}

  .choices{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .choice{border:1px solid var(--mist);border-radius:8px;padding:8px 12px;font-size:11px;line-height:1.5}
  .choice p{display:flex;align-items:center;gap:7px}
  .ck{display:inline-block;width:13px;height:13px;border:1.6px solid var(--navy);border-radius:3px;flex:none}
  .choice .note{font-size:9.5px;color:#6b737c;margin:2px 0 0 20px}

  .total{display:flex;align-items:center;justify-content:space-between;background:var(--navy);color:#fff;border-radius:8px;padding:9px 16px}
  .total span{font-family:Oswald;text-transform:uppercase;letter-spacing:.1em;font-size:14px}
  .total i{display:inline-block;width:140px;border-bottom:2px solid #fff;height:22px;vertical-align:bottom}
  .ft{text-align:center;color:#7b828a;font-size:9.5px;line-height:1.5;padding:9px 30px 12px}

  @media print{
    @page{size:letter;margin:0}
    body{background:#fff;padding:0;display:block}
    .hint{display:none}
    .sheet{box-shadow:none}
  }
</style>
</head>
<body>
<div class="hint"><b>To print:</b> Ctrl/Cmd + P → Letter → Background graphics ON → Margins: None. Fits one page.</div>

<div class="sheet">
  <div class="hd">
    <img class="logo" src="${logo}" alt="ESM Sharks">
    <div class="txt">
      <div class="kicker">Eastport-Tuttle PTO Fundraiser</div>
      <h1>Sharks Spirit Wear<br>Order Form</h1>
      <p class="sub">Every purchase sends money straight back to our school.</p>
    </div>
    <div class="scan">
      ${qr}
      <div class="t">Scan to order</div>
      <div class="u">${esc(ORDER_URL.replace('https://www.', ''))}</div>
    </div>
  </div>

  <div class="body">
    <div class="steps">
      <div><b>1</b><span>Fill in how many of each below and your total.</span></div>
      <div><b>2</b><span><strong>Scan the code</strong> to order online &mdash; <em>or</em> send this form in with your child.</span></div>
      <div><b>3</b><span>Pay by <strong>Venmo ${esc(VENMO_HANDLE)}</strong> or send <strong>cash</strong> in with this form.</span></div>
    </div>

    <div>
      <h2>Hats, totes &amp; pouches <small>Every item comes in navy or silver, with either patch. Write how many in each box.</small></h2>
      <table>
        <thead><tr><th style="text-align:left">Item</th>${colHeads}
        </tr></thead>
        <tbody>${rows}
        </tbody>
      </table>
    </div>

    <div>
      <h2>Patches on their own <small>Iron-on. Mix the two designs however you like.</small></h2>
      <div class="patches">
        <div class="deal"><b>${usd(PATCH_UNIT)}</b> each &nbsp;·&nbsp; <b>any ${PATCH_TIER_QTY} for ${usd(PATCH_TIER)}</b> &nbsp;·&nbsp; each one after that ${tierExtra}</div>
        ${patchRows}
      </div>
    </div>

    <div>
      <h2>About your child</h2>
      <div class="fields">
        <div class="f">Child's name</div>
        <div class="f">Child's teacher</div>
        <div class="f">Parent / buyer name</div>
        <div class="f">Phone</div>
        <div class="f full">Email</div>
        <div class="f full">Home delivery address — only if you chose delivery (street, town, ZIP)</div>
      </div>
    </div>

    <div class="choices">
      <div class="choice">
        <h2>Getting it to you</h2>
        <p><span class="ck"></span><b>Give it to my child at school</b> — FREE</p>
        <p><span class="ck"></span><b>Deliver to my home</b> — +${usd(DELIVERY_CENTS)}</p>
        <div class="note">The ${usd(DELIVERY_CENTS)} is 100% donated to the PTO. Write your address above.</div>
      </div>
      <div class="choice">
        <h2>How you'll pay</h2>
        <p><span class="ck"></span><b>Venmo</b> &nbsp;${esc(VENMO_HANDLE)}</p>
        <p><span class="ck"></span><b>Cash</b> — send in with this form</p>
        <div class="note">Put your child's name in the Venmo note.</div>
      </div>
    </div>

    <div class="total"><span>Order total (include delivery if chosen)</span><span>$ <i></i></span></div>
  </div>

  <div class="ft">
    Questions? Ask your PTO rep. &nbsp;Spirit wear produced by Host Hampton, Eastport NY.<br>
    Ordered online? You'll get a confirmation email right away — check spam if you don't see it.
  </div>
</div>
</body>
</html>
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
console.log(`Wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)`)
console.log(`QR → ${ORDER_URL} | delivery ${usd(DELIVERY_CENTS)} | patches ${usd(PATCH_UNIT)} / ${PATCH_TIER_QTY} for ${usd(PATCH_TIER)} / +${tierExtra} | venmo ${VENMO_HANDLE}`)

try {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file:///' + OUT.replace(/\\/g, '/'), { waitUntil: 'networkidle' })
  const h = await page.evaluate(() => {
    const s = document.querySelector('.sheet'), b = document.querySelector('.body')
    return { sheet: s.clientHeight, bodyScroll: b.scrollHeight, bodyClient: b.clientHeight,
      overflowPx: Math.round(document.querySelector('.ft').getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) }
  })
  console.log('layout', h)
  // The sheet clips (overflow:hidden), so a long page loses its footer silently.
  if (h.overflowPx > 0) throw new Error(`content overflows the letter page by ${h.overflowPx}px`)
  await page.pdf({ path: OUT_PDF, format: 'Letter', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
  await browser.close()
  console.log(`Wrote ${OUT_PDF}`)
} catch (e) {
  console.log('PDF skipped:', e.message.split('\n')[0])
}
