'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { Check, Minus, Plus, Users, RotateCcw, Bookmark, Calendar, Loader2, Sparkles, Zap, Building2 } from 'lucide-react'
import type { PricingItem } from '@/components/QuoteBuilder/types'

/* ── constants ─────────────────────────────────────── */

const INCLUDED_GUESTS = 10
const EXTRA_GUEST_CENTS = 3500
const MINI_PARTY_DISCOUNT_CENTS = 20000 // $200 off
const MINI_PARTY_MAX_GUESTS = 7         // + birthday child
const LS_KEY = 'hh_quote_data'

// DIY Studio Rental rates (from pricing_items / room-rental category)
const RENTAL_WEEKDAY_3HR = 450   // $450
const RENTAL_WEEKEND_3HR = 575   // $575
const RENTAL_ADD_HR_WEEKDAY = 50 // $50/hr
const RENTAL_ADD_HR_WEEKEND = 100 // $100/hr

// Decor items that support qty (balloon products sold per unit)
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

/** Returns true for Mon–Thu, false for Fri–Sun. Safe against timezone issues. */
function isWeekday(dateStr: string): boolean {
  if (!dateStr) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day >= 1 && day <= 4
}

/* ── sub-components ────────────────────────────────── */

function CategoryModule({
  title,
  subtitle,
  headerBg,
  titleColor,
  children,
}: {
  title: string
  subtitle: string
  headerBg?: string
  titleColor?: string
  children: React.ReactNode
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

/** Add-on card with inline +/− quantity control, shown when item is selected */
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
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onQtyChange(qty - 1) }}
            className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors"
          >
            <Minus size={11} />
          </button>
          <span className="w-7 text-center font-bold text-hampton-navy text-sm">{qty}</span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onQtyChange(qty + 1) }}
            className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue transition-colors"
          >
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
          key={i.id}
          item={i}
          selected={selected.has(i.id)}
          qty={qty.get(i.id) ?? 1}
          onClick={() => onToggle(i.id)}
          onQtyChange={q => onQtyChange(i.id, q)}
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
}

export default function KidsPartyMenuContent({
  themes, premiumActivities, standardActivities,
  food, desserts, beverages, decor, entertainment, partyAddOns, savedQuote,
}: Props) {
  /* ── restore from ?q= URL param ── */
  const restored = useMemo(() => parseQuoteParam(savedQuote), [savedQuote])

  /* ── selection state ── */
  const [selectedTheme, setSelectedTheme] = useState<string | null>(restored?.theme ?? null)
  const [isMiniParty, setIsMiniParty] = useState(false)
  const [guestCount, setGuestCount] = useState(restored?.guestCount ?? INCLUDED_GUESTS)
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set(restored?.activities))
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set(restored?.food))
  const [foodQty, setFoodQty] = useState<Map<string, number>>(new Map())
  const [selectedDesserts, setSelectedDesserts] = useState<Set<string>>(new Set(restored?.desserts))
  const [selectedBeverages, setSelectedBeverages] = useState<Set<string>>(new Set(restored?.beverages))
  const [selectedDecor, setSelectedDecor] = useState<Set<string>>(new Set(restored?.decor))
  const [decorQty, setDecorQty] = useState<Map<string, number>>(new Map())
  const [selectedEntertainment, setSelectedEntertainment] = useState<Set<string>>(new Set(restored?.entertainment))
  const [selectedPartyAddOns, setSelectedPartyAddOns] = useState<Set<string>>(new Set(restored?.extras))

  /* ── DIY rental state ── */
  const [rentalDate, setRentalDate] = useState('')

  /* ── form state ── */
  const [contact, setContact] = useState({
    fullName: restored?.contactName || '', email: restored?.contactEmail || '', phone: restored?.contactPhone || '',
    preferredDate: '', guestCountField: '', partyName: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  const formRef = useRef<HTMLDivElement>(null)

  /* ── toggle helpers ── */
  const toggle = useCallback((set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFn(next)
  }, [])

  /** Food toggle also manages foodQty map */
  const toggleFood = useCallback((id: string) => {
    const nextSet = new Set(selectedFood)
    const nextQty = new Map(foodQty)
    if (nextSet.has(id)) {
      nextSet.delete(id)
      nextQty.delete(id)
    } else {
      nextSet.add(id)
      nextQty.set(id, 1)
    }
    setSelectedFood(nextSet)
    setFoodQty(nextQty)
  }, [selectedFood, foodQty])

  const setFoodItemQty = useCallback((id: string, qty: number) => {
    if (qty < 1) { toggleFood(id); return }
    setFoodQty(new Map(foodQty).set(id, qty))
  }, [foodQty, toggleFood])

  /** Decor toggle also manages decorQty for balloon items */
  const toggleDecor = useCallback((id: string, itemName: string) => {
    const nextSet = new Set(selectedDecor)
    const nextQty = new Map(decorQty)
    if (nextSet.has(id)) {
      nextSet.delete(id)
      nextQty.delete(id)
    } else {
      nextSet.add(id)
      if (BALLOON_QTY_ITEMS.has(itemName)) nextQty.set(id, 1)
    }
    setSelectedDecor(nextSet)
    setDecorQty(nextQty)
  }, [selectedDecor, decorQty])

  const setDecorItemQty = useCallback((id: string, qty: number) => {
    if (qty < 1) {
      const nextSet = new Set(selectedDecor)
      nextSet.delete(id)
      setSelectedDecor(nextSet)
      const nextQty = new Map(decorQty)
      nextQty.delete(id)
      setDecorQty(nextQty)
      return
    }
    setDecorQty(new Map(decorQty).set(id, qty))
  }, [selectedDecor, decorQty])

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

    // Activities — no qty
    for (const id of Array.from(selectedActivities)) {
      const item = itemMap.get(id)
      if (!item) continue
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
    }
    // Food — qty-aware
    for (const id of Array.from(selectedFood)) {
      const item = itemMap.get(id)
      if (!item) continue
      const qty = foodQty.get(id) ?? 1
      sum += item.price_type === 'per_person'
        ? item.price_cents * effectiveGuestCount * qty
        : item.price_cents * qty
    }
    // Desserts, Beverages, Entertainment, Party add-ons — no qty
    const flatNoQty = [
      ...Array.from(selectedDesserts), ...Array.from(selectedBeverages),
      ...Array.from(selectedEntertainment), ...Array.from(selectedPartyAddOns),
    ]
    for (const id of flatNoQty) {
      const item = itemMap.get(id)
      if (!item) continue
      sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
    }
    // Decor — qty-aware for balloon items
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
    setSubmitted(false)
  }

  /* ── build summary ── */
  function buildSummary(): string {
    const lines: string[] = []
    if (themeItem) lines.push(`Theme: ${themeItem.name} (${fmt(themeItem.price_cents)})`)
    if (isMiniParty) lines.push(`Mini Party: −$200 · 1.5 hours · max ${MINI_PARTY_MAX_GUESTS} guests`)
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
          const lineTotal = fmt(item.price_cents * guestCount * qty)
          return `${item.name}${qtyStr} (${fmt(item.price_cents)}/person = ${lineTotal})`
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

  function getQuoteData() {
    return {
      theme: selectedTheme,
      themeName: themeItem?.name ?? null,
      guestCount,
      foodChoice: null,
      cupcakeFlavor: null,
      activities: Array.from(selectedActivities),
      food: Array.from(selectedFood),
      desserts: Array.from(selectedDesserts),
      decor: Array.from(selectedDecor),
      entertainment: Array.from(selectedEntertainment),
      beverages: Array.from(selectedBeverages),
      extras: Array.from(selectedPartyAddOns),
      contactName: contact.fullName,
      contactEmail: contact.email,
      contactPhone: contact.phone,
    }
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
      await fetch('/api/quote/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contact.fullName,
          email: contact.email,
          phone: contact.phone,
          quoteData: getQuoteData(),
          summary: buildSummary(),
          partyDate: contact.preferredDate || null,
          partyTime: null,
          sourcePage: 'kids-party-menu',
        }),
      })
      setSaveSuccess(true)
    } catch { /* silent */ }
    setSaving(false)
  }

  /* ── check availability ── */
  async function handleCheckAvailability(e: React.FormEvent) {
    e.preventDefault()
    if (!contact.fullName || !contact.email || !contact.phone) {
      setError('Please fill in Name, Email, and Phone.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: contact.fullName,
          email: contact.email,
          phone: contact.phone,
          eventType: 'Kids Birthday Party',
          partyTheme: themeItem?.name || '',
          guestCount: contact.guestCountField || String(guestCount),
          preferredDate: contact.preferredDate,
          notes: contact.partyName ? `Party: ${contact.partyName}` : '',
          sourcePage: 'kids-party-menu',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Something went wrong')
      }
      const quotePayload = { ...getQuoteData(), summary: buildSummary(), totalCents: total }
      localStorage.setItem(LS_KEY, JSON.stringify(quotePayload))
      setSubmitted(true)
      const bookParams = new URLSearchParams({ type: 'kids-party', from: 'quote' })
      if (contact.preferredDate) bookParams.set('date', contact.preferredDate)
      window.location.href = `/book?${bookParams.toString()}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  function updateContact(field: string, value: string) {
    setContact(prev => ({ ...prev, [field]: value }))
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* ── split decor into balloon (qty) vs regular ── */
  const balloonDecor = decor.filter(d => BALLOON_QTY_ITEMS.has(d.name))
  const regularDecor = decor.filter(d => !BALLOON_QTY_ITEMS.has(d.name))

  /* ── rental rate label ── */
  const rentalIsWeekday = rentalDate ? isWeekday(rentalDate) : null

  return (
    <div className="pb-36">
      {/* ── Hero ── */}
      <section className="py-20 text-center px-4">
        <h1 className="font-serif text-5xl md:text-6xl font-black tracking-tight text-hampton-navy mb-3">
          KIDS PARTY MENU
        </h1>
        <p className="text-lg font-semibold tracking-[0.25em] text-hampton-navy/50 uppercase">
          Full Pricing &amp; Quote Builder
        </p>
        <p className="text-hampton-navy/70 text-base max-w-xl mx-auto mt-4 leading-relaxed">
          Browse everything we offer, tap items to build your custom quote, and
          see your estimated total in real time.
        </p>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-10 pb-10">

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

          {/* ── Mini Party Toggle ── */}
          {selectedTheme && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsMiniParty(!isMiniParty)
                  if (!isMiniParty && guestCount > MINI_PARTY_MAX_GUESTS) {
                    setGuestCount(MINI_PARTY_MAX_GUESTS)
                  }
                }}
                className={`w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl border-2 transition-all duration-200 ${
                  isMiniParty
                    ? 'border-hampton-navy bg-hampton-navy text-white'
                    : 'border-hampton-mauve/30 bg-hampton-blue/5 hover:border-hampton-navy/40'
                }`}
              >
                <div className="flex items-center gap-3 text-left">
                  <Zap size={18} className={isMiniParty ? 'text-hampton-pink' : 'text-hampton-navy/60'} />
                  <div>
                    <p className={`font-bold text-sm ${isMiniParty ? 'text-white' : 'text-hampton-navy'}`}>
                      Make it a Mini Party
                      <span className="ml-2 text-xs font-black text-hampton-pink">Save $200</span>
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

          {/* ── DIY Party — Rent the Studio ── */}
          <div className="mt-8 pt-7 border-t-2 border-dashed border-hampton-mauve/25">
            <div className="flex items-center gap-2.5 mb-1">
              <Building2 size={18} className="text-hampton-navy/60 shrink-0" />
              <h3 className="font-serif text-lg font-bold text-hampton-navy">DIY Party — Rent the Studio</h3>
            </div>
            <p className="text-xs text-hampton-navy/50 mb-5 leading-relaxed">
              Bring your own vision. <strong className="text-hampton-navy/70">3-hour minimum.</strong> Setup and cleanup time must be included within your rental window — plan accordingly.
            </p>

            {/* Date picker */}
            <div className="mb-5">
              <label className="form-label">Select Preferred Date</label>
              <input
                type="date"
                value={rentalDate}
                onChange={e => setRentalDate(e.target.value)}
                className="form-input max-w-xs"
              />
              {rentalDate && (
                <p className="text-xs text-hampton-blue mt-1.5 font-semibold">
                  {rentalIsWeekday
                    ? 'Weekday rate applies (Mon–Thu)'
                    : 'Weekend rate applies (Fri–Sun)'}
                </p>
              )}
            </div>

            {/* Rate cards */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className={`rounded-2xl p-5 border-2 transition-all duration-200 ${
                rentalIsWeekday === true
                  ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
                  : rentalIsWeekday === false
                    ? 'border-hampton-mauve/20 bg-white opacity-60'
                    : 'border-hampton-mauve/25 bg-white'
              }`}>
                <p className="text-[10px] font-bold text-hampton-navy/50 uppercase tracking-widest mb-2">Weekday · Mon–Thu</p>
                <p className="text-3xl font-bold text-hampton-navy">${RENTAL_WEEKDAY_3HR}</p>
                <p className="text-xs text-hampton-navy/50 mt-0.5">3 hr minimum</p>
                <div className="mt-3 pt-3 border-t border-hampton-mauve/15">
                  <p className="text-xs text-hampton-navy/60">
                    Additional hour: <span className="font-bold text-hampton-navy">${RENTAL_ADD_HR_WEEKDAY}/hr</span>
                  </p>
                </div>
              </div>

              <div className={`rounded-2xl p-5 border-2 transition-all duration-200 ${
                rentalIsWeekday === false
                  ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
                  : rentalIsWeekday === true
                    ? 'border-hampton-mauve/20 bg-white opacity-60'
                    : 'border-hampton-mauve/25 bg-white'
              }`}>
                <p className="text-[10px] font-bold text-hampton-navy/50 uppercase tracking-widest mb-2">Weekend · Fri–Sun</p>
                <p className="text-3xl font-bold text-hampton-navy">${RENTAL_WEEKEND_3HR}</p>
                <p className="text-xs text-hampton-navy/50 mt-0.5">3 hr minimum</p>
                <div className="mt-3 pt-3 border-t border-hampton-mauve/15">
                  <p className="text-xs text-hampton-navy/60">
                    Additional hour: <span className="font-bold text-hampton-navy">${RENTAL_ADD_HR_WEEKEND}/hr</span>
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-hampton-navy/35 mt-3 text-center">
              Outside vendors require prior approval &bull; Space accommodates up to 25 guests
            </p>
            <div className="mt-3 text-center">
              <a
                href="/party-room-rental"
                className="text-hampton-navy text-xs font-semibold underline underline-offset-2 hover:text-hampton-blue transition-colors"
              >
                View full rental details &amp; availability →
              </a>
            </div>
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
                  <p className="text-xs text-hampton-navy/50 mt-0.5">
                    {extraGuests} additional @ $35 each = {fmt(extraGuests * EXTRA_GUEST_CENTS)}
                  </p>
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
              {isMiniParty
                ? `Mini Party: up to ${MINI_PARTY_MAX_GUESTS} guests + birthday child · 1.5 hours · $200 off.`
                : `Up to ${INCLUDED_GUESTS} guests are included with every theme party.`
              }
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

        {/* ══ 4. Food & Catering — qty-aware ══ */}
        {food.length > 0 && (
          <CategoryModule title="FOOD &amp; CATERING" subtitle="Upgrade Your Menu" titleColor="text-hampton-pink">
            <AddOnGridWithQty
              items={food}
              selected={selectedFood}
              qty={foodQty}
              onToggle={toggleFood}
              onQtyChange={setFoodItemQty}
            />
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

        {/* ══ 7. Decor — balloon items get qty, rest are toggle-only ══ */}
        {decor.length > 0 && (
          <CategoryModule title="DECOR UPGRADES" subtitle="Elevate the Atmosphere" headerBg="bg-hampton-navy">
            {balloonDecor.length > 0 && (
              <div className="mb-5">
                <p className="text-hampton-navy/50 text-xs font-semibold tracking-widest uppercase mb-3">Balloon Arrangements</p>
                <AddOnGridWithQty
                  items={balloonDecor}
                  selected={selectedDecor}
                  qty={decorQty}
                  onToggle={id => {
                    const item = decor.find(d => d.id === id)
                    if (item) toggleDecor(id, item.name)
                  }}
                  onQtyChange={setDecorItemQty}
                />
              </div>
            )}
            {regularDecor.length > 0 && (
              <div>
                {balloonDecor.length > 0 && (
                  <p className="text-hampton-navy/50 text-xs font-semibold tracking-widest uppercase mb-3">Other Decor</p>
                )}
                <AddOnGrid
                  items={regularDecor}
                  selected={selectedDecor}
                  onToggle={id => {
                    const item = decor.find(d => d.id === id)
                    if (item) toggleDecor(id, item.name)
                  }}
                />
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

        {/* ══ 10. Contact Form + Save Quote ══ */}
        <div ref={formRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-hampton-navy px-8 py-6 text-center">
            <h2 className="font-serif text-2xl font-black text-white tracking-tight">SAVE YOUR QUOTE</h2>
            <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
              We&apos;ll Email You a Link to Pick Up Where You Left Off
            </p>
          </div>

          <form onSubmit={handleCheckAvailability} className="p-6 sm:p-8 space-y-5">
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
                <label className="form-label">Guest Count</label>
                <input type="number" min="1" max="50" placeholder="10" value={contact.guestCountField}
                  onChange={e => updateContact('guestCountField', e.target.value)} className="form-input" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Preferred Party Date</label>
                <input type="date" value={contact.preferredDate}
                  onChange={e => updateContact('preferredDate', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Party Name</label>
                <input type="text" placeholder="Cora's 8th Birthday!" value={contact.partyName}
                  onChange={e => updateContact('partyName', e.target.value)} className="form-input" />
              </div>
            </div>

            {/* Summary preview */}
            {(selectedTheme || addOnCount > 0) && (
              <div className="bg-hampton-ivory/50 rounded-xl p-4 border border-hampton-pink/10">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xs font-semibold text-hampton-navy/40 uppercase tracking-wider">Your Selections</p>
                  <p className="text-lg font-bold text-hampton-navy">{total > 0 ? fmt(total) : '\u2014'}</p>
                </div>
                <div className="space-y-1.5 text-sm text-hampton-navy">
                  {themeItem && (
                    <p><span className="font-semibold">Theme:</span> {themeItem.name} <span className="text-hampton-navy/50">({fmt(themeItem.price_cents)})</span></p>
                  )}
                  {extraGuests > 0 && (
                    <p><span className="font-semibold">Guests:</span> {guestCount} <span className="text-hampton-navy/50">({extraGuests} additional @ $35 each)</span></p>
                  )}
                  {[
                    { label: 'Activities', ids: selectedActivities },
                    { label: 'Food', ids: selectedFood },
                    { label: 'Desserts', ids: selectedDesserts },
                    { label: 'Beverages', ids: selectedBeverages },
                    { label: 'Decor', ids: selectedDecor },
                    { label: 'Entertainment', ids: selectedEntertainment },
                    { label: 'Extras', ids: selectedPartyAddOns },
                  ].filter(s => s.ids.size > 0).map(s => (
                    <p key={s.label}>
                      <span className="font-semibold">{s.label}:</span>{' '}
                      {Array.from(s.ids).map(id => {
                        const item = itemMap.get(id)
                        if (!item) return null
                        const qty = foodQty.get(id) ?? decorQty.get(id)
                        return qty && qty > 1 ? `${item.name} ×${qty}` : item.name
                      }).filter(Boolean).join(', ')}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {saveSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                <Check size={16} /> Saved! Check your email for a link to pick up where you left off.
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <button type="button" onClick={handleSaveForLater} disabled={saving}
                className="w-full border-2 border-hampton-navy text-hampton-navy font-bold py-3.5 px-6 rounded-full text-sm hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Bookmark size={16} /> Save &amp; Email My Quote</>}
              </button>
              <button type="submit" disabled={submitting || submitted}
                className="w-full bg-hampton-navy text-white font-bold py-3.5 px-6 rounded-full text-sm hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting...</> : <><Calendar size={16} /> Check Availability</>}
              </button>
            </div>
          </form>
        </div>

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
              <Calendar size={14} />
              <span className="hidden sm:inline">Get My Quote</span>
              <span className="sm:hidden">Quote</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
