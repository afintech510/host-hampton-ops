/**
 * Build the ESM Sharks fundraiser flyer.
 *
 * The output is ONE self-contained HTML file: the QR code and every product
 * photo are inlined, so the flyer survives being emailed to a PTO parent, opened
 * on a phone with no signal, or dropped on a school office desktop. A flyer that
 * needs a web server to render its own QR code is a flyer that prints with a
 * hole in it on the one afternoon somebody actually needs it.
 *
 * It is GENERATED rather than hand-written because the two things most likely to
 * change are the two things a human should never retype: the URL behind the QR
 * (which is unreadable, so a wrong one is invisible until orders stop arriving)
 * and the price list (which has to agree with `/esm-sharks`, or the flyer sells
 * something at a price the order page will not honour).
 *
 *   node services/website/scripts/build-fundraiser-flyer.mjs
 *
 * Writes flyers/esm-sharks-fundraiser-flyer.html at the repo root.
 *
 * It lives under services/website/ only because that is where `qrcode` and
 * `sharp` are installed and ESM resolves bare specifiers by walking up from the
 * importing FILE, not from the working directory — a copy at the repo root
 * cannot see them however it is invoked.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const IMAGES = join(ROOT, 'services/website/public/images')
const OUT = join(ROOT, 'flyers/esm-sharks-fundraiser-flyer.html')

/** Where the QR sends people. The only place this URL is written. */
const ORDER_URL = 'https://www.hosthampton.com/esm-sharks'

/**
 * The price list, mirrored from `/esm-sharks`'s `data-price` attributes.
 *
 * Kept here deliberately rather than scraped: the page is JSX with the prices in
 * markup attributes, and a scraper that silently matched nothing would print a
 * flyer with no prices on it. A human diffing two short lists is the check.
 */
const PRODUCTS = [
  { img: 'esm-hat-navy-circle.webp',   name: 'Trucker Hat', price: '$25', note: 'Navy or silver' },
  { img: 'esm-tote-navy-circle.webp',  name: 'Canvas Tote', price: '$40', note: 'Navy or silver' },
  { img: 'esm-pouch-navy-circle.webp', name: 'Zip Pouch',   price: '$25', note: 'Navy or silver' },
  // The PTO settled on two designs (2026-09-16), so the mascot patch is gone
  // from the page and this tile shows the circle crest. The note counts DESIGNS
  // and has to agree with the page, which now sells exactly two.
  { img: 'esm-sharks-patch.webp',      name: 'Patches',     price: '$8',  note: '3 for $20 · 2 designs' },
]

/**
 * The Venmo handle the flyer may print, or null to stay silent.
 *
 * This was null while the Sharks still pointed at @hostHampton — Host Hampton's
 * own account, not the PTO's — because printing a wrong handle puts the wrong
 * destination on a hundred pieces of paper that nobody can recall.
 *
 * Set 2026-09-16 to the PTO's real account, which `lib/fundraiserTeams.ts` now
 * holds as well. MUST equal FUNDRAISER_TEAMS['esm-sharks'].venmoHandle — paper
 * cannot be corrected after the fact, so if you change one, change both.
 */
const VENMO_HANDLE = '@Eastport-tuttlepto-1'

const b64 = async (file, width) => {
  const buf = await sharp(join(IMAGES, file)).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  return `data:image/webp;base64,${buf.toString('base64')}`
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const qr = await QRCode.toString(ORDER_URL, {
  type: 'svg',
  // 'H' survives a fold, a coffee ring and a bad phone camera in a school
  // hallway. A QR nobody can scan is a flyer with no call to action.
  errorCorrectionLevel: 'H',
  margin: 0,
  color: { dark: '#0C2340', light: '#00000000' },
}).then(s => s.replace('<svg ', '<svg class="qr" '))

const logo = await b64('esm-sharks-logo.webp', 300)
const shots = await Promise.all(PRODUCTS.map(p => b64(p.img, 420)))

const productCards = PRODUCTS.map((p, i) => `
        <div class="prod">
          <img src="${shots[i]}" alt="${esc(p.name)}">
          <div class="prod-name">${esc(p.name)}</div>
          <div class="prod-price">${esc(p.price)}</div>
          <div class="prod-note">${esc(p.note)}</div>
        </div>`).join('')

const payLine = VENMO_HANDLE
  ? `Pay by <b>Venmo (${esc(VENMO_HANDLE)})</b> or send cash in with your child.`
  : `Pay by <b>Venmo</b> or send <b>cash</b> in with your child — the order page shows you how.`

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESM Sharks Spirit Wear — Eastport-Tuttle PTO Fundraiser</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  /*
    Two artboards, one file.

    .sheet  — 8.5x11 letter, the version that goes on paper and in backpacks.
    .card   — 1080x1350, the version that gets screenshotted and texted.

    They carry the same offer on purpose. A PTO that texts one thing and prints
    another gets two sets of questions back.
  */
  :root {
    --navy:#0C2340; --ink:#071628; --silver:#A2AAAD; --mist:#E6E9EC; --gold:#C7A36B;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#52565c;font-family:Inter,system-ui,sans-serif;color:var(--ink);padding:24px;display:flex;flex-direction:column;align-items:center;gap:32px}
  .hint{color:#fff;font-size:13px;max-width:8.5in;line-height:1.6;background:rgba(0,0,0,.25);padding:14px 18px;border-radius:10px;border-left:4px solid var(--gold)}
  .hint b{color:var(--gold)}
  .sheet,.card{background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;position:relative}
  .sheet{width:8.5in;height:11in;display:flex;flex-direction:column}
  .card{width:1080px;height:1350px;transform-origin:top center;display:flex;flex-direction:column}

  /* Header */
  .hd{background:var(--navy);color:#fff;text-align:center;position:relative}
  .hd::after{content:"";position:absolute;bottom:0;left:0;right:0;height:6px;background:linear-gradient(90deg,var(--silver),#fff,var(--silver))}
  .sheet .hd{padding:26px 30px 24px}
  .card  .hd{padding:56px 60px 50px}
  .hd img{border-radius:50%;background:#fff;object-fit:contain;display:block;margin:0 auto}
  .sheet .hd img{width:78px;height:78px;padding:4px}
  .card  .hd img{width:170px;height:170px;padding:9px}
  .kicker{font-family:Oswald;font-weight:500;letter-spacing:.28em;text-transform:uppercase;color:var(--silver)}
  .sheet .kicker{font-size:10px;margin-top:12px}
  .card  .kicker{font-size:22px;margin-top:26px}
  h1{font-family:Oswald;font-weight:700;text-transform:uppercase;letter-spacing:.03em;line-height:1}
  .sheet h1{font-size:44px;margin-top:5px}
  .card  h1{font-size:96px;margin-top:12px}
  .sub{color:var(--mist);line-height:1.45}
  .sheet .sub{font-size:12.5px;margin-top:9px}
  .card  .sub{font-size:27px;margin-top:20px}

  /* Products */
  .prods{display:grid;grid-template-columns:repeat(4,1fr)}
  .sheet .prods{gap:12px;padding:22px 30px 6px}
  .card  .prods{gap:22px;padding:46px 60px 10px}
  .prod{text-align:center}
  .prod img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:var(--mist);border:1px solid var(--mist)}
  .prod-name{font-family:Oswald;text-transform:uppercase;letter-spacing:.05em;color:var(--ink)}
  .prod-price{font-family:Oswald;font-weight:700;color:var(--navy)}
  .prod-note{color:#7b828a}
  .sheet .prod-name{font-size:12px;margin-top:8px}
  .sheet .prod-price{font-size:24px;line-height:1.1}
  .sheet .prod-note{font-size:10px}
  .card .prod-name{font-size:26px;margin-top:18px}
  .card .prod-price{font-size:52px;line-height:1.1}
  .card .prod-note{font-size:20px}

  /* Order block */
  .order{display:flex;align-items:center;background:var(--mist);border-top:1px solid #d3d8dd;border-bottom:1px solid #d3d8dd;margin-top:auto}
  .sheet .order{gap:22px;padding:22px 30px}
  .card  .order{gap:44px;padding:48px 60px}
  .qrbox{background:#fff;border-radius:12px;flex-shrink:0;display:grid;place-items:center;border:1px solid #d3d8dd}
  .sheet .qrbox{width:158px;height:158px;padding:11px}
  .card  .qrbox{width:330px;height:330px;padding:24px}
  .qr{width:100%;height:100%;display:block}
  .order h2{font-family:Oswald;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);line-height:1}
  .sheet .order h2{font-size:27px}
  .card  .order h2{font-size:58px}
  .steps{list-style:none;counter-reset:s}
  .steps li{position:relative;counter-increment:s;color:#3c444d;line-height:1.5}
  .steps li::before{content:counter(s);position:absolute;left:0;background:var(--navy);color:#fff;border-radius:50%;display:grid;place-items:center;font-family:Oswald;font-weight:700}
  .sheet .steps{margin-top:11px;display:flex;flex-direction:column;gap:7px}
  .sheet .steps li{padding-left:27px;font-size:12.5px}
  .sheet .steps li::before{width:19px;height:19px;font-size:11px;top:0}
  .card .steps{margin-top:26px;display:flex;flex-direction:column;gap:16px}
  .card .steps li{padding-left:58px;font-size:27px}
  .card .steps li::before{width:41px;height:41px;font-size:23px;top:0}
  .url{font-family:Oswald;letter-spacing:.02em;color:var(--navy);word-break:break-all}
  .sheet .url{font-size:13px;margin-top:11px}
  .card  .url{font-size:28px;margin-top:24px}

  /* Delivery highlight */
  .deliv{display:flex;align-items:center;justify-content:center;text-align:center;background:var(--navy);color:#fff;line-height:1.45}
  .sheet .deliv{padding:13px 30px;font-size:12.5px;gap:9px}
  .card  .deliv{padding:30px 60px;font-size:27px;gap:18px}
  .deliv b{color:#fff}
  .deliv .free{color:var(--silver)}

  /* Footer */
  .ft{text-align:center;color:#7b828a;line-height:1.5}
  .sheet .ft{padding:13px 30px 16px;font-size:10.5px}
  .card  .ft{padding:30px 60px 38px;font-size:22px}

  @media print{
    @page{size:letter;margin:0}
    body{background:#fff;padding:0;gap:0;display:block}
    .hint,.card{display:none !important}
    .sheet{box-shadow:none;width:8.5in;height:11in}
  }
  /* Keep the texting card on screen at a sane size without changing its pixels,
     so a screenshot of it is still 1080 wide. */
  @media (max-width:1180px){ .card{transform:scale(.62);margin-bottom:-513px} }
</style>
</head>
<body>

<div class="hint">
  <b>How to use this file.</b>
  &nbsp;<b>To print:</b> Ctrl/Cmd&nbsp;+&nbsp;P → Letter → <i>Background graphics ON</i>. Only the letter flyer prints; this note and the texting card are hidden.
  &nbsp;<b>To text:</b> screenshot the tall card below, or right-click it → <i>Capture node screenshot</i>.
  ${VENMO_HANDLE ? '' : '<br><br><b>⚠ Before you print a stack of these:</b> the order page still points Venmo at <code>@hostHampton</code>, a placeholder — not the PTO&rsquo;s account. Set the Sharks&rsquo; real handle in <code>lib/fundraiserTeams.ts</code> first, or parents will pay the wrong Venmo.'}
</div>

<!-- ───────────── LETTER FLYER ───────────── -->
<div class="sheet">
  <div class="hd">
    <img src="${logo}" alt="ESM Sharks">
    <div class="kicker">Eastport-Tuttle PTO Fundraiser</div>
    <h1>Sharks Spirit Wear</h1>
    <p class="sub">Hats, totes, pouches and patches — every purchase sends money straight back to our school.</p>
  </div>

  <div class="prods">${productCards}
  </div>

  <div class="order">
    <div class="qrbox">${qr}</div>
    <div>
      <h2>Scan To Order</h2>
      <ol class="steps">
        <li>Point your phone camera at the code.</li>
        <li>Pick your colour, your patch and your child&rsquo;s name.</li>
        <li>${payLine}</li>
      </ol>
      <div class="url">${esc(ORDER_URL.replace('https://www.', ''))}</div>
    </div>
  </div>

  <div class="deliv">
    <span><b>🎒 FREE</b> &mdash; we hand it to your child in class.</span>
    <span class="free">or</span>
    <span><b>🚚 $7</b> to your door &mdash; <b>100% donated to the PTO.</b></span>
  </div>

  <div class="ft">
    Questions? Ask your PTO rep.&nbsp; Spirit wear produced by Host Hampton, Eastport NY.<br>
    Orders are confirmed by email the moment you submit &mdash; check your spam folder if you don&rsquo;t see it.
  </div>
</div>

<!-- ───────────── TEXTING CARD ───────────── -->
<div class="card">
  <div class="hd">
    <img src="${logo}" alt="ESM Sharks">
    <div class="kicker">Eastport-Tuttle PTO Fundraiser</div>
    <h1>Sharks<br>Spirit Wear</h1>
    <p class="sub">Every purchase sends money straight back to our school.</p>
  </div>

  <div class="prods">${productCards}
  </div>

  <div class="order">
    <div class="qrbox">${qr}</div>
    <div>
      <h2>Scan To Order</h2>
      <ol class="steps">
        <li>Scan with your camera.</li>
        <li>Pick items + your child&rsquo;s name.</li>
        <li>Pay by Venmo or cash.</li>
      </ol>
      <div class="url">${esc(ORDER_URL.replace('https://www.', ''))}</div>
    </div>
  </div>

  <div class="deliv">
    <span><b>🎒 FREE</b> in class</span>
    <span class="free">or</span>
    <span><b>🚚 $7</b> to your door &mdash; <b>100% to the PTO</b></span>
  </div>

  <div class="ft">Spirit wear produced by Host Hampton, Eastport NY.</div>
</div>

</body>
</html>
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
console.log(`Wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)`)
console.log(`QR → ${ORDER_URL}`)
if (!VENMO_HANDLE) console.log('NOTE: no Venmo handle printed — fundraiserTeams.ts still has the placeholder.')
