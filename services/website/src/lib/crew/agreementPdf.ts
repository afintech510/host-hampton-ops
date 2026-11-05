/**
 * Render the crew agreement to a PDF for SignWell (`createDocumentFromFile`).
 *
 * The signature field is a SignWell TEXT TAG, `{{signature:1:y   }}`, drawn in
 * white on the white page (SignWell leaves tags in the document, so they are
 * hidden by colour; its docs recommend exactly this). The spaces inside the tag
 * make the field wide — "field width and height match the tag". The tag
 * syntax is `{{type:recipient:required}}` per
 * https://developers.signwell.com/reference/adding-text-tags ; only the
 * `signature` type is used because it is the one the docs confirm.
 *
 * Standard PDF fonts are WinAnsi-only, so anything outside it is replaced
 * rather than allowed to throw halfway through a member's onboarding.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import {
  AGREEMENT_CLAUSES, AGREEMENT_TITLE, SIGNATURE_BLOCK_LABEL, partiesBlock, type AgreementParty,
} from '@/lib/crew/agreementText'

export const SIGNATURE_TAG = '{{signature:1:y                                        }}'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 64

/** Keep only characters the standard fonts can draw (WinAnsi); swap the rest for '?'. */
export function winAnsiSafe(s: string): string {
  return Array.from(s.normalize('NFC')).map(ch => {
    const c = ch.codePointAt(0) ?? 63
    if (c === 0x09 || c === 0x0a) return ' '
    if (c >= 0x20 && c <= 0x7e) return ch
    if (c >= 0xa0 && c <= 0xff) return ch
    if ('—–‘’“”•…€™'.includes(ch)) return ch
    return '?'
  }).join('')
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const probe = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(probe, size) <= width) line = probe
    else {
      if (line) out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  return out
}

export async function renderAgreementPdf(party: AgreementParty): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(AGREEMENT_TITLE)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const width = PAGE_W - MARGIN * 2

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }
  const para = (text: string, font: PDFFont, size: number, gap: number) => {
    for (const line of wrap(winAnsiSafe(text), font, size, width)) {
      ensure(size + 4)
      page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0.1, 0.1, 0.2) })
      y -= size + 4
    }
    y -= gap
  }

  para(AGREEMENT_TITLE, bold, 15, 10)
  for (const p of partiesBlock(party)) para(p, regular, 10.5, 6)
  y -= 4
  for (const c of AGREEMENT_CLAUSES) {
    ensure(40)
    para(c.heading, bold, 11.5, 2)
    for (const p of c.paragraphs) para(p, regular, 10.5, 6)
  }

  // Signature block: label, rule, and the hidden tag on the rule.
  ensure(110)
  y -= 14
  page.drawText(winAnsiSafe(SIGNATURE_BLOCK_LABEL), { x: MARGIN, y, size: 10.5, font: bold, color: rgb(0.1, 0.1, 0.2) })
  y -= 30
  page.drawText(SIGNATURE_TAG, { x: MARGIN, y, size: 12, font: regular, color: rgb(1, 1, 1) })
  page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: MARGIN + 300, y: y - 4 }, thickness: 0.7, color: rgb(0.4, 0.4, 0.45) })
  y -= 22
  page.drawText(winAnsiSafe(party.legalName), { x: MARGIN, y, size: 10.5, font: regular, color: rgb(0.1, 0.1, 0.2) })

  return pdf.save()
}
