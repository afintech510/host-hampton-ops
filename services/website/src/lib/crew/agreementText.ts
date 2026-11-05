/**
 * The crew subcontractor agreement, v1 — the words, once.
 *
 * `docs/crew/subcontractor-agreement-v1.md` is the human-readable copy of
 * exactly this text (a test fails if they drift; run it with
 * UPDATE_AGREEMENT_MD=1 to rewrite the copy). The PDF a member signs is
 * rendered from here by `lib/crew/agreementPdf.ts`.
 *
 * The agreement text is not secret — only the signed copies are private, and
 * those live at SignWell. Names and addresses are filled in per member at
 * render time from their own profile.
 *
 * ── What it must cover ──
 * New York's Freelance Isn't Free Act (statewide since 2024) requires a
 * written contract with: both parties' names and addresses, the services, the
 * rate and method of pay, the date payment is due, and how the contractor
 * submits what they worked (section 1, 3 and 4 below).
 *
 * ── What it cannot do ──
 * It does not make anyone a contractor. In New York how the work is really
 * controlled decides that. The classification note lives in
 * `nimbalyst-local/plans` and `docs/crew/README.md`; professional review is
 * still recommended, and raising CREW_AGREEMENT_VERSION re-signs everyone.
 */

import { TENANT } from '@/tenant'
import { STUDIO_STREET, STUDIO_LOCALITY } from '@/lib/studioLocation'

export const AGREEMENT_VERSION = 'v1'

/** The SignWell `metadata.type` of this document; `SIGNWELL_WRITERS` dispatches on it. */
export const CREW_AGREEMENT_DOC_TYPE = 'crew_agreement'

export interface AgreementParty {
  legalName: string
  addressLine1: string
  addressLine2?: string | null
  city: string
  state: string
  zip: string
  email: string
}

export interface AgreementClause { heading: string; paragraphs: string[] }

export const AGREEMENT_TITLE = 'Independent Contractor (Subcontractor) Agreement — Party Crew'

const BUSINESS = TENANT.business.name

/** The numbered clauses. Placeholders: none — party-specific text is in `partiesBlock`. */
export const AGREEMENT_CLAUSES: AgreementClause[] = [
  {
    heading: '1. The services',
    paragraphs: [
      `${BUSINESS} runs kids' parties and events in its studio and at families' homes. The Contractor may choose to work those parties as part of the party crew: welcoming families, setting up, running the activities, and cleaning up. A party is posted in the ${BUSINESS} crew app with its date, time, location and role (Party Lead or Party Crew) before the Contractor decides whether to take it.`,
    ],
  },
  {
    heading: '2. No minimum, no guarantee',
    paragraphs: [
      `${BUSINESS} offers parties; the Contractor may accept any of them or decline any of them, for any reason, with no penalty and no minimum. ${BUSINESS} does not promise any amount of work. Once the Contractor has chosen a party, ${BUSINESS} counts on them to be there, and the cancellation terms in section 5 explain how a late cancellation is handled.`,
    ],
  },
  {
    heading: '3. Rate and method of pay',
    paragraphs: [
      `For each party the Contractor works, ${BUSINESS} pays a flat amount for that party (not an hourly wage). The amount for a party is shown to the Contractor in the crew app before they accept it, and follows the published schedule in the app, which may include extra pay for a particular party. Tips that clients give the crew are the Contractor's, in addition to the flat amount.`,
      `${BUSINESS} pays by Venmo, Zelle, cash or check, as recorded in the crew app. ${BUSINESS} may change the published schedule for future parties, and will never reduce the amount shown for a party the Contractor has already accepted.`,
    ],
  },
  {
    heading: '4. When payment is due, and how the work is submitted',
    paragraphs: [
      `Payment for a party is due on the day of the party, once attendance for it has been recorded in the crew app. The Contractor submits what they worked through the crew app: taking a spot, confirming it, and being marked as having attended. If the Contractor believes a party was recorded wrongly or payment is missing, they should tell ${BUSINESS} within 30 days so it can be corrected.`,
    ],
  },
  {
    heading: '5. Cancelling a party you accepted',
    paragraphs: [
      `If the Contractor can no longer work a party they accepted, they should release it in the crew app as early as they can. A release made far ahead is handled with no consequence beyond the party returning to the board. A late cancellation that another crew member covers is handled without penalty. A late cancellation that no one covers, or not showing up, may affect the Contractor's place on the published rate schedule for future parties, as described in the app. ${BUSINESS} may stop offering parties to someone who repeatedly fails to show up.`,
    ],
  },
  {
    heading: '6. How the work is done',
    paragraphs: [
      `The Contractor is an independent contractor and decides how to do the work, subject to the party plan and the safety and conduct rules in section 8, which exist to protect children and the client's event. The Contractor may work for other people and businesses, including similar ones, at any time. The Contractor supplies their own transportation and their own phone.`,
    ],
  },
  {
    heading: '7. Taxes, no benefits',
    paragraphs: [
      `The Contractor is responsible for their own taxes on what they earn. ${BUSINESS} does not withhold taxes and will report payments to the Contractor on a Form 1099 where the law requires, using a Form W-9 that the Contractor provides separately; this agreement does not collect any tax identification number. The Contractor is not an employee and is not entitled to employee benefits, overtime, paid leave or workers' compensation from ${BUSINESS} by reason of this agreement.`,
    ],
  },
  {
    heading: '8. Child safety and conduct',
    paragraphs: [
      `The Contractor will treat every child and family with respect; will never be alone with a child out of sight of another adult or the parent; will not use, or arrive under the influence of, alcohol or drugs; will not use physical discipline; and will report any injury, accident, safety concern or complaint to the Party Lead or to ${BUSINESS} straight away. The Contractor confirms they are at least 18 years old and that nothing in their background would make it unsafe for them to work with children. ${BUSINESS} may remove a Contractor from a party, and stop offering parties to them, at any time for safety or conduct reasons.`,
    ],
  },
  {
    heading: '9. Confidentiality and photos of children',
    paragraphs: [
      `The Contractor will keep private what they learn about clients, families and children (names, addresses, phone numbers, allergies, medical or family information) and will use it only to do the party. The Contractor will not photograph or film children at a party for their own use, and will not post any image of a child, or any detail that identifies one, to social media or anywhere else. Photos for ${BUSINESS}'s own marketing are taken only by ${BUSINESS} under its own consent process.`,
    ],
  },
  {
    heading: '10. Supplies and equipment',
    paragraphs: [
      `${BUSINESS} supplies the party materials. The Contractor will look after them, use them only for ${BUSINESS} parties, and return anything left over after a party.`,
    ],
  },
  {
    heading: '11. Clients are not to be solicited',
    paragraphs: [
      `While the Contractor is working with ${BUSINESS}, and for 12 months after their last party, they will not use ${BUSINESS}'s client contact details to offer a competing party service to a family they met through ${BUSINESS}, or ask such a family to book them directly instead. This does not stop the Contractor from working for anyone else, or from serving people who find them without that contact.`,
    ],
  },
  {
    heading: '12. Ending this agreement',
    paragraphs: [
      `Either side may end this agreement at any time, for any reason, by telling the other (a text or email is enough). Parties the Contractor has already accepted remain subject to section 5 unless ${BUSINESS} releases them. Sections 7, 9 and 11 continue after the agreement ends.`,
    ],
  },
  {
    heading: '13. General',
    paragraphs: [
      `This agreement is governed by the laws of the State of New York. It is the whole agreement between the parties about this subject and replaces anything said earlier; a change must be in writing, and ${BUSINESS} may offer a new version, which applies once the Contractor signs it. If any part is found unenforceable, the rest stays in force. The parties agree that signing electronically has the same effect as signing on paper, and that signing is the Contractor's own act.`,
    ],
  },
]

/** Both parties' names and addresses (Freelance Isn't Free Act). */
export function partiesBlock(c: AgreementParty): string[] {
  const addr = [c.addressLine1, c.addressLine2].filter(Boolean).join(', ')
  return [
    `This agreement is between ${BUSINESS}, ${STUDIO_STREET}, ${STUDIO_LOCALITY} ("${BUSINESS}"), and ${c.legalName}, ${addr}, ${c.city}, ${c.state} ${c.zip} ("the Contractor", email ${c.email}).`,
    `Version ${AGREEMENT_VERSION}. ${BUSINESS} has signed this agreement by issuing it; it takes effect when the Contractor signs below.`,
  ]
}

export const SIGNATURE_BLOCK_LABEL = 'Contractor signature'

/** The reference markdown (docs/crew/subcontractor-agreement-v1.md). */
export function agreementMarkdown(): string {
  const lines: string[] = [`# ${AGREEMENT_TITLE}`, '', `*Version ${AGREEMENT_VERSION}. Names and addresses are filled in from each crew member's own profile when the agreement is generated.*`, '']
  lines.push(`This agreement is between ${BUSINESS}, ${STUDIO_STREET}, ${STUDIO_LOCALITY}, and the crew member named on the signed copy.`, '')
  for (const c of AGREEMENT_CLAUSES) {
    lines.push(`## ${c.heading}`, '')
    for (const p of c.paragraphs) lines.push(p, '')
  }
  lines.push(`**${SIGNATURE_BLOCK_LABEL}:** signed electronically in SignWell.`, '')
  return lines.join('\n')
}
