/**
 * The two food choices the customer makes in the party builder, in one place.
 *
 * These are NOT columns. They live inside `bookings.quote_snapshot` as the
 * top-level keys `pizzaOrBagels`, `cupcakeFlavor` and `addMobileCupcakes` —
 * `api/party-builder/save` passes the planner's `quoteData` straight through
 * `buildPlanSnapshot`, so whatever `PartyBuilderContent` put on that object is
 * what is on the row.
 *
 * Why this file exists: until now the only screen that read them was the
 * customer's own portal. Adam runs the party from the admin panel, and "pizza
 * or bagels, chocolate or vanilla" is the one thing he has to know the morning
 * of — so both the Parties tab and the Booked tab read them, and they read them
 * through here rather than each spelling the jsonb path their own way.
 *
 * ── The trap this encodes ─────────────────────────────────────────────────
 *
 * The planner initialises both selectors to a value (`'pizza'`, `'vanilla'`)
 * and saves whatever is showing. So a snapshot reading `pizza`/`vanilla` means
 * EITHER the customer chose that or they never touched the control — those are
 * indistinguishable on the row, and 34 of the 38 snapshots in production on
 * 2026-09-14 read exactly that. A screen that renders "Vanilla" flat is telling
 * Adam a customer made a choice they may never have made, so `isDefault` is
 * carried alongside the value and the UI says "(default)".
 *
 * A snapshot with NO key at all is a different thing again — a booking that
 * never went through the planner (hand-entered, studio rental, legacy) — and is
 * reported as `null`, not as a default.
 */

export type PizzaOrBagels = 'pizza' | 'bagels'
export type CupcakeFlavor = 'vanilla' | 'chocolate'

/** The planner's initial state. See the header on why this matters. */
export const FOOD_DEFAULTS = { pizzaOrBagels: 'pizza', cupcakeFlavor: 'vanilla' } as const

export interface FoodChoice<T extends string> {
  value: T
  label: string
  /** True when the value equals the planner's initial state — may be untouched. */
  isDefault: boolean
}

export interface FoodSelections {
  /** null = this booking has no planner snapshot, so there is nothing to show. */
  main: FoodChoice<PizzaOrBagels> | null
  cupcake: FoodChoice<CupcakeFlavor> | null
  /** Mobile parties only — the $5/guest cupcake add-on. */
  mobileCupcakes: boolean
}

const MAIN_LABELS: Record<PizzaOrBagels, string> = { pizza: 'Pizza', bagels: 'Bagels' }
const CUPCAKE_LABELS: Record<CupcakeFlavor, string> = { vanilla: 'Vanilla', chocolate: 'Chocolate' }

function isPizzaOrBagels(v: unknown): v is PizzaOrBagels {
  return v === 'pizza' || v === 'bagels'
}

function isCupcakeFlavor(v: unknown): v is CupcakeFlavor {
  return v === 'vanilla' || v === 'chocolate'
}

/**
 * Read the food choices off a `quote_snapshot`.
 *
 * Tolerant on purpose: the snapshot is customer-shaped jsonb that has changed
 * shape twice, so an unexpected value reads as "nothing recorded" rather than
 * throwing inside an admin table render.
 */
export function readFoodSelections(snapshot: unknown): FoodSelections {
  const snap = (snapshot && typeof snapshot === 'object' ? snapshot : {}) as Record<string, unknown>

  const rawMain = snap.pizzaOrBagels
  const rawCupcake = snap.cupcakeFlavor

  return {
    main: isPizzaOrBagels(rawMain)
      ? { value: rawMain, label: MAIN_LABELS[rawMain], isDefault: rawMain === FOOD_DEFAULTS.pizzaOrBagels }
      : null,
    cupcake: isCupcakeFlavor(rawCupcake)
      ? { value: rawCupcake, label: CUPCAKE_LABELS[rawCupcake], isDefault: rawCupcake === FOOD_DEFAULTS.cupcakeFlavor }
      : null,
    mobileCupcakes: snap.addMobileCupcakes === true,
  }
}

/**
 * The same read, but from the two flattened strings a PostgREST `->>` select
 * hands back. The list endpoints ask for `quote_snapshot->>pizzaOrBagels`
 * rather than the whole snapshot, because the snapshots carry the full line-item
 * array and 25 of them is a payload nobody needs to page a table.
 */
export function foodSelectionsFromColumns(
  main: string | null | undefined,
  cupcake: string | null | undefined,
  mobileCupcakes?: string | boolean | null,
): FoodSelections {
  return readFoodSelections({
    pizzaOrBagels: main ?? undefined,
    cupcakeFlavor: cupcake ?? undefined,
    addMobileCupcakes: mobileCupcakes === true || mobileCupcakes === 'true',
  })
}

/** One-line summary for a dense table cell. `null` when nothing was recorded. */
export function foodSummary(sel: FoodSelections): string | null {
  const parts: string[] = []
  if (sel.main) parts.push(sel.main.label)
  if (sel.cupcake) parts.push(`${sel.cupcake.label} cupcakes`)
  if (!parts.length) return null
  if (sel.mobileCupcakes) parts.push('+ mobile cupcakes')
  return parts.join(' · ')
}
