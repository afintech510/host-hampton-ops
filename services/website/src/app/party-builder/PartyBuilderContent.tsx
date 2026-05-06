'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Check, Minus, Plus, Users, RotateCcw, Bookmark, Loader2, Sparkles, Zap, Building2, CreditCard } from 'lucide-react'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import UniversalCalendar from '@/components/UniversalCalendar'
import type { CalendarSelection } from '@/components/UniversalCalendar/types'
import { loadStripe } from '@stripe/stripe-js'
import { formatMoney, calculateCardFee } from '@/lib/partyPricing'

/* ── constants ─────────────────────────────────────── */

const INCLUDED_GUESTS = 10
const EXTRA_GUEST_CENTS = 3500
const MINI_PARTY_DISCOUNT_CENTS = 20000
const MINI_PARTY_MAX_GUESTS = 7
const LS_KEY = 'hh_quote_data'
const DEPOSIT_CENTS = 9900

const RENTAL_WEEKDAY_3HR = 450
const RENTAL_WEEKEND_3HR = 575
const RENTAL_ADD_HR_WEEKDAY = 50
const RENTAL_ADD_HR_WEEKEND = 100

const BALLOON_QTY_ITEMS = new Set([
  'Balloon Garland 6 ft.',
  'Balloon Tower 6 ft.',
  'Leaning Balloon Tower w/ Number',
])

/* ── helpers ───────────────────────────────────────── */

function fmt(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString()}` : `$${d.toFixed(2)}`
}

function isWeekday(dateStr: string): boolean {
  if (!dateStr) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day >= 1 && day <= 4
}

/* ── sub-components ────────────────────────────────── */

function CategoryModule({
  title, subtitle, headerBg, titleColor, children,
}: {
  title: string; subtitle: string; headerBg?: string; titleColor?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
      {headerBg ? (
        <div className={`${headerBg} px-8 py-5 text-center`}>
          <h2 className="font-serif text-2xl font-black text-white tracking-tight">{title}</h2>
          <p className="text-white/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">{subtitle}</p>
        </div>
      ) : (
        <div className="text-center pt-8 pb-2 px-8">
          <h2 className={`font-serif text-3xl font-black tracking-tight mb-1 ${titleColor || 'text-hampton-navy'}`}>{title}</h2>
          <p className="text-hampton-navy/40 uppercase tracking-widest text-xs font-semibold">{subtitle}</p>
        </div>
      )}
      <div className="p-6 sm:p-8">{children}</div>
    </div>
  )
}

function SelectableThemeCard({ item, selected, onClick }: {
  item: PricingItem; selected: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className={`relative text-left p-4 rounded-xl border-2 transition-all duration-200 ${
        selected
          ? 'border-hampton-navy bg-hampton-navy/5 shadow-md ring-1 ring-hampton-navy/10'
          : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue hover:shadow-sm'
      }`}>
      {item.is_popular && (
        <span className="absolute -top-2.5 right-3 bg-hampton-pink text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
          <Sparkles size={10} /> Popular
        </span>
      )}
      {selected && (
        <span className="absolute top-3 right-3 w-5 h-5 bg-hampton-navy rounded-full flex items-center justify-center">
          <Check size={12} className="text-white" />
        </span>
      )}
      <p className="font-serif font-bold text-hampton-navy text-sm pr-6">{item.name}</p>
      {item.description && <p className="text-hampton-navy/50 text-xs mt-1 line-clamp-2">{item.description}</p>}
      <p className="font-bold text-hampton-navy mt-2">{fmt(item.price_cents, item.price_label)}</p>
    </button>
  )
}

function SelectableActivityChip({ item, selected, onClick }: {
  item: PricingItem; selected: boolean; onClick: () => void
}) {
  const hasPrice = item.price_cents > 0
  return (
    <button type="button" onClick={onClick}
      className={`relative flex flex-col items-center justify-center text-center gap-1 p-3 rounded-xl border-2 transition-all duration-200 ${
        selected ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue'
      }`}>
      {item.emoji && <span className="text-xl leading-none">{item.emoji}</span>}
      <span className="text-xs font-semibold leading-tight text-hampton-navy">{item.name}</span>
      {hasPrice && <span className="text-[10px] font-bold text-hampton-pink">+{fmt(item.price_cents)}</span>}
      {selected && (
        <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-hampton-navy rounded-full flex items-center justify-center">
          <Check size={10} className="text-white" />
        </span>
      )}
    </button>
  )
}

function SelectableAddOnCard({ item, selected, onClick }: {
  item: PricingItem; selected: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left p-3.5 rounded-xl border-2 transition-all duration-200 flex items-center justify-between gap-3 ${
        selected ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : 'border-hampton-mauve/20 bg-white hover:border-hampton-blue'
      }`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
        {item.description && <p className="text-hampton-navy/50 text-xs mt-0.5 truncate">{item.description}</p>}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-hampton-navy font-bold text-sm whitespace-nowrap">
          {fmt(item.price_cents, item.price_label)}
        </span>
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
          selected ? 'border-hampton-navy bg-hampton-navy' : 'border-hampton-mauve/40'
        }`}>
          {selected && <Check size={12} className="text-white" />}
        </span>
      </div>
    </button>
  )
}

function SelectableAddOnCardWithQty({ item, selected, qty, onClick, onQtyChange }: {
  item: PricingItem; selected: boolean; qty: number
  onClick: () => void; onQtyChange: (qty: number) => void
}) {
  return (
    <div className={`rounded-xl border-2 transition-all duration-200 ${
      selected ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : 'border-hampton-mauve/20 bg-white hover:border-hampton-blue'
    }`}>
      <button type="button" onClick={onClick}
        className="w-full text-left p-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
          {item.description && <p className="text-hampton-navy/50 text-xs mt-0.5 truncate">{item.description}</p>}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-hampton-navy font-bold text-sm whitespace-nowrap">
            {fmt(item.price_cents, item.price_label)}
          </span>
          <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
            selected ? 'border-hampton-navy bg-hampton-navy' : 'border-hampton-mauve/40'
          }`}>
            {selected && <Check size={12} className="text-white" />}
          </span>
        </div>
      </button>
      {selected && (
        <div className="px-3.5 pb-3 flex items-center gap-2 border-t border-hampton-mauve/15 pt-2.5">
          <span className="text-xs text-hampton-navy/50 flex-1">Qty</span>
          <button type="button" onClick={e => { e.stopPropagation(); onQtyChange(qty - 1) }}
            className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors">
            <Minus size={11} />
          </button>
          <span className="w-7 text-center font-bold text-hampton-navy text-sm">{qty}</span>
          <button type="button" onClick={e => { e.stopPropagation(); onQtyChange(qty + 1) }}
            className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors">
            <Plus size={11} />
          </button>
          {qty > 1 && (
            <span className="text-xs text-hampton-navy/40 ml-1">= {fmt(item.price_cents * qty)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function AddOnGrid({ items, selected, onToggle }: {
  items: PricingItem[]; selected: Set<string>; onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map(i => (
        <SelectableAddOnCard key={i.id} item={i} selected={selected.has(i.id)} onClick={() => onToggle(i.id)} />
      ))}
    </div>
  )
}

function AddOnGridWithQty({ items, selected, qty, onToggle, onQtyChange }: {
  items: PricingItem[]
  selected: Set<string>
  qty: Map<string, number>
  onToggle: (id: string) => void
  onQtyChange: (id: string, qty: number) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map(i => (
        <SelectableAddOnCardWithQty
          key={i.id} item={i} selected={selected.has(i.id)} qty={qty.get(i.id) ?? 1}
          onClick={() => onToggle(i.id)} onQtyChange={q => onQtyChange(i.id, q)}
        />
      ))}
    </div>
  )
}

/* ── main component ────────────────────────────────── */

interface QuoteData {
  theme: string | null
  themeName: string | null
  guestCount: number
  foodChoice: string | null
  cupcakeFlavor: string | null
  activities: string[]
  food: string[]
  desserts: string[]
  decor: string[]
  entertainment: string[]
  beverages: string[]
  extras: string[]
  contactName: string
  contactEmail: string
  contactPhone: string
  preferredDate?: string
  partyName?: string
  isMiniParty?: boolean
  foodQtyMap?: Record<string, number>
  decorQtyMap?: Record<string, number>
}

function parseQuoteParam(q: string | null | undefined): QuoteData | null {
  if (!q) return null
  try {
    return JSON.parse(atob(q.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

interface Props {
  themes: PricingItem[]
  premiumActivities: PricingItem[]
  standardActivities: PricingItem[]
  food: PricingItem[]
  desserts: PricingItem[]
  beverages: PricingItem[]
  decor: PricingItem[]
  entertainment: PricingItem[]
  partyAddOns: PricingItem[]
  savedQuote?: string | null
  checkoutStatus?: string | null
  checkoutSessionId?: string | null
}

export default function PartyBuilderContent({
  themes, premiumActivities, standardActivities,
  food, desserts, beverages, decor, entertainment, partyAddOns, savedQuote,
  checkoutStatus, checkoutSessionId,
}: Props) {
  const restored = useMemo(() => parseQuoteParam(savedQuote), [savedQuote])

  /* ── selection state ── */
  const [selectedTheme, setSelectedTheme] = useState<string | null>(restored?.theme ?? null)
  const [isMiniParty, setIsMiniParty] = useState(restored?.isMiniParty ?? false)
  const [guestCount, setGuestCount] = useState(restored?.guestCount ?? INCLUDED_GUESTS)
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set(restored?.activities))
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set(restored?.food))
  const [foodQty, setFoodQty] = useState<Map<string, number>>(new Map(Object.entries(restored?.foodQtyMap || {}) as [string, number][]))
  const [selectedDesserts, setSelectedDesserts] = useState<Set<string>>(new Set(restored?.desserts))
  const [selectedBeverages, setSelectedBeverages] = useState<Set<string>>(new Set(restored?.beverages))
  const [selectedDecor, setSelectedDecor] = useState<Set<string>>(new Set(restored?.decor))
  const [decorQty, setDecorQty] = useState<Map<string, number>>(new Map(Object.entries(restored?.decorQtyMap || {}) as [string, number][]))
  const [selectedEntertainment, setSelectedEntertainment] = useState<Set<string>>(new Set(restored?.entertainment))
  const [selectedPartyAddOns, setSelectedPartyAddOns] = useState<Set<string>>(new Set(restored?.extras))

  /* ── DIY rental state ── */
  const [isDIYOpen, setIsDIYOpen] = useState(false)
  const [rentalDate, setRentalDate] = useState('')

  /* ── form state ── */
  const [contact, setContact] = useState({
    fullName: restored?.contactName || '', email: restored?.contactEmail || '', phone: restored?.contactPhone || '',
    partyName: restored?.partyName || '',
  })
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  /* ── loaded booking state ── */
  const [loadedBooking, setLoadedBooking] = useState<{
    booking_ref: string; status: string; total_cents: number; balance_due_cents: number; deposit_amount: number;
    party_date?: string | null; party_time?: string | null; party_tags?: { date_locked?: boolean; created_by?: string } | null;
  } | null>(null)
  const dateLocked = !!loadedBooking?.party_tags?.date_locked
  const [loadedPayments, setLoadedPayments] = useState<{
    id: string; payment_type: string; payment_method: string; amount_cents: number;
    card_fee_cents: number; total_charged_cents: number; paid_at: string
  }[]>([])
  const [bookingLoading, setBookingLoading] = useState(true)

  /* ── calendar state ── */
  const [calendarSelection, setCalendarSelection] = useState<CalendarSelection | null>(null)

  /* ── payment state ── */
  const [payProcessing, setPayProcessing] = useState(false)
  const [payError, setPayError] = useState('')
  const [checkoutReady, setCheckoutReady] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const checkoutRef = useRef<HTMLDivElement>(null)
  const embeddedCheckoutRef = useRef<any>(null)

  const formRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const payRef = useRef<HTMLDivElement>(null)

  /* ── toggle helpers ── */
  const toggle = useCallback((set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFn(next)
  }, [])

  const toggleFood = useCallback((id: string) => {
    const nextSet = new Set(selectedFood)
    const nextQty = new Map(foodQty)
    if (nextSet.has(id)) { nextSet.delete(id); nextQty.delete(id) }
    else { nextSet.add(id); nextQty.set(id, 1) }
    setSelectedFood(nextSet)
    setFoodQty(nextQty)
  }, [selectedFood, foodQty])

  const setFoodItemQty = useCallback((id: string, qty: number) => {
    if (qty < 1) { toggleFood(id); return }
    setFoodQty(new Map(foodQty).set(id, qty))
  }, [foodQty, toggleFood])

  const toggleDecor = useCallback((id: string, itemName: string) => {
    const nextSet = new Set(selectedDecor)
    const nextQty = new Map(decorQty)
    if (nextSet.has(id)) { nextSet.delete(id); nextQty.delete(id) }
    else { nextSet.add(id); if (BALLOON_QTY_ITEMS.has(itemName)) nextQty.set(id, 1) }
    setSelectedDecor(nextSet)
    setDecorQty(nextQty)
  }, [selectedDecor, decorQty])

  const setDecorItemQty = useCallback((id: string, qty: number) => {
    if (qty < 1) {
      const nextSet = new Set(selectedDecor); nextSet.delete(id); setSelectedDecor(nextSet)
      const nextQty = new Map(decorQty); nextQty.delete(id); setDecorQty(nextQty)
      return
    }
    setDecorQty(new Map(decorQty).set(id, qty))
  }, [selectedDecor, decorQty])

  /* ── detect checkout return ── */
  useEffect(() => {
    if (checkoutStatus === 'complete' && checkoutSessionId) {
      setPaymentSuccess(true)
      // Clean URL params without reload
      window.history.replaceState({}, '', '/party-builder')
    }
  }, [checkoutStatus, checkoutSessionId])

  /* ── load booking from portal cookie ── */
  useEffect(() => {
    let cancelled = false
    async function loadBooking() {
      try {
        const res = await fetch('/api/party-builder/load')
        if (!res.ok) { setBookingLoading(false); return }
        const data = await res.json()
        if (cancelled) return

        const b = data.booking
        setLoadedBooking(b)
        setLoadedPayments(data.payments || [])

        // Restore contact info
        setContact({
          fullName: b.contact_name || '',
          email: b.contact_email || '',
          phone: b.contact_phone || '',
          partyName: b.child_name || '',
        })

        // Pre-fill calendar if booking already has date/time
        if (b.party_date && b.party_time) {
          setCalendarSelection({
            date: b.party_date,
            timeSlot: { start: b.party_time, end: b.party_time, status: 'open' },
          } as CalendarSelection)
        }

        // Restore selections from quote_snapshot if available
        const snap = b.quote_snapshot
        if (snap) {
          if (snap.theme) setSelectedTheme(snap.theme)
          if (snap.guestCount) setGuestCount(snap.guestCount)
          if (snap.isMiniParty) setIsMiniParty(true)
          if (snap.activities) setSelectedActivities(new Set(snap.activities))
          if (snap.food) setSelectedFood(new Set(snap.food))
          if (snap.desserts) setSelectedDesserts(new Set(snap.desserts))
          if (snap.beverages) setSelectedBeverages(new Set(snap.beverages))
          if (snap.decor) setSelectedDecor(new Set(snap.decor))
          if (snap.entertainment) setSelectedEntertainment(new Set(snap.entertainment))
          if (snap.extras) setSelectedPartyAddOns(new Set(snap.extras))
          if (snap.foodQtyMap) setFoodQty(new Map(Object.entries(snap.foodQtyMap) as [string, number][]))
          if (snap.decorQtyMap) setDecorQty(new Map(Object.entries(snap.decorQtyMap) as [string, number][]))
        }
      } catch { /* no booking — fresh start */ }
      if (!cancelled) setBookingLoading(false)
    }
    if (!restored) loadBooking()
    else setBookingLoading(false)
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── item lookup ── */
  const allItems = useMemo(
    () => [...themes, ...premiumActivities, ...standardActivities, ...food, ...desserts, ...beverages, ...decor, ...entertainment, ...partyAddOns],
    [themes, premiumActivities, standardActivities, food, desserts, beverages, decor, entertainment, partyAddOns],
  )
  const itemMap = useMemo(() => {
    const m = new Map<string, PricingItem>()
    for (const i of allItems) m.set(i.id, i)
    return m
  }, [allItems])

  /* ── running total ── */
  const effectiveGuestCount = isMiniParty ? Math.min(guestCount, MINI_PARTY_MAX_GUESTS) : guestCount
  const extraGuests = Math.max(0, effectiveGuestCount - INCLUDED_GUESTS)
  const themeItem = selectedTheme ? itemMap.get(selectedTheme) : null

  const total = useMemo(() => {
    let sum = 0
    if (selectedTheme) sum += itemMap.get(selectedTheme)?.price_cents ?? 0
    if (isMiniParty && selectedTheme) sum -= MINI_PARTY_DISCOUNT_CENTS
    sum += extraGuests * EXTRA_GUEST_CENTS
    for (const id of Array.from(selectedActivities)) {
      const item = itemMap.get(id)
      if (!item) continue
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
    }
    for (const id of Array.from(selectedFood)) {
      const item = itemMap.get(id)
      if (!item) continue
      const qty = foodQty.get(id) ?? 1
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount * qty : item.price_cents * qty
    }
    const flatNoQty = [
      ...Array.from(selectedDesserts), ...Array.from(selectedBeverages),
      ...Array.from(selectedEntertainment), ...Array.from(selectedPartyAddOns),
    ]
    for (const id of flatNoQty) {
      const item = itemMap.get(id)
      if (!item) continue
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
    }
    for (const id of Array.from(selectedDecor)) {
      const item = itemMap.get(id)
      if (!item) continue
      const qty = decorQty.get(id) ?? 1
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents * qty
    }
    return Math.max(0, sum)
  }, [selectedTheme, isMiniParty, extraGuests, effectiveGuestCount, selectedActivities, selectedFood, foodQty, selectedDesserts, selectedBeverages, selectedDecor, decorQty, selectedEntertainment, selectedPartyAddOns, itemMap])

  const addOnCount =
    selectedActivities.size + selectedFood.size + selectedDesserts.size +
    selectedBeverages.size + selectedDecor.size + selectedEntertainment.size + selectedPartyAddOns.size

  /* ── reset ── */
  const handleReset = () => {
    setSelectedTheme(null)
    setGuestCount(INCLUDED_GUESTS)
    setSelectedActivities(new Set())
    setSelectedFood(new Set())
    setFoodQty(new Map())
    setSelectedDesserts(new Set())
    setSelectedBeverages(new Set())
    setSelectedDecor(new Set())
    setDecorQty(new Map())
    setSelectedEntertainment(new Set())
    setSelectedPartyAddOns(new Set())
    setSaveSuccess(false)
    setCalendarSelection(null)
    setPaymentSuccess(false)
    setCheckoutReady(false)
  }

  /* ── build structured line items ── */
  function getLineItems() {
    const lineItems: { name: string; category: string; quantity: number; unit_price_cents: number; price_type: string; guest_multiplied: boolean; pricing_item_id?: string }[] = []
    if (themeItem) {
      let themePriceCents = themeItem.price_cents
      if (isMiniParty) themePriceCents = Math.max(0, themePriceCents - MINI_PARTY_DISCOUNT_CENTS)
      lineItems.push({ name: themeItem.name, category: 'theme', quantity: 1, unit_price_cents: themePriceCents, price_type: 'flat', guest_multiplied: false, pricing_item_id: themeItem.id })
    }
    if (extraGuests > 0) {
      lineItems.push({ name: 'Additional Guests', category: 'theme', quantity: extraGuests, unit_price_cents: EXTRA_GUEST_CENTS, price_type: 'flat', guest_multiplied: false })
    }
    const addFromSet = (ids: Set<string>, cat: string, qtyMap?: Map<string, number>) => {
      for (const id of Array.from(ids)) {
        const item = itemMap.get(id)
        if (!item) continue
        const qty = qtyMap?.get(id) ?? 1
        lineItems.push({
          name: item.name, category: cat, quantity: qty,
          unit_price_cents: item.price_cents,
          price_type: item.price_type === 'per_person' ? 'per_person' : 'flat',
          guest_multiplied: item.price_type === 'per_person',
          pricing_item_id: item.id,
        })
      }
    }
    addFromSet(selectedActivities, 'activity-add-on')
    addFromSet(selectedFood, 'food-add-on', foodQty)
    addFromSet(selectedDesserts, 'dessert-add-on')
    addFromSet(selectedBeverages, 'beverage-add-on')
    addFromSet(selectedDecor, 'decor-add-on', decorQty)
    addFromSet(selectedEntertainment, 'entertainment-add-on')
    addFromSet(selectedPartyAddOns, 'extra')
    return lineItems
  }

  function buildSummary(): string {
    const lines: string[] = []
    if (themeItem) lines.push(`Theme: ${themeItem.name} (${fmt(themeItem.price_cents)})`)
    if (isMiniParty) lines.push(`Mini Party: -$200 · 1.5 hours · max ${MINI_PARTY_MAX_GUESTS} guests`)
    lines.push(`Guests: ${effectiveGuestCount}${extraGuests > 0 ? ` (${extraGuests} additional @ $35 each)` : ''}`)
    const section = (label: string, ids: Set<string>, qtyMap?: Map<string, number>) => {
      if (ids.size === 0) return
      const names = Array.from(ids).map(id => {
        const item = itemMap.get(id)
        if (!item) return ''
        const qty = qtyMap?.get(id) ?? 1
        const qtyStr = qty > 1 ? ` x${qty}` : ''
        if (item.price_cents === 0) return item.name
        if (item.price_type === 'per_person') {
          return `${item.name}${qtyStr} (${fmt(item.price_cents)}/person = ${fmt(item.price_cents * guestCount * qty)})`
        }
        const lineTotal = qty > 1 ? ` = ${fmt(item.price_cents * qty)}` : ''
        return `${item.name}${qtyStr} (${fmt(item.price_cents)}${lineTotal})`
      }).filter(Boolean)
      lines.push(`${label}: ${names.join(', ')}`)
    }
    section('Activities', selectedActivities)
    section('Food', selectedFood, foodQty)
    section('Desserts', selectedDesserts)
    section('Beverages', selectedBeverages)
    section('Decor', selectedDecor, decorQty)
    section('Entertainment', selectedEntertainment)
    section('Extras', selectedPartyAddOns)
    if (total > 0) lines.push(`\nEstimated Total: ${fmt(total)}`)
    if (contact.partyName) lines.push(`Party: ${contact.partyName}`)
    return lines.join('\n')
  }

  /* ── save for later ── */
  async function handleSaveForLater() {
    if (!contact.fullName || !contact.email || !contact.phone) {
      setError('Please fill in Name, Email, and Phone to save your quote.')
      return
    }
    setError('')
    setSaving(true)
    setSaveSuccess(false)
    try {
      const res = await fetch('/api/party-builder/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: getLineItems(),
          contactName: contact.fullName,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          childName: contact.partyName || undefined,
          guestCount: effectiveGuestCount,
          partyDate: calendarSelection?.date || undefined,
          partyTime: calendarSelection?.timeSlot?.start || undefined,
          packageType: themeItem?.name || 'Kids Party',
          isMiniParty,
          notes: undefined,
          marketingConsent: consent,
          quoteData: {
            theme: selectedTheme, themeName: themeItem?.name ?? null, guestCount,
            activities: Array.from(selectedActivities), food: Array.from(selectedFood),
            desserts: Array.from(selectedDesserts), decor: Array.from(selectedDecor),
            entertainment: Array.from(selectedEntertainment), beverages: Array.from(selectedBeverages),
            extras: Array.from(selectedPartyAddOns), contactName: contact.fullName,
            contactEmail: contact.email, contactPhone: contact.phone,
            partyName: contact.partyName, isMiniParty,
            foodQtyMap: Object.fromEntries(foodQty), decorQtyMap: Object.fromEntries(decorQty),
          },
        }),
      })
      const data = await res.json()
      if (res.ok && data.bookingRef) {
        setLoadedBooking(prev => prev ? { ...prev, booking_ref: data.bookingRef } : {
          booking_ref: data.bookingRef, status: 'awaiting_deposit',
          total_cents: total, balance_due_cents: Math.max(0, total - DEPOSIT_CENTS), deposit_amount: DEPOSIT_CENTS,
        })
      }
      setSaveSuccess(true)
    } catch { /* silent */ }
    setSaving(false)
  }

  /* ── book party (pay deposit) ── */
  async function handlePayDeposit() {
    if (!contact.fullName || !contact.email || !contact.phone) {
      setPayError('Please fill in your contact info above.')
      return
    }
    if (!selectedTheme) {
      setPayError('Please select a theme package.')
      return
    }
    if (!calendarSelection?.date || !calendarSelection?.timeSlot) {
      setPayError('Please select a date and time.')
      return
    }

    setPayProcessing(true)
    setPayError('')

    if (embeddedCheckoutRef.current) {
      embeddedCheckoutRef.current.destroy()
      embeddedCheckoutRef.current = null
    }
    setCheckoutReady(false)

    try {
      // Submit lead + create booking + get Stripe session
      const res = await fetch('/api/party-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: getLineItems(),
          contact: {
            fullName: contact.fullName,
            email: contact.email,
            phone: contact.phone,
            childName: contact.partyName || '',
          },
          guestCount: effectiveGuestCount,
          partyDate: calendarSelection.date,
          partyTime: calendarSelection.timeSlot.start,
          paymentMethod: 'card',
          isMiniParty,
          summary: buildSummary(),
          totalCents: total,
          marketingConsent: consent,
          embedded: true,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setPayError(data.error || 'Booking failed')
        setPayProcessing(false)
        return
      }

      if (data.clientSecret) {
        const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        if (!stripeKey) { setPayError('Payment configuration error'); setPayProcessing(false); return }
        const stripe = await loadStripe(stripeKey)
        if (!stripe) { setPayError('Failed to load payment processor'); setPayProcessing(false); return }
        const checkout = await stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret })
        setPayProcessing(false)
        setCheckoutReady(true)
        setTimeout(() => {
          if (checkoutRef.current) {
            checkout.mount(checkoutRef.current)
            embeddedCheckoutRef.current = checkout
          }
        }, 50)
      } else if (data.url) {
        window.location.href = data.url
      }
    } catch (err: any) {
      setPayError(err.message || 'Something went wrong')
      setPayProcessing(false)
    }
  }

  // Cleanup embedded checkout on unmount
  useEffect(() => {
    return () => {
      if (embeddedCheckoutRef.current) embeddedCheckoutRef.current.destroy()
    }
  }, [])

  function updateContact(field: string, value: string) {
    setContact(prev => ({ ...prev, [field]: value }))
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const balloonDecor = decor.filter(d => BALLOON_QTY_ITEMS.has(d.name))
  const regularDecor = decor.filter(d => !BALLOON_QTY_ITEMS.has(d.name))
  const rentalIsWeekday = rentalDate ? isWeekday(rentalDate) : null

  // Summary line items for display
  const summaryLineItems = useMemo(() => {
    const items: { label: string; detail?: string; amount: number }[] = []
    if (themeItem) {
      const price = isMiniParty ? Math.max(0, themeItem.price_cents - MINI_PARTY_DISCOUNT_CENTS) : themeItem.price_cents
      items.push({ label: themeItem.name, detail: isMiniParty ? 'Mini Party' : undefined, amount: price })
    }
    if (extraGuests > 0) {
      items.push({ label: `Additional Guests (${extraGuests})`, detail: `@ $35 each`, amount: extraGuests * EXTRA_GUEST_CENTS })
    }
    const addSection = (label: string, ids: Set<string>, qtyMap?: Map<string, number>) => {
      for (const id of Array.from(ids)) {
        const item = itemMap.get(id)
        if (!item) continue
        const qty = qtyMap?.get(id) ?? 1
        const lineAmount = item.price_type === 'per_person'
          ? item.price_cents * effectiveGuestCount * qty
          : item.price_cents * qty
        const qtyStr = qty > 1 ? ` x${qty}` : ''
        const perPerson = item.price_type === 'per_person' ? ` (${fmt(item.price_cents)}/person)` : ''
        items.push({ label: `${item.name}${qtyStr}`, detail: `${label}${perPerson}`, amount: lineAmount })
      }
    }
    addSection('Activity', selectedActivities)
    addSection('Food', selectedFood, foodQty)
    addSection('Dessert', selectedDesserts)
    addSection('Beverage', selectedBeverages)
    addSection('Decor', selectedDecor, decorQty)
    addSection('Entertainment', selectedEntertainment)
    addSection('Extra', selectedPartyAddOns)
    return items
  }, [themeItem, isMiniParty, extraGuests, effectiveGuestCount, selectedActivities, selectedFood, foodQty, selectedDesserts, selectedBeverages, selectedDecor, decorQty, selectedEntertainment, selectedPartyAddOns, itemMap])

  const hasSelections = selectedTheme || addOnCount > 0
  const depositFee = calculateCardFee(DEPOSIT_CENTS)
  const contactComplete = contact.fullName && contact.email && contact.phone
  const dateTimeSelected = calendarSelection?.date && calendarSelection?.timeSlot

  return (
    <div className="pb-36">
      {/* ── Hero ── */}
      <section className="py-20 text-center px-4">
        <h1 className="font-serif text-5xl md:text-6xl font-black tracking-tight text-hampton-navy mb-3">
          {loadedBooking ? 'YOUR PARTY PLAN' : 'HOST HAMPTON PARTY PLAN'}
        </h1>
        <p className="text-lg font-semibold tracking-[0.25em] text-hampton-navy/50 uppercase">
          {loadedBooking ? `Booking ${loadedBooking.booking_ref}` : 'Build · Customize · Reserve'}
        </p>
        <p className="text-hampton-navy/70 text-base max-w-xl mx-auto mt-4 leading-relaxed">
          {loadedBooking
            ? 'Review your party plan below, customize your add-ons, and pay your $99 deposit to lock it in.'
            : 'Browse everything we offer, tap items to build your custom party plan, and see your estimated total in real time.'}
        </p>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-10 pb-10">

        {/* ── Booking status banner ── */}
        {loadedBooking && (
          <div className="bg-gradient-to-r from-hampton-blue/10 to-hampton-pink/10 border border-hampton-blue/20 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
            <div>
              <p className="text-sm font-bold text-hampton-navy">
                Booking {loadedBooking.booking_ref}
                <span className={`ml-2 inline-block px-2.5 py-0.5 text-xs rounded-full font-semibold ${
                  loadedBooking.status === 'approved' ? 'bg-green-100 text-green-800' :
                  loadedBooking.status === 'pending_review' ? 'bg-yellow-100 text-yellow-800' :
                  loadedBooking.status === 'paid_in_full' ? 'bg-green-100 text-green-800' :
                  'bg-hampton-blue/15 text-hampton-navy'
                }`}>
                  {loadedBooking.status.replace(/_/g, ' ')}
                </span>
              </p>
              <p className="text-xs text-hampton-navy/50 mt-1">
                Make changes below, then click &quot;Save &amp; Email My Quote&quot; to update.
              </p>
            </div>
            {loadedPayments.length > 0 && (
              <div className="text-right shrink-0">
                <p className="text-xs text-hampton-navy/50">Paid so far</p>
                <p className="text-lg font-bold text-green-700">
                  {fmt(loadedPayments.reduce((sum, p) => sum + (p.payment_type === 'refund' ? -p.amount_cents : p.amount_cents), 0))}
                </p>
              </div>
            )}
          </div>
        )}

        {bookingLoading && !restored && (
          <div className="text-center py-8">
            <Loader2 size={24} className="animate-spin mx-auto text-hampton-navy/40" />
            <p className="text-sm text-hampton-navy/40 mt-2">Loading your booking...</p>
          </div>
        )}

        {/* ══ 1. Themed Party Packages ══ */}
        <CategoryModule title="THEMED PARTY PACKAGES" subtitle="2 Hours Private Studio &bull; Everything Included" headerBg="bg-hampton-navy">
          <div className="mb-6 bg-hampton-blue/10 border-l-4 border-hampton-blue p-5 rounded-r-lg -mt-2">
            <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1">All-Inclusive Celebration</h3>
            <p className="text-xs text-hampton-navy/70 leading-relaxed font-medium">
              Every package includes 2 hours of private studio time, a dedicated party host, full themed decorations,
              activities &amp; entertainment, pizza or bagels, cupcakes for all guests, treat cart, digital EVITE, and complete cleanup.
              10 guests + Birthday Star included. Additional guests $35 each.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {themes.map(t => (
              <SelectableThemeCard key={t.id} item={t} selected={selectedTheme === t.id}
                onClick={() => setSelectedTheme(selectedTheme === t.id ? null : t.id)} />
            ))}
          </div>

          {selectedTheme && (
            <div className="mt-6">
              <button type="button" onClick={() => {
                setIsMiniParty(!isMiniParty)
                if (!isMiniParty && guestCount > MINI_PARTY_MAX_GUESTS) setGuestCount(MINI_PARTY_MAX_GUESTS)
              }}
                className={`w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl border-2 transition-all duration-200 ${
                  isMiniParty ? 'border-hampton-navy bg-hampton-navy text-white' : 'border-hampton-mauve/30 bg-hampton-blue/5 hover:border-hampton-navy/40'
                }`}>
                <div className="flex items-center gap-3 text-left">
                  <Zap size={18} className={isMiniParty ? 'text-hampton-pink' : 'text-hampton-navy/60'} />
                  <div>
                    <p className={`font-bold text-sm ${isMiniParty ? 'text-white' : 'text-hampton-navy'}`}>
                      Make it a Mini Party <span className="ml-2 text-xs font-black text-hampton-pink">Save $200</span>
                    </p>
                    <p className={`text-xs mt-0.5 ${isMiniParty ? 'text-white/70' : 'text-hampton-navy/50'}`}>
                      Max 7 guests + birthday child &bull; 1.5 hour experience
                    </p>
                  </div>
                </div>
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  isMiniParty ? 'border-white bg-hampton-pink' : 'border-hampton-mauve/40'
                }`}>
                  {isMiniParty && <Check size={14} className="text-white" />}
                </span>
              </button>
              {isMiniParty && (
                <p className="text-xs text-hampton-navy/50 mt-2 text-center">
                  Perfect for intimate celebrations — birthday child + up to 7 guests.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 text-center">
            <p className="text-[11px] font-bold text-hampton-pink bg-hampton-pink/10 inline-block px-4 py-1.5 rounded-full border border-hampton-pink/20">
              $99 Deposit to Reserve &bull; Fully Applied Toward Balance
            </p>
          </div>

          {/* ── DIY Party ── */}
          <div className="mt-8 pt-7 border-t-2 border-dashed border-hampton-mauve/25">
            <button type="button" onClick={() => setIsDIYOpen(o => !o)}
              className={`w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl border-2 transition-all duration-200 ${
                isDIYOpen ? 'border-hampton-navy bg-hampton-navy text-white' : 'border-hampton-mauve/30 bg-hampton-blue/5 hover:border-hampton-navy/40'
              }`}>
              <div className="flex items-center gap-3 text-left">
                <Building2 size={18} className={isDIYOpen ? 'text-hampton-pink' : 'text-hampton-navy/60'} />
                <div>
                  <p className={`font-bold text-sm ${isDIYOpen ? 'text-white' : 'text-hampton-navy'}`}>DIY Party — Rent the Studio</p>
                  <p className={`text-xs mt-0.5 ${isDIYOpen ? 'text-white/70' : 'text-hampton-navy/50'}`}>Bring your own decorations &bull; 3 hr minimum</p>
                </div>
              </div>
              <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                isDIYOpen ? 'border-white bg-hampton-pink' : 'border-hampton-mauve/40'
              }`}>
                {isDIYOpen && <Check size={14} className="text-white" />}
              </span>
            </button>
            {isDIYOpen && (
              <div className="mt-4">
                <p className="text-xs text-hampton-navy/50 mb-5 leading-relaxed">
                  Bring your own vision. <strong className="text-hampton-navy/70">3-hour minimum.</strong> Setup and cleanup time must be included within your rental window.
                </p>
                <div className="mb-5">
                  <label className="form-label">Select Preferred Date</label>
                  <input type="date" value={rentalDate} onChange={e => setRentalDate(e.target.value)} className="form-input max-w-xs" />
                  {rentalDate && (
                    <p className="text-xs text-hampton-blue mt-1.5 font-semibold">
                      {rentalIsWeekday ? 'Weekday rate applies (Mon–Thu)' : 'Weekend rate applies (Fri–Sun)'}
                    </p>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className={`rounded-2xl p-5 border-2 transition-all duration-200 ${
                    rentalIsWeekday === true ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : rentalIsWeekday === false ? 'border-hampton-mauve/20 bg-white opacity-60' : 'border-hampton-mauve/25 bg-white'
                  }`}>
                    <p className="text-[10px] font-bold text-hampton-navy/50 uppercase tracking-widest mb-2">Weekday · Mon–Thu</p>
                    <p className="text-3xl font-bold text-hampton-navy">${RENTAL_WEEKDAY_3HR}</p>
                    <p className="text-xs text-hampton-navy/50 mt-0.5">3 hr minimum</p>
                    <div className="mt-3 pt-3 border-t border-hampton-mauve/15">
                      <p className="text-xs text-hampton-navy/60">Additional hour: <span className="font-bold text-hampton-navy">${RENTAL_ADD_HR_WEEKDAY}/hr</span></p>
                    </div>
                  </div>
                  <div className={`rounded-2xl p-5 border-2 transition-all duration-200 ${
                    rentalIsWeekday === false ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : rentalIsWeekday === true ? 'border-hampton-mauve/20 bg-white opacity-60' : 'border-hampton-mauve/25 bg-white'
                  }`}>
                    <p className="text-[10px] font-bold text-hampton-navy/50 uppercase tracking-widest mb-2">Weekend · Fri–Sun</p>
                    <p className="text-3xl font-bold text-hampton-navy">${RENTAL_WEEKEND_3HR}</p>
                    <p className="text-xs text-hampton-navy/50 mt-0.5">3 hr minimum</p>
                    <div className="mt-3 pt-3 border-t border-hampton-mauve/15">
                      <p className="text-xs text-hampton-navy/60">Additional hour: <span className="font-bold text-hampton-navy">${RENTAL_ADD_HR_WEEKEND}/hr</span></p>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-hampton-navy/35 mt-3 text-center">Outside vendors require prior approval &bull; Space accommodates up to 25 guests</p>
                <div className="mt-3 text-center">
                  <a href="/party-room-rental" className="text-hampton-navy text-xs font-semibold underline underline-offset-2 hover:text-hampton-blue transition-colors">
                    View full rental details &amp; availability →
                  </a>
                </div>
              </div>
            )}
          </div>
        </CategoryModule>

        {/* ══ 2. Guest Count ══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-hampton-navy/60" />
              <div>
                <p className="font-semibold text-hampton-navy text-sm">
                  {effectiveGuestCount} guest{effectiveGuestCount !== 1 ? 's' : ''} + birthday child
                  {isMiniParty && <span className="ml-2 text-xs text-hampton-pink font-bold">(Mini Party max 7)</span>}
                </p>
                {extraGuests > 0 && (
                  <p className="text-xs text-hampton-navy/50 mt-0.5">{extraGuests} additional @ $35 each = {fmt(extraGuests * EXTRA_GUEST_CENTS)}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                className="w-9 h-9 rounded-lg border-2 border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors disabled:opacity-30" disabled={guestCount <= 1}>
                <Minus size={14} />
              </button>
              <span className="w-10 text-center font-bold text-hampton-navy text-lg">{effectiveGuestCount}</span>
              <button type="button" onClick={() => setGuestCount(Math.min(isMiniParty ? MINI_PARTY_MAX_GUESTS : 50, guestCount + 1))}
                className="w-9 h-9 rounded-lg border-2 border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors disabled:opacity-30" disabled={effectiveGuestCount >= (isMiniParty ? MINI_PARTY_MAX_GUESTS : 50)}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          {effectiveGuestCount <= INCLUDED_GUESTS && (
            <p className="text-xs text-hampton-blue mt-3 font-medium">
              {isMiniParty ? `Mini Party: up to ${MINI_PARTY_MAX_GUESTS} guests + birthday child · 1.5 hours · $200 off.` : `Up to ${INCLUDED_GUESTS} guests are included with every theme party.`}
            </p>
          )}
        </div>

        {/* ══ 3. Activities ══ */}
        {(premiumActivities.length > 0 || standardActivities.length > 0) && (
          <CategoryModule title="ACTIVITIES" subtitle="Included With Every Party Package" headerBg="bg-hampton-navy">
            {premiumActivities.length > 0 && (
              <div className="mb-6">
                <h3 className="font-serif font-bold text-lg text-hampton-navy mb-4 border-b border-gray-200 pb-2">Premium Activities</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {premiumActivities.map(a => (
                    <SelectableActivityChip key={a.id} item={a} selected={selectedActivities.has(a.id)}
                      onClick={() => toggle(selectedActivities, setSelectedActivities, a.id)} />
                  ))}
                </div>
              </div>
            )}
            {standardActivities.length > 0 && (
              <div>
                <h3 className="font-serif font-bold text-lg text-hampton-navy mb-4 border-b border-gray-200 pb-2">Standard Activities</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {standardActivities.map(a => (
                    <SelectableActivityChip key={a.id} item={a} selected={selectedActivities.has(a.id)}
                      onClick={() => toggle(selectedActivities, setSelectedActivities, a.id)} />
                  ))}
                </div>
              </div>
            )}
          </CategoryModule>
        )}

        {/* ══ 4. Food & Catering ══ */}
        {food.length > 0 && (
          <CategoryModule title="FOOD &amp; CATERING" subtitle="Upgrade Your Menu" titleColor="text-hampton-pink">
            <AddOnGridWithQty items={food} selected={selectedFood} qty={foodQty} onToggle={toggleFood} onQtyChange={setFoodItemQty} />
          </CategoryModule>
        )}

        {/* ══ 5. Desserts ══ */}
        {desserts.length > 0 && (
          <CategoryModule title="DESSERTS" subtitle="Sweet Additions" headerBg="bg-gradient-to-r from-hampton-pink to-hampton-mauve">
            <AddOnGrid items={desserts} selected={selectedDesserts} onToggle={id => toggle(selectedDesserts, setSelectedDesserts, id)} />
          </CategoryModule>
        )}

        {/* ══ 6. Beverages ══ */}
        {beverages.length > 0 && (
          <CategoryModule title="BEVERAGES" subtitle="Refreshments" titleColor="text-hampton-pink">
            <AddOnGrid items={beverages} selected={selectedBeverages} onToggle={id => toggle(selectedBeverages, setSelectedBeverages, id)} />
          </CategoryModule>
        )}

        {/* ══ 7. Decor ══ */}
        {decor.length > 0 && (
          <CategoryModule title="DECOR UPGRADES" subtitle="Elevate the Atmosphere" headerBg="bg-hampton-navy">
            {balloonDecor.length > 0 && (
              <div className="mb-5">
                <p className="text-hampton-navy/50 text-xs font-semibold tracking-widest uppercase mb-3">Balloon Arrangements</p>
                <AddOnGridWithQty items={balloonDecor} selected={selectedDecor} qty={decorQty}
                  onToggle={id => { const item = decor.find(d => d.id === id); if (item) toggleDecor(id, item.name) }}
                  onQtyChange={setDecorItemQty} />
              </div>
            )}
            {regularDecor.length > 0 && (
              <div>
                {balloonDecor.length > 0 && <p className="text-hampton-navy/50 text-xs font-semibold tracking-widest uppercase mb-3">Other Decor</p>}
                <AddOnGrid items={regularDecor} selected={selectedDecor}
                  onToggle={id => { const item = decor.find(d => d.id === id); if (item) toggleDecor(id, item.name) }} />
              </div>
            )}
          </CategoryModule>
        )}

        {/* ══ 8. Entertainment ══ */}
        {entertainment.length > 0 && (
          <CategoryModule title="ENTERTAINMENT" subtitle="Make It Unforgettable" titleColor="text-hampton-pink">
            <AddOnGrid items={entertainment} selected={selectedEntertainment} onToggle={id => toggle(selectedEntertainment, setSelectedEntertainment, id)} />
          </CategoryModule>
        )}

        {/* ══ 9. Party Extras ══ */}
        {partyAddOns.length > 0 && (
          <CategoryModule title="PARTY EXTRAS" subtitle="Favors &amp; Finishing Touches" headerBg="bg-gradient-to-r from-hampton-pink to-hampton-mauve">
            <AddOnGrid items={partyAddOns} selected={selectedPartyAddOns} onToggle={id => toggle(selectedPartyAddOns, setSelectedPartyAddOns, id)} />
          </CategoryModule>
        )}

        {/* ══ 10. Save Your Quote (simplified contact form) ══ */}
        <div ref={formRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-hampton-navy px-8 py-6 text-center">
            <h2 className="font-serif text-2xl font-black text-white tracking-tight">SAVE YOUR QUOTE</h2>
            <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
              We&apos;ll Email You a Link to Pick Up Where You Left Off
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Full Name *</label>
                <input type="text" required placeholder="Jane Smith" value={contact.fullName}
                  onChange={e => updateContact('fullName', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Email *</label>
                <input type="email" required placeholder="jane@email.com" value={contact.email}
                  onChange={e => updateContact('email', e.target.value)} className="form-input" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Phone *</label>
                <input type="tel" required placeholder="(631) 555-1234" value={contact.phone}
                  onChange={e => updateContact('phone', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Child&apos;s Name / Party Name</label>
                <input type="text" placeholder="Cora's 8th Birthday!" value={contact.partyName}
                  onChange={e => updateContact('partyName', e.target.value)} className="form-input" />
              </div>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-hampton-mauve/40 text-hampton-navy focus:ring-hampton-blue" />
              <span className="text-xs text-hampton-navy/60 leading-relaxed">
                I agree to receive event updates and promotions from Host Hampton via email and text message.
                Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
                View our <a href="/privacy-policy" className="underline">Privacy Policy</a> &amp; <a href="/terms-of-service" className="underline">Terms</a>.
              </span>
            </label>

            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>}
            {saveSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                <Check size={16} /> Saved! Check your email for a link to pick up where you left off.
              </div>
            )}

            <button type="button" onClick={handleSaveForLater} disabled={saving}
              className="w-full border-2 border-hampton-navy text-hampton-navy font-bold py-3.5 px-6 rounded-full text-sm hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Bookmark size={16} /> {loadedBooking ? 'Update My Party Plan' : 'Save & Email My Party Plan'}</>}
            </button>
          </div>
        </div>

        {/* ══ 11. Party Summary ══ */}
        {hasSelections && (
          <div ref={summaryRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-gradient-to-r from-hampton-navy to-hampton-navy/90 px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">PARTY SUMMARY</h2>
              <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                {effectiveGuestCount} Guests + Birthday Star
              </p>
            </div>

            <div className="p-6 sm:p-8">
              {/* Contact snapshot */}
              {(contact.fullName || contact.partyName) && (
                <div className="mb-5 pb-4 border-b border-hampton-mauve/15">
                  {contact.partyName && <p className="font-serif font-bold text-lg text-hampton-navy">{contact.partyName}</p>}
                  {contact.fullName && <p className="text-sm text-hampton-navy/60">{contact.fullName}{contact.email ? ` · ${contact.email}` : ''}{contact.phone ? ` · ${contact.phone}` : ''}</p>}
                </div>
              )}

              {/* Line items */}
              <div className="space-y-0">
                {summaryLineItems.map((li, idx) => (
                  <div key={idx} className="flex items-baseline justify-between py-2 border-b border-hampton-mauve/10 last:border-0">
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-medium text-hampton-navy">{li.label}</p>
                      {li.detail && <p className="text-xs text-hampton-navy/40">{li.detail}</p>}
                    </div>
                    <span className="text-sm font-bold text-hampton-navy whitespace-nowrap">
                      {li.amount > 0 ? fmt(li.amount) : 'Included'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="flex items-baseline justify-between mt-4 pt-4 border-t-2 border-hampton-navy">
                <span className="font-serif font-bold text-lg text-hampton-navy">Estimated Total</span>
                <span className="font-serif font-bold text-2xl text-hampton-navy">{fmt(total)}</span>
              </div>

              {/* Deposit callout */}
              <div className="mt-4 bg-hampton-pink/10 border border-hampton-pink/20 rounded-xl p-4 text-center">
                <p className="text-sm text-hampton-navy font-medium">
                  <span className="font-bold">$99 deposit</span> to reserve your date — fully applied toward your balance
                </p>
                <p className="text-xs text-hampton-navy/50 mt-1">
                  Remaining balance of <span className="font-bold">{fmt(Math.max(0, total - DEPOSIT_CENTS))}</span> due before event
                </p>
              </div>

              {/* Payment history */}
              {loadedPayments.length > 0 && (
                <div className="mt-6 pt-5 border-t-2 border-hampton-navy/10">
                  <h3 className="font-serif font-bold text-sm text-hampton-navy mb-3 uppercase tracking-wider">Payment History</h3>
                  <div className="space-y-2">
                    {loadedPayments.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-green-800 capitalize">{p.payment_type}</span>
                          <span className="text-green-600 ml-2">via {p.payment_method}</span>
                          <span className="text-green-500 ml-2 text-xs">
                            {new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                        <span className="font-bold text-green-800">{fmt(p.amount_cents)}</span>
                      </div>
                    ))}
                  </div>
                  {loadedBooking && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-hampton-mauve/15 text-sm">
                      <span className="text-hampton-navy/60">Balance remaining</span>
                      <span className="font-bold text-hampton-navy">{fmt(loadedBooking.balance_due_cents)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ 12. Date & Time Selector ══ */}
        {hasSelections && (
          <div ref={calendarRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-hampton-navy px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">
                {dateLocked ? 'YOUR PARTY DATE' : 'CHOOSE YOUR DATE & TIME'}
              </h2>
              <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                {dateLocked ? 'Reserved for You' : 'Select an Available Party Slot'}
              </p>
            </div>

            <div className="p-6 sm:p-8">
              {dateLocked ? (
                <div className="bg-gradient-to-br from-hampton-pink/10 to-hampton-blue/10 border border-hampton-blue/20 rounded-2xl p-6 text-center">
                  <p className="text-xs font-semibold tracking-widest uppercase text-hampton-navy/50 mb-2">Your Reserved Slot</p>
                  {loadedBooking?.party_date && (
                    <p className="font-serif text-2xl font-black text-hampton-navy">
                      {new Date(loadedBooking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {loadedBooking?.party_time && (
                    <p className="text-lg text-hampton-navy/80 mt-1">
                      at {loadedBooking.party_time.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => {
                        const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                      })}
                    </p>
                  )}
                  <p className="text-xs text-hampton-navy/50 mt-4 leading-relaxed">
                    Your date &amp; time are locked in. Need to change them? Call us at{' '}
                    <a href="tel:6319989325" className="font-semibold underline">(631) 998-9325</a>{' '}
                    or email{' '}
                    <a href="mailto:hosthampton295@gmail.com" className="font-semibold underline">hosthampton295@gmail.com</a>.
                  </p>
                </div>
              ) : (
                <>
                  <UniversalCalendar
                    mode="booking"
                    lockedBookingType="kids-party"
                    expandable={false}
                    initialExpanded={true}
                    showSummary={false}
                    timeSlotHeading="Select Party Start Time"
                    showTimePlaceholder={true}
                    onSelect={(sel: CalendarSelection) => setCalendarSelection(sel)}
                  />

                  {calendarSelection?.date && calendarSelection?.timeSlot && (
                    <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                      <p className="text-green-800 text-sm font-medium">
                        {new Date(calendarSelection.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        {' '}at {calendarSelection.timeSlot.start.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => {
                          const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                        })}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ══ 13. Pay $99 Deposit ══ */}
        {hasSelections && (
          <div ref={payRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-gradient-to-r from-hampton-pink to-hampton-mauve px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">BOOK YOUR PARTY</h2>
              <p className="text-white/70 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                $99 Deposit &bull; Credit Card Only
              </p>
            </div>

            <div className="p-6 sm:p-8">
              {paymentSuccess ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-600" />
                  </div>
                  <h3 className="font-serif text-xl font-bold text-hampton-navy mb-2">You&apos;re Booked!</h3>
                  <p className="text-sm text-hampton-navy/60">Your $99 deposit has been received. We&apos;ll confirm your booking within 24 hours.</p>
                  <p className="text-sm text-hampton-navy/60 mt-1">Check your email for your portal link to manage your party.</p>
                </div>
              ) : checkoutReady ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-lg text-hampton-navy font-bold">Enter Card Details</h3>
                    <button onClick={() => {
                      if (embeddedCheckoutRef.current) { embeddedCheckoutRef.current.destroy(); embeddedCheckoutRef.current = null }
                      setCheckoutReady(false)
                    }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                  <div ref={checkoutRef} />
                </>
              ) : (
                <>
                  {/* Readiness checklist */}
                  <div className="space-y-3 mb-6">
                    <div className={`flex items-center gap-3 text-sm ${contactComplete ? 'text-green-700' : 'text-hampton-navy/40'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${contactComplete ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {contactComplete ? <Check size={12} /> : '1'}
                      </span>
                      Contact info {contactComplete ? '' : '(fill in above)'}
                    </div>
                    <div className={`flex items-center gap-3 text-sm ${selectedTheme ? 'text-green-700' : 'text-hampton-navy/40'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${selectedTheme ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {selectedTheme ? <Check size={12} /> : '2'}
                      </span>
                      Theme selected {selectedTheme ? `(${themeItem?.name})` : ''}
                    </div>
                    <div className={`flex items-center gap-3 text-sm ${dateTimeSelected ? 'text-green-700' : 'text-hampton-navy/40'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${dateTimeSelected ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {dateTimeSelected ? <Check size={12} /> : '3'}
                      </span>
                      Date &amp; time selected {dateTimeSelected ? '' : '(choose above)'}
                    </div>
                  </div>

                  {/* Price breakdown */}
                  <div className="bg-hampton-ivory/50 rounded-xl p-4 mb-5">
                    <div className="flex justify-between text-sm text-hampton-navy/70">
                      <span>Deposit</span>
                      <span>{formatMoney(DEPOSIT_CENTS)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-hampton-navy/50">
                      <span>Processing fee (3%)</span>
                      <span>{formatMoney(depositFee)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-hampton-navy mt-2 pt-2 border-t border-hampton-mauve/20">
                      <span>Total charge</span>
                      <span>{formatMoney(DEPOSIT_CENTS + depositFee)}</span>
                    </div>
                  </div>

                  {payError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">{payError}</div>}

                  <button
                    onClick={handlePayDeposit}
                    disabled={payProcessing || !contactComplete || !selectedTheme || !dateTimeSelected}
                    className="w-full bg-hampton-navy text-white font-bold py-4 px-6 rounded-full text-sm hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {payProcessing ? (
                      <><Loader2 size={16} className="animate-spin" /> Processing...</>
                    ) : (
                      <><CreditCard size={16} /> Pay {formatMoney(DEPOSIT_CENTS + depositFee)} — Book Your Party</>
                    )}
                  </button>

                  <p className="text-xs text-hampton-navy/40 text-center mt-3">
                    Your deposit is non-refundable and will be applied to your party total of {fmt(total)}.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Sticky Bottom Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t-2 border-hampton-mauve/20 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-hampton-navy/40 font-semibold uppercase tracking-widest">Estimated Total</p>
            <p className="text-2xl font-bold text-hampton-navy leading-tight">{total > 0 ? fmt(total) : '\u2014'}</p>
            <p className="text-xs text-hampton-navy/50 truncate">
              {themeItem
                ? `${themeItem.name}${addOnCount > 0 ? ` + ${addOnCount} add-on${addOnCount > 1 ? 's' : ''}` : ''}`
                : 'Select a theme to begin'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(selectedTheme || addOnCount > 0) && (
              <button type="button" onClick={handleReset}
                className="p-2.5 rounded-xl border border-hampton-mauve/30 text-hampton-navy/50 hover:text-hampton-navy hover:border-hampton-navy/30 transition-colors" title="Start over">
                <RotateCcw size={16} />
              </button>
            )}
            <button type="button" onClick={scrollToForm}
              className="bg-hampton-navy text-white font-bold px-3 sm:px-5 py-3 rounded-full text-sm hover:bg-opacity-90 transition-all flex items-center gap-1.5">
              <CreditCard size={14} />
              <span className="hidden sm:inline">Book Now</span>
              <span className="sm:hidden">Book</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
