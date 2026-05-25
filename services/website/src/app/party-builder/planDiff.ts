/**
 * Diff between two plan snapshots — used by the "Save changes" modal so the
 * customer sees exactly what's about to change before they hit save.
 *
 * Snapshot shape is defined inline in PartyBuilderContent; we keep this util
 * lightweight (string keys + arrays) so it doesn't need to import the type.
 */

import type { PricingItem } from '@/components/QuoteBuilder/types'

export type PlanSnapshotLite = {
  guestCount: number
  isMiniParty: boolean
  selectedTheme: string | null
  activities: string[]
  food: string[]
  desserts: string[]
  beverages: string[]
  decor: string[]
  entertainment: string[]
  extras: string[]
  foodQty: Record<string, number>
  decorQty: Record<string, number>
  partyPreferences: string
  characterRequest: string
  pizzaOrBagels: string
  cupcakeFlavor: string
  addMobileCupcakes: boolean
  locationType: string
  mobileAddress: string
  childName: string
  childAge: string
  catchyPartyName: string
}

export type ChangeRow = {
  label: string
  before: string
  after: string
}

const CATEGORY_LABEL: Record<string, string> = {
  activities: 'Activities',
  food: 'Food',
  desserts: 'Desserts',
  beverages: 'Beverages',
  decor: 'Decor',
  entertainment: 'Entertainment',
  extras: 'Party Extras',
}

function arrDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const A = new Set(a)
  const B = new Set(b)
  const added = b.filter(x => !A.has(x))
  const removed = a.filter(x => !B.has(x))
  return { added, removed }
}

function nameOf(id: string, lookup: Map<string, PricingItem>): string {
  return lookup.get(id)?.name || id
}

export function diffPlanSnapshots(
  before: PlanSnapshotLite,
  after: PlanSnapshotLite,
  itemLookup: Map<string, PricingItem>
): ChangeRow[] {
  const rows: ChangeRow[] = []

  if (before.guestCount !== after.guestCount) {
    rows.push({ label: 'Guest count', before: String(before.guestCount), after: String(after.guestCount) })
  }
  if (before.isMiniParty !== after.isMiniParty) {
    rows.push({ label: 'Mini Party', before: before.isMiniParty ? 'Yes' : 'No', after: after.isMiniParty ? 'Yes' : 'No' })
  }
  if (before.selectedTheme !== after.selectedTheme) {
    rows.push({
      label: 'Theme',
      before: before.selectedTheme ? nameOf(before.selectedTheme, itemLookup) : '—',
      after: after.selectedTheme ? nameOf(after.selectedTheme, itemLookup) : '—',
    })
  }
  if (before.locationType !== after.locationType) {
    rows.push({ label: 'Location', before: before.locationType, after: after.locationType })
  }
  if (before.locationType === 'mobile' && before.mobileAddress !== after.mobileAddress) {
    rows.push({ label: 'Address', before: before.mobileAddress || '—', after: after.mobileAddress || '—' })
  }

  for (const cat of ['activities', 'food', 'desserts', 'beverages', 'decor', 'entertainment', 'extras'] as const) {
    const { added, removed } = arrDiff(before[cat], after[cat])
    for (const id of added) rows.push({ label: CATEGORY_LABEL[cat], before: '—', after: `+ ${nameOf(id, itemLookup)}` })
    for (const id of removed) rows.push({ label: CATEGORY_LABEL[cat], before: nameOf(id, itemLookup), after: 'removed' })
  }

  // Qty changes (food, decor)
  const qtyKeys = Array.from(new Set<string>([...Object.keys(before.foodQty), ...Object.keys(after.foodQty)]))
  for (const id of qtyKeys) {
    const b = before.foodQty[id] ?? 0
    const a = after.foodQty[id] ?? 0
    if (b !== a && (b > 0 || a > 0)) {
      rows.push({ label: `${nameOf(id, itemLookup)} qty`, before: String(b || '—'), after: String(a || '—') })
    }
  }
  const decorQtyKeys = Array.from(new Set<string>([...Object.keys(before.decorQty), ...Object.keys(after.decorQty)]))
  for (const id of decorQtyKeys) {
    const b = before.decorQty[id] ?? 0
    const a = after.decorQty[id] ?? 0
    if (b !== a && (b > 0 || a > 0)) {
      rows.push({ label: `${nameOf(id, itemLookup)} qty`, before: String(b || '—'), after: String(a || '—') })
    }
  }

  if (before.partyPreferences !== after.partyPreferences) {
    rows.push({
      label: 'Preferences note',
      before: before.partyPreferences ? `${before.partyPreferences.slice(0, 40)}${before.partyPreferences.length > 40 ? '…' : ''}` : '—',
      after: after.partyPreferences ? `${after.partyPreferences.slice(0, 40)}${after.partyPreferences.length > 40 ? '…' : ''}` : '—',
    })
  }
  if (before.characterRequest !== after.characterRequest) {
    rows.push({ label: 'Character request', before: before.characterRequest || '—', after: after.characterRequest || '—' })
  }
  if (before.childName !== after.childName) {
    rows.push({ label: "Child's name", before: before.childName || '—', after: after.childName || '—' })
  }
  if (before.childAge !== after.childAge) {
    rows.push({ label: 'Child age', before: before.childAge || '—', after: after.childAge || '—' })
  }
  if (before.catchyPartyName !== after.catchyPartyName) {
    rows.push({ label: 'Catchy name', before: before.catchyPartyName || '—', after: after.catchyPartyName || '—' })
  }

  return rows
}
