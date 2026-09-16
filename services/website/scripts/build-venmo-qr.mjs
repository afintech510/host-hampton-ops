/**
 * Build the ESM Sharks Venmo QR code.
 *
 *   node services/website/scripts/build-venmo-qr.mjs
 *
 * Writes services/website/public/images/esm-venmo-qr.png.
 *
 * This exists as a SCRIPT rather than a hand-made image because a QR code is
 * the one thing on the order page a human cannot proofread. A wrong handle in
 * the text beside it is obvious; a wrong QR is a parent's payment landing in
 * someone else's account with nothing on screen to give it away. Generating it
 * from a string that a test compares against `lib/fundraiserTeams.ts` means the
 * picture and the words underneath it cannot drift apart.
 *
 * If the handle ever changes: change it in `lib/fundraiserTeams.ts`, change
 * VENMO_URL here to match, re-run this, and the test will hold you to both.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../public/images/esm-venmo-qr.png')

/**
 * MUST equal FUNDRAISER_TEAMS['esm-sharks'].venmoUrl.
 * `src/__tests__/lib/fundraiserVenmoQr.test.ts` asserts it.
 */
const VENMO_URL = 'https://www.venmo.com/u/Eastport-tuttlepto-1'

mkdirSync(dirname(OUT), { recursive: true })

await QRCode.toFile(OUT, VENMO_URL, {
  type: 'png',
  // 'H' survives a cracked phone screen and a bad camera angle in a school
  // pickup line. A QR nobody can scan is a payment method nobody can use.
  errorCorrectionLevel: 'H',
  margin: 1,
  width: 512,
  // Navy on WHITE, not on transparent: the payment block sits on white today,
  // but a transparent QR dropped on any dark surface later stops scanning.
  color: { dark: '#0C2340', light: '#FFFFFF' },
})

console.log(`Wrote ${OUT}`)
console.log(`QR → ${VENMO_URL}`)
