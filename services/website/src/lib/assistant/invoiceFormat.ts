/**
 * The shape of a client invoice line, written once for the assistant's tools.
 *
 * The invoice page (`/plan/<ref>/summary`, lib/planInvoice.ts) lays lines out by
 * three columns the assistant's tools never used to set: `is_featured` (the
 * package, shown first and large), `description` (the grey text under a name)
 * and `is_optional` (tagged "Optional" and left OUT of the total). With none of
 * them, a custom-priced party came out as ONE flat row named
 * "Mobile Party (up to 15 kids): Canvas Painting, Hair Tinsel, Glitter Tattoos"
 * - correct money, nothing like the invoice a planner-built party gets
 * (Judith Slopnick, 2026-11-07).
 *
 * `parties/create` and `writeLineItems` already carried all three; only the
 * tool schemas and the add-line action dropped them.
 */

export const LINE_CATEGORY_HINT =
  'package for the party price, station for an activity included in it ($0), add-on for an extra. Default package when creating, add-on when adding.'
export const LINE_DESCRIPTION_HINT =
  'The grey text under the name on the invoice, one or two sentences. Included stations start with "Included." Optional per-guest items say the per-guest price and that it is not in the total.'
export const LINE_FEATURED_HINT = 'True for the ONE package line the party is sold as. It is shown first and large.'
export const LINE_OPTIONAL_HINT =
  'True for a quoted extra the client has NOT bought: it shows tagged Optional and is NOT in the total or the deposit.'

/**
 * How a party is laid out on the invoice. Shown to the model wherever it
 * writes an invoice line, so a custom-priced party matches a planner-built one.
 */
export const INVOICE_FORMAT_HINT =
  'INVOICE FORMAT for a custom-priced party: (1) ONE featured package line with the whole price, named "Mobile Party - up to 15 Kids" (or the studio equivalent), category package, featured true, with a description of what is covered; do NOT put the activity names in the package name. (2) One $0 line per activity included in it, category station, description starting "Included." (3) Anything the client may add later as its own line with optional true, priced per guest when it is, so it shows on the invoice but stays out of the total.'

export interface LineFlags {
  description: string | null
  is_featured: boolean
  is_optional: boolean
}

/** Read the three invoice-layout fields off a model-supplied line. Anything unusable reads as the plain default. */
export function readLineFlags(it: Record<string, unknown>): LineFlags {
  const raw = typeof it.description === 'string' ? it.description.trim() : ''
  return {
    description: raw ? raw.slice(0, 400) : null,
    is_featured: it.featured === true,
    is_optional: it.optional === true,
  }
}

/** The tag a card shows beside an optional line, so the manager sees it is not in the total. */
export const OPTIONAL_CARD_TAG = ' (optional - not in total)'
