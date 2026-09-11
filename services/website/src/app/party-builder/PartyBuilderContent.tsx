'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Check, Minus, Plus, Users, RotateCcw, Bookmark, Loader2, Sparkles, Zap, Building2, CreditCard, ChevronUp, ChevronDown, Trash2, X, Tag, Wallet, ShieldCheck, Save, Undo2, MessageCircle } from 'lucide-react'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import UniversalCalendar from '@/components/UniversalCalendar'
import type { CalendarSelection } from '@/components/UniversalCalendar/types'
import { loadStripe } from '@stripe/stripe-js'
import { formatMoney, calculateCardFee, getCategoryLockState, type LockCategory } from '@/lib/partyPricing'
import MyPartiesModal from './MyPartiesModal'
import ChangesModal from './ChangesModal'
import SendMessageModal from './SendMessageModal'
import { diffPlanSnapshots } from './planDiff'

/* ── constants ─────────────────────────────────────── */

const INCLUDED_GUESTS = 10
const EXTRA_GUEST_CENTS = 3500
const MINI_PARTY_DISCOUNT_CENTS = 20000
const MINI_PARTY_MAX_GUESTS = 6

// Mobile Party pricing tiers — flat base by guest-count band, plus travel
// fee from the mileage API. Activities priced per-activity-per-person.
const MOBILE_BASE_CENTS = 40000          // $400 for up to 18 guests
const MOBILE_TIER2_SURCHARGE_CENTS = 15000 // +$150 for 19–27 guests
const MOBILE_TIER3_SURCHARGE_CENTS = 15000 // +$150 again for 28+ guests
const MOBILE_TIER2_GUEST_THRESHOLD = 18
const MOBILE_TIER3_GUEST_THRESHOLD = 27
const LS_KEY = 'hh_quote_data'
// Flat $250 booking deposit (owner ruling 2026-09-05), clamped so it can never
// exceed the booking total. Mirrors getDepositCents() in lib/partyPricing.ts —
// keep the two in step.
const BOOKING_DEPOSIT_CENTS = 25000
const computeDeposit = (totalCents: number): number =>
  totalCents > 0 ? Math.min(BOOKING_DEPOSIT_CENTS, totalCents) : 0

const RENTAL_WEEKDAY_3HR = 475
const RENTAL_WEEKEND_3HR = 600
const RENTAL_ADD_HR_WEEKDAY = 100
const RENTAL_ADD_HR_WEEKEND = 150

const BALLOON_QTY_ITEMS = new Set([
  'Balloon Garland 6 ft.',
  'Balloon Tower 6 ft.',
  'Balloon Tower w/ Number',
  'Double Arch',
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
  title, subtitle, headerBg, titleColor, children, lock,
}: {
  title: string; subtitle: string; headerBg?: string; titleColor?: string; children: React.ReactNode
  lock?: { locked: boolean; reason?: string }
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
      <div className="p-6 sm:p-8">
        {lock?.locked && (
          <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-amber-700 mt-0.5">🔒</span>
            <div className="text-xs leading-relaxed">
              <p className="font-semibold text-amber-900">Locked for changes</p>
              <p className="text-amber-800/80 mt-0.5">{lock.reason || 'Contact us at (631) 998-9325 to make changes.'}</p>
            </div>
          </div>
        )}
        <div className={lock?.locked ? 'opacity-60 pointer-events-none' : ''}>
          {children}
        </div>
      </div>
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

function SelectableActivityChip({ item, selected, onClick, priceLabel, disabled }: {
  item: PricingItem; selected: boolean; onClick: () => void; priceLabel?: string; disabled?: boolean
}) {
  const isIncluded = priceLabel === 'Included'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`relative flex flex-col items-center justify-center text-center gap-1 p-3 rounded-xl border-2 transition-all duration-200 ${
        selected ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm' : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      {item.emoji && <span className="text-xl leading-none">{item.emoji}</span>}
      <span className="text-xs font-semibold leading-tight text-hampton-navy">{item.name}</span>
      {priceLabel && (
        <span className={`text-[10px] font-bold ${isIncluded ? 'text-green-700' : 'text-hampton-pink'}`}>
          {priceLabel}
        </span>
      )}
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
    childName: restored?.partyName || '', // legacy field — restored.partyName used to mean child's name
    childAge: '',
    catchyPartyName: '',
  })
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  /* ── change-tracking baseline ──
   * Snapshot of all customer-editable state at last load OR last save.
   * Used to: (a) detect unsaved changes for the Save modal, (b) revert on
   * Cancel.
   * NOTE: kept simple (JSON-serializable) — Sets become sorted arrays.
   */
  type PlanSnapshot = {
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
    pizzaOrBagels: 'pizza' | 'bagels'
    cupcakeFlavor: 'vanilla' | 'chocolate'
    addMobileCupcakes: boolean
    locationType: 'host_hampton' | 'mobile'
    mobileAddress: string
    childName: string
    childAge: string
    catchyPartyName: string
    totalCents: number
  }
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<PlanSnapshot | null>(null)

  /* ── loaded booking state ── */
  const [loadedBooking, setLoadedBooking] = useState<{
    id?: string; booking_ref: string; status: string; total_cents: number; balance_due_cents: number; deposit_amount: number;
    party_date?: string | null; party_time?: string | null;
    party_tags?: { date_locked?: boolean; created_by?: string; location_type?: string; location_address?: string; catchy_party_name?: string; modifications_unlocked?: boolean } | null;
    contact_name?: string; contact_email?: string; contact_phone?: string;
    child_name?: string | null; child_age?: number | null;
  } | null>(null)

  /* ── admin mode ── */
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState<string | null>(null)

  /* ── bottom bar ── */
  const [barExpanded, setBarExpanded] = useState(false)

  /* ── My Parties modal (email login) ── */
  const [myPartiesOpen, setMyPartiesOpen] = useState(false)
  /* ── Save + Send Message modals (post-deposit bottom bar) ── */
  const [changesOpen, setChangesOpen] = useState(false)
  const [sendMsgOpen, setSendMsgOpen] = useState(false)
  const [oldTotalAtModalOpen, setOldTotalAtModalOpen] = useState(0)

  /* ── admin custom items (added before booking exists or as part of edit) ── */
  const [customItems, setCustomItems] = useState<{
    id: string; name: string; price_cents: number; quantity: number; guest_multiplied: boolean; is_discount: boolean;
  }[]>([])
  const [showCustomItemForm, setShowCustomItemForm] = useState(false)
  const [showRecordPayForm, setShowRecordPayForm] = useState(false)
  const [customItemDraft, setCustomItemDraft] = useState({ name: '', price: '', quantity: '1', guest_multiplied: false, is_discount: false })
  const [recordPayDraft, setRecordPayDraft] = useState({ amount: '', method: 'cash' as 'cash' | 'venmo' | 'zelle' | 'check' | 'other', notes: '' })
  const [adminBusy, setAdminBusy] = useState('')

  /* ── party location ── */
  const [locationType, setLocationType] = useState<'host_hampton' | 'mobile'>('host_hampton')
  const [mobileAddress, setMobileAddress] = useState('')
  // Mileage state — `miles` and the fee rate are intentionally NOT in the UI
  // shape; the server returns only feeCents + resolvedAddress + optional warning.
  const [mileage, setMileage] = useState<{ feeCents: number; resolvedAddress?: string; warning?: string } | null>(null)
  const [mileageLoading, setMileageLoading] = useState(false)
  const [mileageError, setMileageError] = useState('')
  // Once an address is confirmed, lock the input until the customer clicks Edit
  const addressConfirmed = mileage !== null

  async function confirmMobileAddress() {
    if (locationType !== 'mobile' || !mobileAddress.trim() || mobileAddress.trim().length < 6) return
    setMileageLoading(true)
    setMileageError('')
    try {
      const res = await fetch('/api/party-builder/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: mobileAddress }),
      })
      const data = await res.json()
      if (!res.ok) { setMileageError(data.error || 'Could not look up address'); setMileage(null) }
      else setMileage({ feeCents: data.feeCents || 0, resolvedAddress: data.resolvedAddress, warning: data.warning })
    } catch (err: unknown) {
      setMileageError(err instanceof Error ? err.message : 'Could not look up address')
      setMileage(null)
    } finally {
      setMileageLoading(false)
    }
  }

  function editMobileAddress() {
    setMileage(null)
    setMileageError('')
  }

  // Clean up any legacy "travel-fee" custom item from older bookings — the
  // Mobile Party Package now bundles the travel fee directly inside its
  // composite line item, so we don't want a duplicate row.
  useEffect(() => {
    setCustomItems(prev => prev.filter(ci => ci.id !== 'travel-fee'))
  }, [locationType])

  /* ── party preferences (notes, character visit details) ── */
  const [partyPreferences, setPartyPreferences] = useState('')
  const [characterRequest, setCharacterRequest] = useState('')

  /* ── included-with-package selectors ── */
  const [pizzaOrBagels, setPizzaOrBagels] = useState<'pizza' | 'bagels'>('pizza')
  const [cupcakeFlavor, setCupcakeFlavor] = useState<'vanilla' | 'chocolate'>('vanilla')
  const [addMobileCupcakes, setAddMobileCupcakes] = useState(false)

  // Mobile cupcake add-on as custom line item ($5/guest)
  useEffect(() => {
    if (locationType === 'mobile' && addMobileCupcakes) {
      setCustomItems(prev => {
        const existing = prev.filter(ci => ci.id !== 'mobile-cupcakes')
        return [...existing, {
          id: 'mobile-cupcakes',
          name: `Cupcakes (${cupcakeFlavor === 'chocolate' ? 'Chocolate' : 'Vanilla'}) — Mobile Add-On`,
          price_cents: 500,
          quantity: 1,
          guest_multiplied: true,
          is_discount: false,
        }]
      })
    } else {
      setCustomItems(prev => prev.filter(ci => ci.id !== 'mobile-cupcakes'))
    }
  }, [locationType, addMobileCupcakes, cupcakeFlavor])

  /* ── sliding section nav ──
   * Mobile mode hides Themes, Food, Desserts, Drinks, Décor, Extras
   * because those modules aren't rendered in mobile flow.
   */
  const SECTIONS = useMemo(() => {
    const all = [
      { id: 'sec-date', label: 'Date' },
      { id: 'sec-location', label: 'Location' },
      { id: 'sec-themes', label: 'Themes' },
      { id: 'sec-activities', label: 'Activities' },
      { id: 'sec-food', label: 'Food' },
      { id: 'sec-desserts', label: 'Desserts' },
      { id: 'sec-drinks', label: 'Drinks' },
      { id: 'sec-decor', label: 'Décor' },
      { id: 'sec-extras', label: 'Extras' },
      { id: 'sec-entertainment', label: 'Entertainment' },
      { id: 'sec-contact', label: 'Contact' },
      { id: 'sec-summary', label: 'Summary' },
      { id: 'sec-book', label: 'Book' },
    ]
    if (locationType === 'mobile') {
      const mobileHidden = new Set(['sec-themes', 'sec-food', 'sec-desserts', 'sec-drinks', 'sec-decor'])
      return all.filter(s => !mobileHidden.has(s.id))
    }
    return all
  }, [locationType])
  const [activeSection, setActiveSection] = useState<string>('sec-date')
  const sectionNavRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateActive = () => {
      const offset = 120 // sticky nav height + buffer
      let current: string = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (!el) continue
        if (el.getBoundingClientRect().top - offset <= 0) current = s.id
      }
      setActiveSection(prev => (prev !== current ? current : prev))
    }
    updateActive()
    window.addEventListener('scroll', updateActive, { passive: true })
    return () => window.removeEventListener('scroll', updateActive)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll the section nav to keep the active chip in view
  useEffect(() => {
    if (!sectionNavRef.current) return
    const chip = sectionNavRef.current.querySelector(`[data-sec-id="${activeSection}"]`) as HTMLElement | null
    if (chip) chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeSection])

  // Calendar is locked when admin set it OR when deposit has been paid
  const calendarLocked = !!loadedBooking?.party_tags?.date_locked
  const dateLocked = calendarLocked // alias used below

  /* ── additional payment (post-deposit) ── */
  const [addPayAmount, setAddPayAmount] = useState('')
  const [addPayMethod, setAddPayMethod] = useState<'card' | 'venmo' | 'zelle' | 'cash'>('card')
  const [addPayProcessing, setAddPayProcessing] = useState(false)
  const [addPayError, setAddPayError] = useState('')
  const [addPaySuccess, setAddPaySuccess] = useState('')
  const addPayCheckoutRef = useRef<HTMLDivElement>(null)
  // Payment Element refs for additional (post-deposit) payments
  const addPayStripeRef = useRef<Awaited<ReturnType<typeof loadStripe>> | null>(null)
  const addPayElementsRef = useRef<ReturnType<NonNullable<Awaited<ReturnType<typeof loadStripe>>>['elements']> | null>(null)
  const addPayElementRef = useRef<{ unmount: () => void } | null>(null)
  const addPayIntentIdRef = useRef<string | null>(null)
  const [addPayCheckoutReady, setAddPayCheckoutReady] = useState(false)
  const [addPayConfirming, setAddPayConfirming] = useState(false)
  /* ── tip jar (final / near-event card payments only) ── */
  const [tipCents, setTipCents] = useState(0)
  const [tipTouched, setTipTouched] = useState(false)
  const [loadedPayments, setLoadedPayments] = useState<{
    id: string; payment_type: string; payment_method: string; amount_cents: number;
    card_fee_cents: number; total_charged_cents: number; paid_at: string
  }[]>([])
  const [bookingLoading, setBookingLoading] = useState(true)

  /* ── calendar state ── */
  const [calendarSelection, setCalendarSelection] = useState<CalendarSelection | null>(null)
  const [calendarExpanded, setCalendarExpanded] = useState(true)

  /* ── payment state ── */
  const [payProcessing, setPayProcessing] = useState(false)
  const [payError, setPayError] = useState('')
  const [checkoutReady, setCheckoutReady] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  // Deposit method is fixed — the public planner no longer takes payment (it
  // submits a request); payment happens later in the portal after approval.
  const [depositMethod] = useState<'card' | 'venmo' | 'zelle' | 'cash'>('card')
  const [depositPledgeSuccess, setDepositPledgeSuccess] = useState('')
  const [confirming, setConfirming] = useState(false)
  const checkoutRef = useRef<HTMLDivElement>(null)
  // Payment Element refs (in-page card form, replaces embedded Checkout)
  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>> | null>(null)
  const elementsRef = useRef<ReturnType<NonNullable<Awaited<ReturnType<typeof loadStripe>>>['elements']> | null>(null)
  const paymentElementRef = useRef<{ unmount: () => void } | null>(null)
  const paymentIntentIdRef = useRef<string | null>(null)

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

  /* ── detect admin ── */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = localStorage.getItem('hh_admin_token')
    if (t) { setAdminToken(t); setIsAdmin(true) }
  }, [])

  /* ── detect checkout return ── */
  useEffect(() => {
    if (checkoutStatus !== 'complete' || !checkoutSessionId) return
    setPaymentSuccess(true)
    // Clean URL params without reload
    window.history.replaceState({}, '', window.location.pathname)

    // Server-side reconciliation: record the payment, update booking, send emails.
    // Runs in addition to (and idempotent with) the Stripe webhook.
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/party-builder/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: checkoutSessionId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          console.error('confirm-session failed:', err)
          return
        }
        if (cancelled) return
        // Reload the booking so payment history + balance reflect the new state
        const reload = await fetch('/api/party-builder/load')
        if (reload.ok && !cancelled) {
          const data = await reload.json()
          setLoadedBooking(data.booking)
          setLoadedPayments(data.payments || [])
        }
      } catch (err) {
        console.error('confirm-session client error:', err)
      }
    })()
    return () => { cancelled = true }
  }, [checkoutStatus, checkoutSessionId])

  /* ── load booking from portal cookie ── */
  useEffect(() => {
    let cancelled = false
    async function loadBooking() {
      // Admin click on "+ New Party Plan" → ?new=true → clear any existing
      // portal cookie server-side first so we boot into a blank planner even
      // if a customer's session was previously active in this browser.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.get('new') === 'true') {
          try {
            await fetch('/api/portal/clear', { method: 'POST' })
          } catch { /* non-fatal — proceed with whatever cookie state we have */ }
          // Strip the param so a refresh doesn't re-clear and confuse downstream code
          params.delete('new')
          const remaining = params.toString()
          window.history.replaceState({}, '', `${window.location.pathname}${remaining ? `?${remaining}` : ''}`)
          setBookingLoading(false)
          return
        }
      }
      try {
        const res = await fetch('/api/party-builder/load')
        if (!res.ok) { setBookingLoading(false); return }
        const data = await res.json()
        if (cancelled) return

        const b = data.booking
        setLoadedBooking(b)
        setLoadedPayments(data.payments || [])

        // Restore contact info
        setContact(prev => ({
          ...prev,
          fullName: b.contact_name || '',
          email: b.contact_email || '',
          phone: b.contact_phone || '',
          childName: b.child_name || '',
          childAge: b.child_age != null ? String(b.child_age) : '',
          catchyPartyName: (b.party_tags as Record<string, unknown> | null)?.catchy_party_name as string || '',
        }))

        // Pre-fill calendar if booking already has date/time, and collapse
        // the calendar to the compact "selected date" card so the customer
        // doesn't see the full month picker on a plan they've already dated.
        // They can still click "Change" to re-expand.
        if (b.party_date && b.party_time) {
          setCalendarSelection({
            date: b.party_date,
            timeSlot: { start: b.party_time, end: b.party_time, status: 'open' },
          } as CalendarSelection)
          setCalendarExpanded(false)
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

        // Defensive fallback: bookings created before the structured-snapshot
        // fix have a sparse snap (no theme/activities/etc.). Reconstruct from
        // line items so the form still hydrates correctly.
        const hasStructuredSnap = snap && (snap.theme || snap.activities || snap.food || snap.desserts || snap.decor || snap.entertainment || snap.extras)
        if (!hasStructuredSnap && Array.isArray(data.lineItems) && data.lineItems.length) {
          const catByPid = new Map<string, string>()
          for (const i of [...themes, ...premiumActivities, ...standardActivities, ...food, ...desserts, ...beverages, ...decor, ...entertainment, ...partyAddOns]) {
            catByPid.set(i.id, i.category)
          }
          const fbActivities = new Set<string>()
          const fbFood = new Set<string>()
          const fbDesserts = new Set<string>()
          const fbBeverages = new Set<string>()
          const fbDecor = new Set<string>()
          const fbEntertainment = new Set<string>()
          const fbExtras = new Set<string>()
          const fbFoodQty = new Map<string, number>()
          const fbDecorQty = new Map<string, number>()
          let fbTheme: string | null = null
          for (const li of data.lineItems as Array<{ pricing_item_id?: string | null; quantity?: number }>) {
            if (!li.pricing_item_id) continue
            const origCat = catByPid.get(li.pricing_item_id)
            if (!origCat) continue
            switch (origCat) {
              case 'party-theme': fbTheme = li.pricing_item_id; break
              case 'activity-premium':
              case 'activity-standard': fbActivities.add(li.pricing_item_id); break
              case 'food-add-on':
                fbFood.add(li.pricing_item_id)
                if (li.quantity && li.quantity > 1) fbFoodQty.set(li.pricing_item_id, li.quantity)
                break
              case 'dessert-add-on': fbDesserts.add(li.pricing_item_id); break
              case 'beverage-add-on': fbBeverages.add(li.pricing_item_id); break
              case 'decor-add-on':
                fbDecor.add(li.pricing_item_id)
                if (li.quantity && li.quantity > 1) fbDecorQty.set(li.pricing_item_id, li.quantity)
                break
              case 'entertainment-add-on': fbEntertainment.add(li.pricing_item_id); break
              case 'party-add-on': fbExtras.add(li.pricing_item_id); break
            }
          }
          if (fbTheme) setSelectedTheme(fbTheme)
          if (fbActivities.size) setSelectedActivities(fbActivities)
          if (fbFood.size) setSelectedFood(fbFood)
          if (fbDesserts.size) setSelectedDesserts(fbDesserts)
          if (fbBeverages.size) setSelectedBeverages(fbBeverages)
          if (fbDecor.size) setSelectedDecor(fbDecor)
          if (fbEntertainment.size) setSelectedEntertainment(fbEntertainment)
          if (fbExtras.size) setSelectedPartyAddOns(fbExtras)
          if (fbFoodQty.size) setFoodQty(fbFoodQty)
          if (fbDecorQty.size) setDecorQty(fbDecorQty)
          if (b.guest_count_approx) setGuestCount(b.guest_count_approx)
        }

        // Restore party location
        if (b.party_tags?.location_type) {
          setLocationType(b.party_tags.location_type === 'mobile' ? 'mobile' : 'host_hampton')
          if (b.party_tags.location_address) setMobileAddress(b.party_tags.location_address)
        }

        // Restore preferences + character request + included-with-package selectors
        if (snap?.partyPreferences) setPartyPreferences(snap.partyPreferences)
        if (snap?.characterRequest) setCharacterRequest(snap.characterRequest)
        if (snap?.pizzaOrBagels === 'bagels') setPizzaOrBagels('bagels')
        if (snap?.cupcakeFlavor === 'chocolate') setCupcakeFlavor('chocolate')
        if (snap?.addMobileCupcakes) setAddMobileCupcakes(true)

        // Load custom (admin-added) line items: those with no pricing_item_id.
        // Skip category='theme' rows — that's the auto-generated "Additional
        // Guests" line item; it gets reconstructed from extraGuests on render,
        // so round-tripping it as a custom would double-count guest fees.
        const customs = (data.lineItems || []).filter((li: { pricing_item_id?: string | null; category?: string }) =>
          !li.pricing_item_id && li.category !== 'theme'
        )
        if (customs.length) {
          setCustomItems(customs.map((li: { id: string; name: string; unit_price_cents: number; quantity: number; guest_multiplied: boolean; category: string }) => ({
            id: li.id,
            name: li.name,
            price_cents: li.unit_price_cents,
            quantity: li.quantity,
            guest_multiplied: li.guest_multiplied,
            is_discount: li.category === 'discount' || li.unit_price_cents < 0,
          })))
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

  /* ── activity pricing rules ──
     Themes >= $950 include 1 premium activity.
     Themes < $950 (e.g. $850) include 0 premium activities; first premium
       costs a flat $100 (which lands the customer at the same effective
       price as picking the $950 theme outright).
     Second premium (regardless of theme): +$25/person × (guests+1).
     Standard: 1st & 2nd included, 3rd = $5/person × (guests+1), max 3. */
  const PREMIUM_EXTRA_CENTS = 2500              // 2nd premium per-person rate
  const PREMIUM_UPGRADE_FLAT_CENTS = 10000      // $100 flat — first premium on sub-$950 themes
  const THEME_PREMIUM_INCLUDED_THRESHOLD = 95000 // $950 — themes at/above include 1 premium
  const STANDARD_EXTRA_CENTS = 500
  const MAX_PREMIUM_ACTIVITIES = 2
  const MAX_STANDARD_ACTIVITIES = 3

  const premiumIdSet = useMemo(() => new Set(premiumActivities.map(a => a.id)), [premiumActivities])
  const standardIdSet = useMemo(() => new Set(standardActivities.map(a => a.id)), [standardActivities])
  const selectedPremiumIds = useMemo(
    () => Array.from(selectedActivities).filter(id => premiumIdSet.has(id)),
    [selectedActivities, premiumIdSet]
  )
  const selectedStandardIds = useMemo(
    () => Array.from(selectedActivities).filter(id => standardIdSet.has(id)),
    [selectedActivities, standardIdSet]
  )

  // How many premium activities the selected theme includes for free.
  // Computed from the theme item price so admin can adjust thresholds in DB.
  const themeItemForPremium = selectedTheme ? itemMap.get(selectedTheme) : null
  const includedPremiumCount = themeItemForPremium && themeItemForPremium.price_cents >= THEME_PREMIUM_INCLUDED_THRESHOLD ? 1 : 0

  const activityCost = useMemo(() => {
    const multiplier = effectiveGuestCount + 1 // includes birthday child
    let cost = 0
    // Premium 1 (idx 0): free if theme includes it, else +$100 flat
    if (selectedPremiumIds.length >= 1 && includedPremiumCount < 1) {
      cost += PREMIUM_UPGRADE_FLAT_CENTS
    }
    // Premium 2 (idx 1): always +$25/person × (guests+1)
    if (selectedPremiumIds.length >= 2) cost += PREMIUM_EXTRA_CENTS * multiplier
    // Standard 3+ (idx 2+): +$5/person × (guests+1)
    if (selectedStandardIds.length >= 3) cost += STANDARD_EXTRA_CENTS * multiplier
    return cost
  }, [selectedPremiumIds.length, selectedStandardIds.length, effectiveGuestCount, includedPremiumCount])

  /* ── mobile party derived values ── */
  const isMobile = locationType === 'mobile'

  // Mobile Party Package base (depends on guest count tier) + travel fee.
  // The fee comes from the mileage API state (`mileage.feeCents`) and is
  // already opaque to the customer (no miles/rate disclosure).
  const mobilePackageBaseCents = useMemo(() => {
    if (!isMobile) return 0
    let base = MOBILE_BASE_CENTS
    if (effectiveGuestCount > MOBILE_TIER2_GUEST_THRESHOLD) base += MOBILE_TIER2_SURCHARGE_CENTS
    if (effectiveGuestCount > MOBILE_TIER3_GUEST_THRESHOLD) base += MOBILE_TIER3_SURCHARGE_CENTS
    return base
  }, [isMobile, effectiveGuestCount])

  const mobileTravelFeeCents = isMobile ? (mileage?.feeCents ?? 0) : 0
  const mobilePackageCents = mobilePackageBaseCents + mobileTravelFeeCents

  // Mobile activity cost — per-activity-per-person for every selected
  // activity. Activities in pricing_items have price_cents=0 (they're
  // "included" in the studio package), so for mobile we fall back to:
  //   premium activity  → $25/person × guests
  //   standard activity → $5/person × guests
  //   anything else with a non-zero price → its own price × guests
  // No first-free rule.
  const mobileActivityCost = useMemo(() => {
    if (!isMobile) return 0
    let sum = 0
    for (const id of Array.from(selectedActivities)) {
      const item = itemMap.get(id)
      if (!item) continue
      let rate = item.price_cents
      if (rate <= 0) {
        if (premiumIdSet.has(id)) rate = PREMIUM_EXTRA_CENTS
        else if (standardIdSet.has(id)) rate = STANDARD_EXTRA_CENTS
      }
      sum += rate * effectiveGuestCount
    }
    return sum
  }, [isMobile, selectedActivities, itemMap, effectiveGuestCount, premiumIdSet, standardIdSet])

  const getActivityLabel = (item: PricingItem): string => {
    if (isMobile) {
      // Mirror the mobile rate logic from mobileActivityCost so the chip price
      // matches what shows up in the total.
      let rate = item.price_cents
      if (rate <= 0) {
        if (premiumIdSet.has(item.id)) rate = PREMIUM_EXTRA_CENTS
        else if (standardIdSet.has(item.id)) rate = STANDARD_EXTRA_CENTS
      }
      return `${fmt(rate)}/person`
    }
    const isPremium = premiumIdSet.has(item.id)
    const isStandard = standardIdSet.has(item.id)
    if (isPremium) {
      const idx = selectedPremiumIds.indexOf(item.id)
      if (idx === 0) return includedPremiumCount >= 1 ? 'Included' : '+$100'
      if (idx === 1) return `+$25/person`
      return '+$25/person'
    }
    if (isStandard) {
      const idx = selectedStandardIds.indexOf(item.id)
      if (idx >= 0 && idx < 2) return 'Included'
      if (idx === 2) return `+$5/person`
      return '+$5/person'
    }
    return fmt(item.price_cents, item.price_label)
  }

  const total = useMemo(() => {
    let sum = 0

    if (isMobile) {
      // Mobile Party: composite package (base tier + travel) + activities
      // per-person + entertainment + party extras + admin custom items.
      // Theme/food/drinks/desserts/decor are hidden in mobile mode.
      sum += mobilePackageCents
      sum += mobileActivityCost
      for (const id of Array.from(selectedEntertainment)) {
        const item = itemMap.get(id)
        if (!item) continue
        sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
      }
      for (const id of Array.from(selectedPartyAddOns)) {
        const item = itemMap.get(id)
        if (!item) continue
        sum += item.price_type === 'per_person' ? item.price_cents * effectiveGuestCount : item.price_cents
      }
      for (const ci of customItems) {
        // Skip the legacy mobile-cupcakes auto-item if it's still hanging around
        if (ci.id === 'mobile-cupcakes') continue
        sum += ci.guest_multiplied ? ci.price_cents * ci.quantity * effectiveGuestCount : ci.price_cents * ci.quantity
      }
      return Math.max(0, sum)
    }

    // Studio party (Host Hampton)
    if (selectedTheme) sum += itemMap.get(selectedTheme)?.price_cents ?? 0
    if (isMiniParty && selectedTheme) sum -= MINI_PARTY_DISCOUNT_CENTS
    sum += extraGuests * EXTRA_GUEST_CENTS
    // Activities: special pricing rules — see activityCost calc above
    sum += activityCost
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
    // Admin custom items + discounts
    for (const ci of customItems) {
      sum += ci.guest_multiplied ? ci.price_cents * ci.quantity * effectiveGuestCount : ci.price_cents * ci.quantity
    }
    return Math.max(0, sum)
  }, [isMobile, mobilePackageCents, mobileActivityCost, selectedTheme, isMiniParty, extraGuests, effectiveGuestCount, activityCost, selectedFood, foodQty, selectedDesserts, selectedBeverages, selectedDecor, decorQty, selectedEntertainment, selectedPartyAddOns, itemMap, customItems])

  /* ── capture / apply snapshot helpers ── */
  const captureSnapshot = useCallback((): PlanSnapshot => ({
    guestCount,
    isMiniParty,
    selectedTheme,
    activities: Array.from(selectedActivities).sort(),
    food: Array.from(selectedFood).sort(),
    desserts: Array.from(selectedDesserts).sort(),
    beverages: Array.from(selectedBeverages).sort(),
    decor: Array.from(selectedDecor).sort(),
    entertainment: Array.from(selectedEntertainment).sort(),
    extras: Array.from(selectedPartyAddOns).sort(),
    foodQty: Object.fromEntries(foodQty),
    decorQty: Object.fromEntries(decorQty),
    partyPreferences,
    characterRequest,
    pizzaOrBagels,
    cupcakeFlavor,
    addMobileCupcakes,
    locationType,
    mobileAddress,
    childName: contact.childName,
    childAge: contact.childAge,
    catchyPartyName: contact.catchyPartyName,
    totalCents: total,
  }), [
    guestCount, isMiniParty, selectedTheme, selectedActivities, selectedFood,
    selectedDesserts, selectedBeverages, selectedDecor, selectedEntertainment,
    selectedPartyAddOns, foodQty, decorQty, partyPreferences, characterRequest,
    pizzaOrBagels, cupcakeFlavor, addMobileCupcakes, locationType, mobileAddress,
    contact.childName, contact.childAge, contact.catchyPartyName, total,
  ])

  const applySnapshot = useCallback((snap: PlanSnapshot) => {
    setGuestCount(snap.guestCount)
    setIsMiniParty(snap.isMiniParty)
    setSelectedTheme(snap.selectedTheme)
    setSelectedActivities(new Set(snap.activities))
    setSelectedFood(new Set(snap.food))
    setSelectedDesserts(new Set(snap.desserts))
    setSelectedBeverages(new Set(snap.beverages))
    setSelectedDecor(new Set(snap.decor))
    setSelectedEntertainment(new Set(snap.entertainment))
    setSelectedPartyAddOns(new Set(snap.extras))
    setFoodQty(new Map(Object.entries(snap.foodQty)))
    setDecorQty(new Map(Object.entries(snap.decorQty)))
    setPartyPreferences(snap.partyPreferences)
    setCharacterRequest(snap.characterRequest)
    setPizzaOrBagels(snap.pizzaOrBagels)
    setCupcakeFlavor(snap.cupcakeFlavor)
    setAddMobileCupcakes(snap.addMobileCupcakes)
    setLocationType(snap.locationType)
    setMobileAddress(snap.mobileAddress)
    setContact(prev => ({
      ...prev,
      childName: snap.childName,
      childAge: snap.childAge,
      catchyPartyName: snap.catchyPartyName,
    }))
  }, [])

  // Capture the initial baseline after the load effect settles. Without this,
  // the Save modal would show "no changes" until the customer saves once.
  useEffect(() => {
    if (bookingLoading) return
    if (lastSavedSnapshot) return // already captured
    if (!loadedBooking) return // fresh planner — no baseline needed until first save
    setLastSavedSnapshot(captureSnapshot())
  }, [bookingLoading, loadedBooking, lastSavedSnapshot, captureSnapshot])

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

    if (isMobile) {
      // Mobile Party: one composite "Mobile Party Package" line covering the
      // base fee + travel. Activities billed per-person, every activity. No
      // theme/food/drinks/desserts/decor lines.
      const tierLabel = effectiveGuestCount > MOBILE_TIER3_GUEST_THRESHOLD
        ? ' (28+ guests)'
        : effectiveGuestCount > MOBILE_TIER2_GUEST_THRESHOLD
          ? ' (19–27 guests)'
          : ' (up to 18 guests)'
      lineItems.push({
        name: `Mobile Party Package${tierLabel}`,
        category: 'mobile-package',
        quantity: 1,
        unit_price_cents: mobilePackageCents, // base tier + travel, bundled
        price_type: 'flat',
        guest_multiplied: false,
      })

      // Per-activity per-person — every selected activity is billed.
      // Activities in pricing_items have price_cents=0 (they're "included" in
      // studio mode), so fall back to premium/standard category rates.
      for (const id of Array.from(selectedActivities)) {
        const item = itemMap.get(id); if (!item) continue
        let rate = item.price_cents
        if (rate <= 0) {
          if (premiumIdSet.has(id)) rate = PREMIUM_EXTRA_CENTS
          else if (standardIdSet.has(id)) rate = STANDARD_EXTRA_CENTS
        }
        lineItems.push({
          name: item.name,
          category: 'activity-add-on',
          quantity: 1,
          unit_price_cents: rate,
          price_type: 'per_person',
          guest_multiplied: true,
          pricing_item_id: item.id,
        })
      }

      // Entertainment — existing per-item pricing
      for (const id of Array.from(selectedEntertainment)) {
        const item = itemMap.get(id); if (!item) continue
        lineItems.push({
          name: item.name,
          category: 'entertainment-add-on',
          quantity: 1,
          unit_price_cents: item.price_cents,
          price_type: item.price_type === 'per_person' ? 'per_person' : 'flat',
          guest_multiplied: item.price_type === 'per_person',
          pricing_item_id: item.id,
        })
      }

      // Party Extras — same per-item pricing as studio
      for (const id of Array.from(selectedPartyAddOns)) {
        const item = itemMap.get(id); if (!item) continue
        lineItems.push({
          name: item.name,
          category: 'extra',
          quantity: 1,
          unit_price_cents: item.price_cents,
          price_type: item.price_type === 'per_person' ? 'per_person' : 'flat',
          guest_multiplied: item.price_type === 'per_person',
          pricing_item_id: item.id,
        })
      }

      // Admin custom items (skip the legacy mobile-cupcakes auto-item)
      for (const ci of customItems) {
        if (ci.id === 'mobile-cupcakes') continue
        lineItems.push({
          name: ci.name,
          category: ci.is_discount ? 'discount' : 'custom',
          quantity: ci.quantity,
          unit_price_cents: ci.price_cents,
          price_type: ci.guest_multiplied ? 'per_person' : 'flat',
          guest_multiplied: ci.guest_multiplied,
        })
      }
      return lineItems
    }

    // Studio party (Host Hampton)
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
    // Activities: special pricing rules.
    // - 1st premium: free if theme includes it ($950+), else +$100 flat
    // - 2nd premium: +$25/person × (guests+1)
    // - 3rd standard: +$5/person × (guests+1)
    const aMult = effectiveGuestCount + 1
    selectedPremiumIds.forEach((id, idx) => {
      const item = itemMap.get(id); if (!item) return
      let unitPriceCents: number
      let suffix: string
      if (idx === 0) {
        if (includedPremiumCount >= 1) {
          unitPriceCents = 0
          suffix = ' (1st premium — included)'
        } else {
          unitPriceCents = PREMIUM_UPGRADE_FLAT_CENTS
          suffix = ' (1st premium — +$100 upgrade)'
        }
      } else {
        unitPriceCents = PREMIUM_EXTRA_CENTS * aMult
        suffix = ' (2nd premium — extra)'
      }
      lineItems.push({
        name: item.name + suffix,
        category: 'activity-add-on',
        quantity: 1,
        unit_price_cents: unitPriceCents,
        price_type: 'flat',
        guest_multiplied: false,
        pricing_item_id: item.id,
      })
    })
    selectedStandardIds.forEach((id, idx) => {
      const item = itemMap.get(id); if (!item) return
      lineItems.push({
        name: item.name + (idx < 2 ? ' (included)' : ' (3rd standard — extra)'),
        category: 'activity-add-on',
        quantity: 1,
        unit_price_cents: idx < 2 ? 0 : STANDARD_EXTRA_CENTS * aMult,
        price_type: 'flat',
        guest_multiplied: false,
        pricing_item_id: item.id,
      })
    })
    addFromSet(selectedFood, 'food-add-on', foodQty)
    addFromSet(selectedDesserts, 'dessert-add-on')
    addFromSet(selectedBeverages, 'beverage-add-on')
    addFromSet(selectedDecor, 'decor-add-on', decorQty)
    addFromSet(selectedEntertainment, 'entertainment-add-on')
    addFromSet(selectedPartyAddOns, 'extra')
    // Admin custom items
    for (const ci of customItems) {
      lineItems.push({
        name: ci.name,
        category: ci.is_discount ? 'discount' : 'custom',
        quantity: ci.quantity,
        unit_price_cents: ci.price_cents,
        price_type: ci.guest_multiplied ? 'per_person' : 'flat',
        guest_multiplied: ci.guest_multiplied,
      })
    }
    return lineItems
  }

  /* ── post-deposit bottom-bar handlers ── */

  // Save click: capture the "before" total so the modal can show the delta
  function openSaveChangesModal() {
    setOldTotalAtModalOpen(lastSavedSnapshot?.totalCents ?? total)
    setError('')
    setChangesOpen(true)
  }

  // Confirm in modal → reuse the existing save handler.
  // Closing on success is handled by the useEffect below (watches saveSuccess).
  async function confirmSaveChanges() {
    await handleSaveForLater({ sendEmail: true })
  }
  // Admin-only silent variant — saves without notifying the customer
  async function confirmSaveChangesSilent() {
    await handleSaveForLater({ sendEmail: false })
  }

  // Revert any unsaved changes back to the last saved baseline
  function revertChanges() {
    if (!lastSavedSnapshot) return
    if (!window.confirm('Discard your unsaved changes and revert to your last saved plan?')) return
    applySnapshot(lastSavedSnapshot)
  }

  // Compute the diff for the modal. Recomputed on each render the modal is
  // open — cheap enough for typical plan sizes.
  const currentChanges = useMemo(() => {
    if (!changesOpen || !lastSavedSnapshot) return []
    return diffPlanSnapshots(lastSavedSnapshot, captureSnapshot(), itemMap)
  }, [changesOpen, lastSavedSnapshot, captureSnapshot, itemMap])

  // Close the changes modal automatically when a save succeeds
  useEffect(() => {
    if (changesOpen && saveSuccess) {
      setChangesOpen(false)
      // Reset the success flag so subsequent opens don't immediately close
      const t = setTimeout(() => setSaveSuccess(false), 3000)
      return () => clearTimeout(t)
    }
  }, [changesOpen, saveSuccess])

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
    if (contact.catchyPartyName) lines.push(`Party: ${contact.catchyPartyName}`)
    else if (contact.childName) lines.push(`Child: ${contact.childName}`)
    return lines.join('\n')
  }

  /* ── save for later ── */
  async function handleSaveForLater(options?: { sendEmail?: boolean }) {
    if (!contact.fullName || !contact.email || !contact.phone) {
      setError('Please fill in Name, Email, and Phone to save your quote.')
      return
    }
    // Default behavior: customer saves → always send email. Admin can opt out
    // by passing { sendEmail: false } from the silent-save button.
    const shouldSendEmail = options?.sendEmail ?? true
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
          childName: contact.childName || undefined,
          childAge: contact.childAge ? parseInt(contact.childAge, 10) : undefined,
          catchyPartyName: contact.catchyPartyName || undefined,
          guestCount: effectiveGuestCount,
          partyDate: calendarSelection?.date || undefined,
          partyTime: calendarSelection?.timeSlot?.start || undefined,
          packageType: themeItem?.name || 'Kids Party',
          isMiniParty,
          notes: [
            partyPreferences ? `Preferences: ${partyPreferences}` : '',
            characterRequest ? `Character request: ${characterRequest}` : '',
          ].filter(Boolean).join('\n') || undefined,
          marketingConsent: consent,
          locationType,
          locationAddress: locationType === 'mobile' ? mobileAddress : undefined,
          sendEmail: shouldSendEmail,
          quoteData: {
            partyPreferences, characterRequest,
            pizzaOrBagels, cupcakeFlavor, addMobileCupcakes,
            theme: selectedTheme, themeName: themeItem?.name ?? null, guestCount,
            activities: Array.from(selectedActivities), food: Array.from(selectedFood),
            desserts: Array.from(selectedDesserts), decor: Array.from(selectedDecor),
            entertainment: Array.from(selectedEntertainment), beverages: Array.from(selectedBeverages),
            extras: Array.from(selectedPartyAddOns), contactName: contact.fullName,
            contactEmail: contact.email, contactPhone: contact.phone,
            childName: contact.childName, childAge: contact.childAge,
            catchyPartyName: contact.catchyPartyName, isMiniParty,
            foodQtyMap: Object.fromEntries(foodQty), decorQtyMap: Object.fromEntries(decorQty),
          },
        }),
      })
      const data = await res.json()
      if (res.ok && data.bookingRef) {
        setLoadedBooking(prev => prev ? { ...prev, booking_ref: data.bookingRef } : {
          booking_ref: data.bookingRef, status: 'awaiting_deposit',
          total_cents: total, balance_due_cents: Math.max(0, total - depositCents), deposit_amount: depositCents,
        })
        setSaveSuccess(true)
        // Update the baseline so subsequent diff checks start from this point
        setLastSavedSnapshot(captureSnapshot())
        if (data.emailSent === false && data.emailDiagnostic) {
          setError(`Saved, but the email did not send: ${data.emailDiagnostic}`)
        }
      } else if (!res.ok) {
        setError(data.error || 'Save failed')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      setError(msg)
    }
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

    // Tear down any existing Payment Element before mounting a new one
    if (paymentElementRef.current) {
      paymentElementRef.current.unmount()
      paymentElementRef.current = null
    }
    elementsRef.current = null
    paymentIntentIdRef.current = null
    setCheckoutReady(false)

    try {
      // Submit lead + create booking + get Stripe session (or non-card pledge)
      const res = await fetch('/api/party-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: getLineItems(),
          contact: {
            fullName: contact.fullName,
            email: contact.email,
            phone: contact.phone,
            childName: contact.childName || '',
          },
          childAge: contact.childAge || '',
          catchyPartyName: contact.catchyPartyName || '',
          // Full structured snapshot so the planner can restore every selection
          // when this booking is loaded later (otherwise the customer sees an
          // empty plan after deposit).
          quoteData: {
            partyPreferences, characterRequest,
            pizzaOrBagels, cupcakeFlavor, addMobileCupcakes,
            theme: selectedTheme, themeName: themeItem?.name ?? null, guestCount,
            activities: Array.from(selectedActivities), food: Array.from(selectedFood),
            desserts: Array.from(selectedDesserts), decor: Array.from(selectedDecor),
            entertainment: Array.from(selectedEntertainment), beverages: Array.from(selectedBeverages),
            extras: Array.from(selectedPartyAddOns),
            childName: contact.childName, childAge: contact.childAge,
            catchyPartyName: contact.catchyPartyName, isMiniParty,
            foodQtyMap: Object.fromEntries(foodQty), decorQtyMap: Object.fromEntries(decorQty),
          },
          guestCount: effectiveGuestCount,
          partyDate: calendarSelection.date,
          partyTime: calendarSelection.timeSlot.start,
          paymentMethod: depositMethod,
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

      // /api/party-checkout is the REQUEST flow: nothing is charged and no
      // date is locked until the team approves. It answers with a success URL
      // (method: 'request'). Only a future paid flow would return clientSecret.
      if (data.method === 'request' || (!data.clientSecret && data.url)) {
        window.location.href = data.url
        return
      }

      if (depositMethod === 'card') {
        if (data.clientSecret) {
          const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
          if (!stripeKey) { setPayError('Payment configuration error'); setPayProcessing(false); return }
          const stripe = await loadStripe(stripeKey)
          if (!stripe) { setPayError('Failed to load payment processor'); setPayProcessing(false); return }
          // In-page Payment Element — replaces embedded Checkout
          const elements = stripe.elements({
            clientSecret: data.clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#1a2744',
                colorBackground: '#ffffff',
                colorText: '#1a2744',
                fontFamily: 'Georgia, serif',
                borderRadius: '10px',
              },
            },
          })
          const paymentElement = elements.create('payment', { layout: 'tabs' })
          stripeRef.current = stripe
          elementsRef.current = elements
          paymentIntentIdRef.current = data.paymentIntentId || null
          setPayProcessing(false)
          setCheckoutReady(true)
          setTimeout(() => {
            if (checkoutRef.current) {
              paymentElement.mount(checkoutRef.current)
              paymentElementRef.current = paymentElement
            }
          }, 50)
        } else {
          setPayError('Unexpected response from the server. Please try again.')
          setPayProcessing(false)
        }
      } else {
        // Non-card pledge for a booking that already has an approved date.
        // (Not reachable from the request flow above — a request never locks
        // a date, so we must not tell the customer it did.)
        const methodLabel = depositMethod.charAt(0).toUpperCase() + depositMethod.slice(1)
        setDepositPledgeSuccess(
          `Got it! Send your ${formatMoney(depositCents)} deposit via ${methodLabel} using the instructions above — we'll email you a copy too. Once we confirm payment, your booking moves to "Approved."`
        )
        setPayProcessing(false)
      }
    } catch (err: any) {
      setPayError(err.message || 'Something went wrong')
      setPayProcessing(false)
    }
  }

  // Cleanup Payment Elements on unmount
  useEffect(() => {
    return () => {
      if (paymentElementRef.current) paymentElementRef.current.unmount()
      if (addPayElementRef.current) addPayElementRef.current.unmount()
    }
  }, [])

  // Confirm the in-page Payment Element for the post-deposit "Make a Payment" flow.
  async function confirmAdditionalPayment() {
    setAddPayError('')
    if (!addPayStripeRef.current || !addPayElementsRef.current) {
      setAddPayError('Payment form not ready. Try again.')
      return
    }
    setAddPayConfirming(true)
    try {
      const { error } = await addPayStripeRef.current.confirmPayment({
        elements: addPayElementsRef.current,
        confirmParams: {},
        redirect: 'if_required',
      })
      if (error) {
        setAddPayError(error.message || 'Payment was declined')
        setAddPayConfirming(false)
        return
      }
      if (addPayIntentIdRef.current) {
        await fetch('/api/party-builder/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: addPayIntentIdRef.current }),
        }).catch(err => console.error('confirm-session failed (non-fatal):', err))
      }
      if (addPayElementRef.current) addPayElementRef.current.unmount()
      addPayElementRef.current = null
      setAddPayCheckoutReady(false)
      setAddPaySuccess(tipCents > 0
        ? `Payment received — including a ${formatMoney(tipCents)} tip for the helpers. Thanks!`
        : 'Payment received. Thanks!')
      setAddPayAmount('')
      setTipCents(0)
      setTipTouched(false)
      try {
        const reload = await fetch('/api/party-builder/load')
        if (reload.ok) {
          const data = await reload.json()
          setLoadedBooking(data.booking)
          setLoadedPayments(data.payments || [])
        }
      } catch { /* non-fatal */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setAddPayError(msg)
    } finally {
      setAddPayConfirming(false)
    }
  }

  // Confirm the in-page Payment Element. Called when the customer clicks the
  // "Confirm & Pay" button after entering card details.
  async function confirmDepositPayment() {
    setPayError('')
    if (!stripeRef.current || !elementsRef.current) {
      setPayError('Payment form not ready. Try again.')
      return
    }
    setConfirming(true)
    try {
      const { error } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: {},
        redirect: 'if_required',
      })
      if (error) {
        setPayError(error.message || 'Payment was declined')
        setConfirming(false)
        return
      }
      // Reconcile server-side. The webhook also fires for this PI, but
      // confirm-session is idempotent and races safely with it.
      if (paymentIntentIdRef.current) {
        await fetch('/api/party-builder/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: paymentIntentIdRef.current }),
        }).catch(err => console.error('confirm-session failed (non-fatal):', err))
      }
      // Tear down the Element and show success state — reload booking
      if (paymentElementRef.current) paymentElementRef.current.unmount()
      paymentElementRef.current = null
      setCheckoutReady(false)
      setPaymentSuccess(true)
      try {
        const reload = await fetch('/api/party-builder/load')
        if (reload.ok) {
          const data = await reload.json()
          setLoadedBooking(data.booking)
          setLoadedPayments(data.payments || [])
        }
      } catch { /* non-fatal */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setPayError(msg)
    } finally {
      setConfirming(false)
    }
  }

  function updateContact(field: string, value: string) {
    setContact(prev => ({ ...prev, [field]: value }))
  }

  function scrollToForm() {
    // Smart book: jump to first incomplete prerequisite, else to Reserve Your Date pay box
    if (!selectedTheme) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (!contact.fullName || !contact.email || !contact.phone) {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!calendarSelection?.date || !calendarSelection?.timeSlot) {
      calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const balloonDecor = decor.filter(d => BALLOON_QTY_ITEMS.has(d.name))
  const regularDecor = decor.filter(d => !BALLOON_QTY_ITEMS.has(d.name))
  const rentalIsWeekday = rentalDate ? isWeekday(rentalDate) : null

  // Summary line items for display
  type SummaryItem = {
    key: string; label: string; detail?: string; amount: number;
    qty?: number; qtyKind?: 'food' | 'decor'; qtyId?: string; itemId?: string;
    customId?: string; isCustom?: boolean; isDiscount?: boolean;
  }
  const summaryLineItems = useMemo<SummaryItem[]>(() => {
    const items: SummaryItem[] = []
    if (themeItem) {
      const price = isMiniParty ? Math.max(0, themeItem.price_cents - MINI_PARTY_DISCOUNT_CENTS) : themeItem.price_cents
      items.push({ key: 'theme', label: themeItem.name, detail: isMiniParty ? 'Mini Party' : 'Theme Package', amount: price, itemId: themeItem.id })
    }
    if (extraGuests > 0) {
      items.push({ key: 'extra-guests', label: `Additional Guests (${extraGuests})`, detail: '@ $35 each', amount: extraGuests * EXTRA_GUEST_CENTS })
    }
    const addSection = (label: string, ids: Set<string>, qtyKind?: 'food' | 'decor', qtyMap?: Map<string, number>) => {
      for (const id of Array.from(ids)) {
        const item = itemMap.get(id)
        if (!item) continue
        const qty = qtyMap?.get(id) ?? 1
        const lineAmount = item.price_type === 'per_person'
          ? item.price_cents * effectiveGuestCount * qty
          : item.price_cents * qty
        const perPerson = item.price_type === 'per_person' ? ` (${fmt(item.price_cents)}/person)` : ''
        items.push({
          key: `${label}:${id}`, itemId: id, label: item.name,
          detail: `${label}${perPerson}`, amount: lineAmount,
          qty, qtyKind, qtyId: qtyKind ? id : undefined,
        })
      }
    }
    // Activities: special pricing — show position info
    const multiplier = effectiveGuestCount + 1
    selectedPremiumIds.forEach((id, idx) => {
      const item = itemMap.get(id); if (!item) return
      const amount = idx === 0 ? 0 : PREMIUM_EXTRA_CENTS * multiplier
      items.push({
        key: `Activity:${id}`, itemId: id, label: item.name,
        detail: idx === 0 ? 'Premium · Included' : `Premium · 2nd · +$25/person × ${multiplier}`,
        amount,
      })
    })
    selectedStandardIds.forEach((id, idx) => {
      const item = itemMap.get(id); if (!item) return
      const amount = idx < 2 ? 0 : STANDARD_EXTRA_CENTS * multiplier
      items.push({
        key: `Activity:${id}`, itemId: id, label: item.name,
        detail: idx < 2 ? 'Standard · Included' : `Standard · 3rd · +$5/person × ${multiplier}`,
        amount,
      })
    })
    addSection('Food', selectedFood, 'food', foodQty)
    addSection('Dessert', selectedDesserts)
    addSection('Beverage', selectedBeverages)
    addSection('Decor', selectedDecor, 'decor', decorQty)
    addSection('Entertainment', selectedEntertainment)
    addSection('Extra', selectedPartyAddOns)
    for (const ci of customItems) {
      const lineAmount = ci.guest_multiplied
        ? ci.price_cents * ci.quantity * effectiveGuestCount
        : ci.price_cents * ci.quantity
      items.push({
        key: `custom:${ci.id}`, customId: ci.id, isCustom: true, isDiscount: ci.is_discount,
        label: ci.name, detail: ci.is_discount ? 'Discount' : 'Custom Item',
        amount: lineAmount, qty: ci.quantity,
      })
    }
    return items
  }, [themeItem, isMiniParty, extraGuests, effectiveGuestCount, selectedActivities, selectedPremiumIds, selectedStandardIds, selectedFood, foodQty, selectedDesserts, selectedBeverages, selectedDecor, decorQty, selectedEntertainment, selectedPartyAddOns, itemMap, customItems])

  /* ── line item controls ── */
  function removeLineItem(item: SummaryItem) {
    if (item.key === 'theme') {
      setSelectedTheme(null)
      setIsMiniParty(false)
    } else if (item.key === 'extra-guests') {
      setGuestCount(INCLUDED_GUESTS)
    } else if (item.isCustom && item.customId) {
      setCustomItems(prev => prev.filter(ci => ci.id !== item.customId))
    } else if (item.itemId) {
      const id = item.itemId
      const removeFromSet = (set: Set<string>, setter: (s: Set<string>) => void) => {
        if (set.has(id)) { const n = new Set(set); n.delete(id); setter(n); return true }
        return false
      }
      if (removeFromSet(selectedActivities, setSelectedActivities)) return
      if (selectedFood.has(id)) {
        const n = new Set(selectedFood); n.delete(id); setSelectedFood(n)
        const m = new Map(foodQty); m.delete(id); setFoodQty(m); return
      }
      if (removeFromSet(selectedDesserts, setSelectedDesserts)) return
      if (removeFromSet(selectedBeverages, setSelectedBeverages)) return
      if (selectedDecor.has(id)) {
        const n = new Set(selectedDecor); n.delete(id); setSelectedDecor(n)
        const m = new Map(decorQty); m.delete(id); setDecorQty(m); return
      }
      if (removeFromSet(selectedEntertainment, setSelectedEntertainment)) return
      if (removeFromSet(selectedPartyAddOns, setSelectedPartyAddOns)) return
    }
  }

  function changeLineItemQty(item: SummaryItem, delta: number) {
    if (item.isCustom && item.customId) {
      setCustomItems(prev => prev.map(ci =>
        ci.id === item.customId ? { ...ci, quantity: Math.max(1, ci.quantity + delta) } : ci
      ))
      return
    }
    if (!item.qtyId || !item.qtyKind) return
    const newQty = Math.max(1, (item.qty ?? 1) + delta)
    if (item.qtyKind === 'food') setFoodQty(new Map(foodQty).set(item.qtyId, newQty))
    else if (item.qtyKind === 'decor') setDecorQty(new Map(decorQty).set(item.qtyId, newQty))
  }

  const hasSelections = selectedTheme || addOnCount > 0 || customItems.length > 0
  const depositCents = computeDeposit(total)
  const contactComplete = contact.fullName && contact.email && contact.phone
  const dateTimeSelected = calendarSelection?.date && calendarSelection?.timeSlot

  /* ── payment status ── */
  const totalPaid = useMemo(
    () => loadedPayments.reduce((s, p) => s + (p.payment_type === 'refund' ? -p.amount_cents : p.amount_cents), 0),
    [loadedPayments]
  )
  const depositPaid = totalPaid > 0 || paymentSuccess
  const balanceRemaining = Math.max(0, total - totalPaid)

  /* ── Tip jar derived values ──
   * The tip module shows when the customer is paying their FINAL bill on a
   * card — either paying the full remaining balance, or paying any amount
   * within 7 days of the party. Recommended tip = 10% of party total,
   * rounded to nearest dollar.
   */
  const daysUntilParty = useMemo(() => {
    const date = loadedBooking?.party_date
    if (!date) return Infinity
    const [y, m, d] = date.split('-').map(Number)
    const partyTs = new Date(y, m - 1, d).getTime()
    return Math.ceil((partyTs - Date.now()) / (1000 * 60 * 60 * 24))
  }, [loadedBooking?.party_date])

  const addPayAmountCents = Math.round((parseFloat(addPayAmount) || 0) * 100)
  const isPayingFull = addPayAmountCents > 0 && addPayAmountCents >= balanceRemaining
  const showTipModule = addPayMethod === 'card' && (isPayingFull || daysUntilParty <= 7)
  const recommendedTipCents = Math.round(total * 0.10 / 100) * 100

  // Auto-fill the tip the first time the module appears. After the customer
  // touches the field we leave it alone (so a manual $0 doesn't get clobbered).
  useEffect(() => {
    if (showTipModule && !tipTouched && tipCents === 0) {
      setTipCents(recommendedTipCents)
    }
    if (!showTipModule && tipCents > 0) {
      setTipCents(0)
      setTipTouched(false)
    }
  }, [showTipModule, recommendedTipCents, tipCents, tipTouched])

  // Per-category change cutoffs only matter after the deposit lands. Before
  // deposit the customer can edit everything freely.
  const partyDateForLocks = loadedBooking?.party_date || calendarSelection?.date || null
  // Admin escape hatch: party_tags.modifications_unlocked re-opens all categories
  // for a specific booking (e.g. a short-notice booking made inside the normal
  // lead-time windows). Set per-booking; default behavior is unchanged.
  const modificationsUnlocked = !!loadedBooking?.party_tags?.modifications_unlocked
  const categoryLocks = useMemo(() => {
    if (!depositPaid || modificationsUnlocked) {
      const empty = { locked: false, cutoffDate: null, daysBefore: 0 } as const
      return {
        activities: empty, desserts: empty, entertainment: empty,
        food: empty, beverages: empty, decor: empty, extras: empty,
      } as Record<LockCategory, ReturnType<typeof getCategoryLockState>>
    }
    return {
      activities: getCategoryLockState('activities', partyDateForLocks),
      desserts: getCategoryLockState('desserts', partyDateForLocks),
      entertainment: getCategoryLockState('entertainment', partyDateForLocks),
      food: getCategoryLockState('food', partyDateForLocks),
      beverages: getCategoryLockState('beverages', partyDateForLocks),
      decor: getCategoryLockState('decor', partyDateForLocks),
      extras: getCategoryLockState('extras', partyDateForLocks),
    }
  }, [depositPaid, partyDateForLocks, modificationsUnlocked])

  /* ── admin actions ── */
  function addCustomItemFromForm() {
    const priceNum = parseFloat(customItemDraft.price)
    if (!customItemDraft.name || isNaN(priceNum)) return
    const cents = Math.round(Math.abs(priceNum) * 100) * (customItemDraft.is_discount ? -1 : 1)
    setCustomItems(prev => [...prev, {
      id: 'temp-' + Math.random().toString(36).slice(2, 10),
      name: customItemDraft.name,
      price_cents: cents,
      quantity: parseInt(customItemDraft.quantity, 10) || 1,
      guest_multiplied: customItemDraft.guest_multiplied,
      is_discount: customItemDraft.is_discount,
    }])
    setCustomItemDraft({ name: '', price: '', quantity: '1', guest_multiplied: false, is_discount: false })
    setShowCustomItemForm(false)
  }

  async function recordPayment() {
    if (!loadedBooking?.id || !adminToken) return
    const amountNum = parseFloat(recordPayDraft.amount)
    if (isNaN(amountNum) || amountNum <= 0) return
    setAdminBusy('pay')
    try {
      const res = await fetch(`/api/admin/parties/${loadedBooking.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({
          action: 'record_payment',
          amount_cents: Math.round(amountNum * 100),
          payment_method: recordPayDraft.method,
          notes: recordPayDraft.notes || undefined,
        }),
      })
      if (res.ok) {
        // Reload booking
        const reload = await fetch('/api/party-builder/load')
        if (reload.ok) {
          const data = await reload.json()
          setLoadedBooking(data.booking)
          setLoadedPayments(data.payments || [])
        }
        setRecordPayDraft({ amount: '', method: 'cash', notes: '' })
        setShowRecordPayForm(false)
      }
    } finally {
      setAdminBusy('')
    }
  }

  /* ── additional payment (post-deposit, customer-side) ── */
  async function handleAdditionalPayment() {
    if (!loadedBooking) { setAddPayError('Booking not loaded'); return }
    const amt = parseFloat(addPayAmount)
    if (isNaN(amt) || amt <= 0) { setAddPayError('Enter a valid amount'); return }
    const amountCents = Math.round(amt * 100)
    if (amountCents > balanceRemaining + 100) {
      setAddPayError(`Amount exceeds balance (${fmt(balanceRemaining)})`)
      return
    }
    setAddPayProcessing(true)
    setAddPayError('')
    setAddPaySuccess('')
    try {
      if (addPayMethod === 'card') {
        const res = await fetch('/api/portal/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountCents,
            paymentMethod: 'card',
            paymentType: amountCents >= balanceRemaining ? 'final' : 'partial',
            embedded: true,
            tipCents: showTipModule ? tipCents : 0,
          }),
        })
        const data = await res.json()
        if (!res.ok) { setAddPayError(data.error || 'Payment failed'); setAddPayProcessing(false); return }
        if (data.clientSecret) {
          const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
          if (!stripeKey) { setAddPayError('Payment config error'); setAddPayProcessing(false); return }
          const stripe = await loadStripe(stripeKey)
          if (!stripe) { setAddPayError('Failed to load Stripe'); setAddPayProcessing(false); return }
          if (addPayElementRef.current) addPayElementRef.current.unmount()
          const elements = stripe.elements({
            clientSecret: data.clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#1a2744',
                colorBackground: '#ffffff',
                colorText: '#1a2744',
                fontFamily: 'Georgia, serif',
                borderRadius: '10px',
              },
            },
          })
          const paymentElement = elements.create('payment', { layout: 'tabs' })
          addPayStripeRef.current = stripe
          addPayElementsRef.current = elements
          addPayIntentIdRef.current = data.paymentIntentId || null
          setAddPayCheckoutReady(true)
          setAddPayProcessing(false)
          setTimeout(() => {
            if (addPayCheckoutRef.current) {
              paymentElement.mount(addPayCheckoutRef.current)
              addPayElementRef.current = paymentElement
            }
          }, 50)
        } else if (data.url) {
          window.location.href = data.url
        }
      } else {
        // venmo / zelle / cash → notify admin
        const res = await fetch('/api/portal/notify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_cents: amountCents,
            method: addPayMethod,
          }),
        })
        const data = await res.json()
        if (!res.ok) { setAddPayError(data.error || 'Notification failed'); setAddPayProcessing(false); return }
        const methodLabel = addPayMethod.charAt(0).toUpperCase() + addPayMethod.slice(1)
        setAddPaySuccess(`Thanks! We've been notified you'll send ${fmt(amountCents)} via ${methodLabel}. Once we confirm the payment, we'll apply it to your balance and send a receipt.`)
        setAddPayAmount('')
        setAddPayProcessing(false)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setAddPayError(msg)
      setAddPayProcessing(false)
    }
  }

  return (
    // -mt-20 cancels the global pt-20 in layout.tsx that exists to clear the
    // fixed Nav — Nav is hidden on /party-planner + /party-builder, so the
    // padding becomes dead space above the logo.
    <div className="pb-36 -mt-20">
      {/* ── Hero ── */}
      <section className="pt-2 pb-4 text-center px-4">
        <a href="/" aria-label="Host Hampton home" className="inline-block mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/host-hampton-logo_300.png"
            alt="Host Hampton"
            width={320}
            height={110}
            className="mx-auto h-24 md:h-28 w-auto object-contain"
          />
        </a>
        {loadedBooking ? (
          <>
            <h1 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-hampton-navy mb-1">
              {(loadedBooking.child_name ? `${loadedBooking.child_name}'s` : 'Your')} Party Plan
            </h1>
            {loadedBooking.party_tags?.catchy_party_name && (
              <p className="font-serif text-lg md:text-xl text-hampton-navy/80 italic mb-1">
                &ldquo;{loadedBooking.party_tags.catchy_party_name}&rdquo;
              </p>
            )}
            <p className="text-xs font-semibold tracking-[0.25em] text-hampton-navy/50 uppercase">
              Booking {loadedBooking.booking_ref}
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl md:text-4xl font-black tracking-tight text-hampton-navy mb-1">
              Party Plan
            </h1>
            <p className="text-xs font-semibold tracking-[0.25em] text-hampton-navy/50 uppercase">
              Design · Reserve · Celebrate
            </p>
          </>
        )}
      </section>

      {/* ── Sticky Section Nav ── */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-hampton-mauve/20 shadow-sm">
        <div className="max-w-6xl mx-auto px-2 sm:px-4 flex items-center gap-2 py-2.5">
          <div
            ref={sectionNavRef}
            className="flex-1 overflow-x-auto scrollbar-hide flex gap-1.5"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {SECTIONS.map(s => {
              const active = activeSection === s.id
              return (
                <button
                  key={s.id}
                  data-sec-id={s.id}
                  onClick={() => {
                    const el = document.getElementById(s.id)
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                    active
                      ? 'bg-hampton-navy text-white shadow-sm'
                      : 'bg-hampton-mauve/10 text-hampton-navy/70 hover:bg-hampton-mauve/20'
                  }`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => setMyPartiesOpen(true)}
            className="shrink-0 ml-1 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap bg-white border border-hampton-navy/30 text-hampton-navy hover:bg-hampton-navy hover:text-white transition-all"
          >
            My Parties
          </button>
        </div>
      </div>
      {myPartiesOpen && <MyPartiesModal onClose={() => setMyPartiesOpen(false)} />}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-10 pb-10 pt-6">

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

        {/* ══ Top Party Summary (visible after deposit) ══ */}
        {depositPaid && hasSelections && (
          <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-hampton-navy px-6 py-4 flex items-center justify-between gap-3">
              <h2 className="font-serif text-lg font-black text-white tracking-tight">Your Party Summary</h2>
              <button
                type="button"
                onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="text-xs text-white/70 hover:text-white underline underline-offset-2"
              >
                View full details ↓
              </button>
            </div>
            <div className="p-5 sm:p-6 grid sm:grid-cols-2 gap-5">
              <div className="space-y-1.5 text-sm">
                {themeItem && (
                  <div className="flex justify-between">
                    <span className="text-hampton-navy/60">Theme</span>
                    <span className="font-semibold text-hampton-navy text-right truncate ml-2">{themeItem.name}{isMiniParty && ' · Mini'}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-hampton-navy/60">Guests</span>
                  <span className="font-semibold text-hampton-navy">{effectiveGuestCount}{extraGuests > 0 && ` (+${extraGuests} extra)`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hampton-navy/60">Location</span>
                  <span className="font-semibold text-hampton-navy text-right truncate ml-2">
                    {locationType === 'mobile' ? (mobileAddress || 'Mobile') : 'Host Hampton'}
                  </span>
                </div>
                {loadedBooking?.party_date && (
                  <div className="flex justify-between">
                    <span className="text-hampton-navy/60">Date</span>
                    <span className="font-semibold text-hampton-navy text-right ml-2">
                      {new Date(loadedBooking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {loadedBooking.party_time && <span className="ml-1 font-normal text-hampton-navy/60">at {loadedBooking.party_time.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => { const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}` })}</span>}
                    </span>
                  </div>
                )}
              </div>
              <div className="bg-hampton-ivory/50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-hampton-navy/60">Total</span>
                  <span className="font-bold text-hampton-navy">{fmt(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-hampton-navy/60">Paid</span>
                  <span className="font-semibold text-green-700">{fmt(totalPaid)}</span>
                </div>
                <div className="flex justify-between pt-1.5 mt-1.5 border-t border-hampton-mauve/20">
                  <span className="font-bold text-hampton-navy">Balance Due</span>
                  <span className="font-serif font-black text-lg text-hampton-navy">{fmt(balanceRemaining)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ Date & Time Selector (now FIRST) ══ */}
        <div id="sec-date" className="scroll-mt-20" />
        {(() => {
          const showLocked = dateLocked || depositPaid
          const dateSelected = !!(calendarSelection?.date && calendarSelection?.timeSlot)
          if (showLocked && loadedBooking?.party_date) {
            // Minimized "booked date" card
            return (
              <div ref={calendarRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
                <div className="px-6 py-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-hampton-blue/15 flex items-center justify-center shrink-0">
                    <Check size={20} className="text-hampton-navy" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-hampton-navy/40">Your Party Date</p>
                    <p className="font-serif font-bold text-lg text-hampton-navy">
                      {new Date(loadedBooking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      {loadedBooking.party_time && (
                        <span className="ml-2 text-hampton-navy/70 font-normal">at {loadedBooking.party_time.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => {
                          const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                        })}</span>
                      )}
                    </p>
                    <p className="text-xs text-hampton-navy/50">Need to change? Call <a href="tel:6319989325" className="underline">(631) 998-9325</a></p>
                  </div>
                </div>
              </div>
            )
          }
          if (dateSelected && !calendarExpanded) {
            // Collapsed selected-date card with edit button
            return (
              <div ref={calendarRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
                <div className="px-6 py-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <Check size={20} className="text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-hampton-navy/40">Your Party Date</p>
                    <p className="font-serif font-bold text-lg text-hampton-navy">
                      {new Date(calendarSelection.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      <span className="ml-2 text-hampton-navy/70 font-normal">at {calendarSelection.timeSlot!.start.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => {
                        const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                      })}</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => setCalendarExpanded(true)}
                    className="text-xs font-semibold text-hampton-navy/70 underline hover:text-hampton-navy">
                    Change
                  </button>
                </div>
              </div>
            )
          }
          return (
            <div ref={calendarRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
              <div className="bg-hampton-navy px-8 py-5 text-center">
                <h2 className="font-serif text-2xl font-black text-white tracking-tight">CHOOSE YOUR DATE &amp; TIME</h2>
                <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">Select an Available Party Slot</p>
              </div>
              <div className="p-4 sm:p-6 md:p-6">
                {/* Compact wrapper on desktop — narrower max-width keeps the grid tight */}
                <div className="md:max-w-2xl md:mx-auto">
                  <UniversalCalendar
                    mode="booking"
                    lockedBookingType="kids-party"
                    expandable={false}
                    initialExpanded={true}
                    showSummary={false}
                    timeSlotHeading="Select Party Start Time"
                    showTimePlaceholder={true}
                    onSelect={(sel: CalendarSelection) => {
                      setCalendarSelection(sel)
                      if (sel.timeSlot) {
                        setCalendarExpanded(false)
                        // After date+time is locked in, advance the customer
                        // to the next section (Location). Without this the
                        // viewport jumped past Location to Themes due to the
                        // calendar's collapse height change.
                        requestAnimationFrame(() => {
                          const el = document.getElementById('sec-location')
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        })
                      }
                    }}
                  />
                </div>
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
              </div>
            </div>
          )
        })()}

        {/* ══ 0. Party Location ══ */}
        <div id="sec-location" className="scroll-mt-20" />

        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-gradient-to-r from-hampton-navy to-hampton-navy/90 px-8 py-5 text-center">
            <h2 className="font-serif text-2xl font-black text-white tracking-tight">PARTY LOCATION</h2>
            <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">Where Will We Celebrate?</p>
          </div>
          <div className="p-6 sm:p-8 space-y-4">
            {depositPaid && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <span className="text-amber-700 mt-0.5">🔒</span>
                <div className="text-xs leading-relaxed">
                  <p className="font-semibold text-amber-900">Location is locked</p>
                  <p className="text-amber-800/80 mt-0.5">Your deposit is in. Need to change the location? Call us at (631) 998-9325.</p>
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setLocationType('host_hampton'); setMobileAddress(''); setMileage(null); setMileageError('') }}
                disabled={depositPaid}
                className={`text-left p-5 rounded-2xl border-2 transition-all duration-200 ${
                  locationType === 'host_hampton'
                    ? 'border-hampton-navy bg-hampton-navy/5 shadow-md'
                    : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue disabled:opacity-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                    locationType === 'host_hampton' ? 'border-hampton-navy bg-hampton-navy' : 'border-hampton-mauve/40'
                  }`}>
                    {locationType === 'host_hampton' && <Check size={12} className="text-white" />}
                  </span>
                  <div>
                    <p className="font-serif font-bold text-hampton-navy">At Host Hampton</p>
                    <p className="text-xs text-hampton-navy/60 mt-0.5">295 Montauk Hwy, Speonk NY</p>
                    <p className="text-[10px] text-hampton-navy/40 mt-1 uppercase tracking-wider font-semibold">Default · Studio Setting</p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setLocationType('mobile')}
                disabled={depositPaid}
                className={`text-left p-5 rounded-2xl border-2 transition-all duration-200 ${
                  locationType === 'mobile'
                    ? 'border-hampton-navy bg-hampton-navy/5 shadow-md'
                    : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue disabled:opacity-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                    locationType === 'mobile' ? 'border-hampton-navy bg-hampton-navy' : 'border-hampton-mauve/40'
                  }`}>
                    {locationType === 'mobile' && <Check size={12} className="text-white" />}
                  </span>
                  <div>
                    <p className="font-serif font-bold text-hampton-navy">Mobile · At My Location</p>
                    <p className="text-xs text-hampton-navy/60 mt-0.5">We bring the party to you</p>
                    <p className="text-[10px] text-hampton-navy/40 mt-1 uppercase tracking-wider font-semibold">Tristate Area</p>
                  </div>
                </div>
              </button>
            </div>

            {locationType === 'mobile' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-hampton-navy/60 uppercase tracking-wider">Event Address</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mobileAddress}
                    onChange={e => setMobileAddress(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !addressConfirmed && !depositPaid) { e.preventDefault(); confirmMobileAddress() } }}
                    placeholder="123 Main St, Town, NY 11000"
                    readOnly={addressConfirmed || depositPaid}
                    className={`flex-1 form-input ${(addressConfirmed || depositPaid) ? 'bg-hampton-ivory/60 text-hampton-navy/80 cursor-default' : ''}`}
                  />
                  {depositPaid ? null : addressConfirmed ? (
                    <button
                      type="button"
                      onClick={editMobileAddress}
                      className="px-4 py-2 bg-white border-2 border-hampton-navy text-hampton-navy rounded-lg text-sm font-semibold shrink-0 hover:bg-hampton-navy/5"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={confirmMobileAddress}
                      disabled={!mobileAddress || mileageLoading}
                      className="px-4 py-2 bg-hampton-navy text-white rounded-lg text-sm font-semibold disabled:opacity-40 shrink-0"
                    >
                      {mileageLoading ? <Loader2 size={14} className="animate-spin" /> : 'Confirm Address'}
                    </button>
                  )}
                </div>

                {addressConfirmed && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs">
                    <p className="font-semibold text-green-800 flex items-center gap-1.5">
                      <Check size={14} /> Address confirmed
                    </p>
                    {mileage?.resolvedAddress && (
                      <p className="text-green-700/70 mt-0.5 truncate">📍 {mileage.resolvedAddress}</p>
                    )}
                    {mileage && mileage.feeCents === 0 && !mileage?.warning && (
                      <p className="text-green-700/70 mt-0.5">No mobile party fee for this location.</p>
                    )}
                  </div>
                )}
                {mileage?.warning && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    {mileage.warning}
                  </div>
                )}
                {mileageError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{mileageError}</div>
                )}

                <p className="text-xs text-hampton-navy/50 leading-relaxed bg-hampton-blue/10 border border-hampton-blue/15 rounded-lg p-3">
                  <strong className="text-hampton-navy">Note:</strong> We typically service Long Island and we&apos;re happy to travel anywhere in the tristate area (NY, NJ, CT). A Mobile Party Fee may apply based on your location.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ══ Mobile Party Package summary (shown only in mobile mode) ══ */}
        {isMobile && (
          <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-hampton-navy px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">MOBILE PARTY PACKAGE</h2>
              <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                We bring the party to you
              </p>
            </div>
            <div className="p-6 sm:p-8 space-y-4">
              <div className="bg-hampton-ivory/50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-hampton-navy/60">Base (up to 18 guests)</span><span className="font-semibold text-hampton-navy">{fmt(MOBILE_BASE_CENTS)}</span></div>
                <div className="flex justify-between text-xs text-hampton-navy/50"><span>19–27 guests</span><span>+{fmt(MOBILE_TIER2_SURCHARGE_CENTS)}</span></div>
                <div className="flex justify-between text-xs text-hampton-navy/50"><span>28+ guests</span><span>+{fmt(MOBILE_TIER3_SURCHARGE_CENTS)} more</span></div>
                {mobileTravelFeeCents > 0 && (
                  <div className="flex justify-between pt-1.5 mt-1.5 border-t border-hampton-mauve/20">
                    <span className="text-hampton-navy/60">Mobile Party Fee</span>
                    <span className="font-semibold text-hampton-navy">{fmt(mobileTravelFeeCents)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 mt-1.5 border-t-2 border-hampton-navy/20">
                  <span className="font-bold text-hampton-navy">Package total</span>
                  <span className="font-serif font-black text-base text-hampton-navy">{fmt(mobilePackageCents)}</span>
                </div>
              </div>
              <p className="text-xs text-hampton-navy/50 leading-relaxed">
                Customize your party below — activities are billed per person, entertainment add-ons available too. Food, drinks, and decor are not part of the mobile package; you supply those at your location.
              </p>
            </div>
          </div>
        )}

        {/* ══ 1. Themed Party Packages (studio only) ══ */}
        {!isMobile && <div id="sec-themes" className="scroll-mt-20" />}

        {!isMobile && (
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

          {!depositPaid && (
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
                      Max {MINI_PARTY_MAX_GUESTS} guests + birthday child &bull; 1.5 hour experience
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

          {/* ── DIY Party ── */}
          {!depositPaid && (
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
          )}
        </CategoryModule>
        )}

        {/* ══ 1b. Tell Us What You Want ══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-gradient-to-r from-hampton-pink to-hampton-mauve px-8 py-5 text-center">
            <h2 className="font-serif text-2xl font-black text-white tracking-tight">TELL US WHAT YOU WANT</h2>
            <p className="text-white/70 text-xs font-semibold tracking-[0.2em] uppercase mt-1">Make it Yours</p>
          </div>
          <div className="p-6 sm:p-8">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-hampton-navy/60">Color preferences, themed decor, music, special requests, allergies, anything we should know</span>
              <textarea
                value={partyPreferences}
                onChange={e => setPartyPreferences(e.target.value)}
                placeholder="e.g. Pink &amp; gold colors · Encanto soundtrack · No nuts in food · Have a surprise for the birthday star..."
                rows={4}
                className="form-input mt-2 resize-none"
              />
            </label>
          </div>
        </div>

        {/* ══ 2. Guest Count ══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-hampton-navy/60" />
              <div>
                <p className="font-semibold text-hampton-navy text-sm">
                  {effectiveGuestCount} guest{effectiveGuestCount !== 1 ? 's' : ''} + birthday child
                  {isMiniParty && <span className="ml-2 text-xs text-hampton-pink font-bold">(Mini Party max {MINI_PARTY_MAX_GUESTS})</span>}
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
        <div id="sec-activities" className="scroll-mt-20" />

        {(premiumActivities.length > 0 || standardActivities.length > 0) && (
          <CategoryModule
            title="ACTIVITIES"
            subtitle={isMobile ? 'Billed per person · pick as many as you like' : 'Included With Every Party Package'}
            headerBg="bg-hampton-navy"
            lock={categoryLocks.activities}
          >
            {isMobile && (
              <div className="mb-5 p-4 bg-hampton-blue/10 border border-hampton-blue/20 rounded-xl text-xs text-hampton-navy/70 leading-relaxed">
                For mobile parties, each activity is billed at its per-person rate × {effectiveGuestCount} guests. No first-free rule — every activity you pick is added to your total.
              </div>
            )}
            {premiumActivities.length > 0 && (
              <div className="mb-6">
                <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1 border-b border-gray-200 pb-2">{isMobile ? 'Activities' : 'Premium Activities'}</h3>
                {!isMobile && (
                  <p className="text-[11px] text-hampton-navy/60 mb-4">
                    {includedPremiumCount >= 1
                      ? <>1st included &bull; 2nd is +$25/person × guests+1 &bull; max {MAX_PREMIUM_ACTIVITIES}</>
                      : <>1st adds +$100 to your party &bull; 2nd is +$25/person × guests+1 &bull; max {MAX_PREMIUM_ACTIVITIES}</>
                    }
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {premiumActivities.map(a => {
                    const isSelected = selectedActivities.has(a.id)
                    const atMax = !isMobile && !isSelected && selectedPremiumIds.length >= MAX_PREMIUM_ACTIVITIES
                    return (
                      <SelectableActivityChip
                        key={a.id} item={a} selected={isSelected}
                        priceLabel={isSelected ? getActivityLabel(a) : undefined}
                        disabled={atMax}
                        onClick={() => toggle(selectedActivities, setSelectedActivities, a.id)}
                      />
                    )
                  })}
                </div>
              </div>
            )}
            {standardActivities.length > 0 && (
              <div>
                <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1 border-b border-gray-200 pb-2">{isMobile ? 'More Activities' : 'Standard Activities'}</h3>
                {!isMobile && (
                  <p className="text-[11px] text-hampton-navy/60 mb-4">
                    1st &amp; 2nd included &bull; 3rd is +$5/person × guests+1 &bull; max {MAX_STANDARD_ACTIVITIES}
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {standardActivities.map(a => {
                    const isSelected = selectedActivities.has(a.id)
                    const atMax = !isMobile && !isSelected && selectedStandardIds.length >= MAX_STANDARD_ACTIVITIES
                    return (
                      <SelectableActivityChip
                        key={a.id} item={a} selected={isSelected}
                        priceLabel={isSelected ? getActivityLabel(a) : undefined}
                        disabled={atMax}
                        onClick={() => toggle(selectedActivities, setSelectedActivities, a.id)}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </CategoryModule>
        )}

        {/* ══ 4. Food & Catering (studio only) ══ */}
        {!isMobile && <div id="sec-food" className="scroll-mt-20" />}

        {!isMobile && (
        <CategoryModule title="FOOD &amp; CATERING" subtitle="Upgrade Your Menu" titleColor="text-hampton-pink" lock={categoryLocks.food}>
          {/* Pizza or Bagels selector — included at HH */}
          {locationType === 'host_hampton' && (
            <div className="mb-5 p-4 bg-hampton-blue/10 border border-hampton-blue/20 rounded-xl">
              <p className="text-xs font-bold uppercase tracking-wider text-hampton-navy/70 mb-2">Included With Your Party</p>
              <p className="text-xs text-hampton-navy/60 mb-3">Pick one — both come with sides &amp; serve up to {effectiveGuestCount} guests.</p>
              <div className="grid grid-cols-2 gap-2">
                {(['pizza', 'bagels'] as const).map(opt => (
                  <button key={opt} type="button" onClick={() => setPizzaOrBagels(opt)}
                    className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                      pizzaOrBagels === opt ? 'border-hampton-navy bg-hampton-navy/5 text-hampton-navy' : 'border-hampton-mauve/25 text-hampton-navy/60 hover:border-hampton-blue'
                    }`}>
                    {opt === 'pizza' ? '🍕 Pizza' : '🥯 Bagels'}
                    {pizzaOrBagels === opt && <Check size={14} className="inline ml-2 text-green-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {food.length > 0 && (
            <AddOnGridWithQty items={food} selected={selectedFood} qty={foodQty} onToggle={toggleFood} onQtyChange={setFoodItemQty} />
          )}
        </CategoryModule>
        )}

        {/* ══ 5. Desserts (studio only) ══ */}
        {!isMobile && <div id="sec-desserts" className="scroll-mt-20" />}

        {!isMobile && (
        <CategoryModule title="DESSERTS" subtitle="Sweet Additions" headerBg="bg-gradient-to-r from-hampton-pink to-hampton-mauve" lock={categoryLocks.desserts}>
          {/* Cupcake flavor — included at HH, add-on at mobile */}
          <div className="mb-5 p-4 bg-hampton-pink/10 border border-hampton-pink/20 rounded-xl">
            <p className="text-xs font-bold uppercase tracking-wider text-hampton-navy/70 mb-1">Cupcakes</p>
            <p className="text-xs text-hampton-navy/60 mb-3">
              {locationType === 'host_hampton'
                ? 'Included for every guest — pick your flavor.'
                : 'For mobile parties, cupcakes are an add-on ($5 per guest).'}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {(['vanilla', 'chocolate'] as const).map(opt => (
                <button key={opt} type="button" onClick={() => setCupcakeFlavor(opt)}
                  className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    cupcakeFlavor === opt ? 'border-hampton-navy bg-hampton-navy/5 text-hampton-navy' : 'border-hampton-mauve/25 text-hampton-navy/60 hover:border-hampton-blue'
                  }`}>
                  {opt === 'vanilla' ? '🧁 Vanilla' : '🍫 Chocolate'}
                  {cupcakeFlavor === opt && <Check size={14} className="inline ml-2 text-green-600" />}
                </button>
              ))}
            </div>
            {/* Mobile cupcake add-on retired with the Mobile Party Package
                rebuild — dessert section is studio-only now. */}
          </div>
          {desserts.length > 0 && (
            <AddOnGrid items={desserts} selected={selectedDesserts} onToggle={id => toggle(selectedDesserts, setSelectedDesserts, id)} />
          )}
        </CategoryModule>
        )}

        {/* ══ 6. Beverages (studio only) ══ */}
        {!isMobile && <div id="sec-drinks" className="scroll-mt-20" />}

        {!isMobile && (
        <CategoryModule title="BEVERAGES" subtitle="Refreshments" titleColor="text-hampton-pink" lock={categoryLocks.beverages}>
          {locationType === 'host_hampton' && (
            <div className="mb-5 p-3 bg-hampton-blue/10 border border-hampton-blue/15 rounded-lg">
              <p className="text-xs text-hampton-navy/70">
                <strong className="text-hampton-navy">Included at Host Hampton:</strong> water &amp; juice boxes for every child.
              </p>
            </div>
          )}
          {beverages.length > 0 && (
            <AddOnGrid items={beverages} selected={selectedBeverages} onToggle={id => toggle(selectedBeverages, setSelectedBeverages, id)} />
          )}
        </CategoryModule>
        )}

        {/* ══ 7. Decor (studio only) ══ */}
        {!isMobile && <div id="sec-decor" className="scroll-mt-20" />}

        {!isMobile && decor.length > 0 && (
          <CategoryModule title="DÉCOR UPGRADES" subtitle="Elevate the Atmosphere" headerBg="bg-hampton-navy" lock={categoryLocks.decor}>
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

        {/* ══ 8. Party Extras ══ */}
        <div id="sec-extras" className="scroll-mt-20" />

        {partyAddOns.length > 0 && (
          <CategoryModule title="PARTY EXTRAS" subtitle="Favors &amp; Finishing Touches" headerBg="bg-gradient-to-r from-hampton-pink to-hampton-mauve" lock={categoryLocks.extras}>
            <AddOnGrid items={partyAddOns} selected={selectedPartyAddOns} onToggle={id => toggle(selectedPartyAddOns, setSelectedPartyAddOns, id)} />
          </CategoryModule>
        )}

        {/* ══ 9. Entertainment ══ */}
        <div id="sec-entertainment" className="scroll-mt-20" />

        {entertainment.length > 0 && (() => {
          const characterItem = entertainment.find(e => /character/i.test(e.name))
          const characterSelected = characterItem ? selectedEntertainment.has(characterItem.id) : false
          return (
            <CategoryModule title="ENTERTAINMENT" subtitle="Make It Unforgettable" titleColor="text-hampton-pink" lock={categoryLocks.entertainment}>
              <AddOnGrid items={entertainment} selected={selectedEntertainment} onToggle={id => toggle(selectedEntertainment, setSelectedEntertainment, id)} />
              {characterSelected && (
                <div className="mt-5 p-4 bg-hampton-blue/10 border border-hampton-blue/20 rounded-xl">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wider text-hampton-navy/70">Which character would you like?</span>
                    <p className="text-[11px] text-hampton-navy/50 mt-0.5 mb-2">Tell us your top pick (and a backup) — subject to availability. Starting at $395.</p>
                    <input
                      type="text"
                      value={characterRequest}
                      onChange={e => setCharacterRequest(e.target.value)}
                      placeholder="e.g. Elsa from Frozen (backup: Moana)"
                      className="form-input"
                    />
                  </label>
                </div>
              )}
            </CategoryModule>
          )
        })()}

        {/* ══ 10. Save Your Quote (simplified contact form) ══ */}
        <div id="sec-contact" className="scroll-mt-20" />

        <div ref={formRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-hampton-navy px-8 py-6 text-center">
            <h2 className="font-serif text-2xl font-black text-white tracking-tight">SAVE YOUR PARTY PLAN</h2>
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
                <label className="form-label">Child&apos;s Name</label>
                <input type="text" placeholder="Cora" value={contact.childName}
                  onChange={e => updateContact('childName', e.target.value)} className="form-input" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Child Turning Age</label>
                <input
                  type="number"
                  min={1}
                  max={21}
                  placeholder="8"
                  value={contact.childAge}
                  onChange={e => updateContact('childAge', e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Catchy Party Name</label>
                <input
                  type="text"
                  placeholder="Cora's Glow-Up Birthday!"
                  value={contact.catchyPartyName}
                  onChange={e => updateContact('catchyPartyName', e.target.value)}
                  className="form-input"
                />
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

            {isAdmin ? (
              // Admin: two-button save — silent (no customer email) or notify.
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => handleSaveForLater({ sendEmail: false })} disabled={saving}
                  className="border-2 border-hampton-navy/30 text-hampton-navy font-bold py-3.5 px-4 rounded-full text-sm hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
                  title="Save without notifying the customer"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <><Bookmark size={16} /> Save Only</>}
                </button>
                <button type="button" onClick={() => handleSaveForLater({ sendEmail: true })} disabled={saving}
                  className="bg-hampton-navy text-white font-bold py-3.5 px-4 rounded-full text-sm hover:bg-opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
                  title="Save and email the customer the updated plan"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <><Bookmark size={16} /> Save &amp; Send</>}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => handleSaveForLater()} disabled={saving}
                className="w-full border-2 border-hampton-navy text-hampton-navy font-bold py-3.5 px-6 rounded-full text-sm hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Bookmark size={16} /> {loadedBooking ? 'Update My Party Plan' : 'Save & Email My Party Plan'}</>}
              </button>
            )}
          </div>
        </div>

        {/* ══ 11. Party Summary ══ */}
        <div id="sec-summary" className="scroll-mt-20" />

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
              {(contact.fullName || contact.catchyPartyName || contact.childName) && (
                <div className="mb-5 pb-4 border-b border-hampton-mauve/15">
                  {contact.catchyPartyName && <p className="font-serif font-bold text-lg text-hampton-navy">{contact.catchyPartyName}</p>}
                  {contact.childName && (
                    <p className="text-sm text-hampton-navy/70 font-semibold">
                      For {contact.childName}{contact.childAge ? `, turning ${contact.childAge}` : ''}
                    </p>
                  )}
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
                    <span className={`text-sm font-bold whitespace-nowrap ${li.amount < 0 ? 'text-green-700' : 'text-hampton-navy'}`}>
                      {li.amount < 0 ? `-${fmt(-li.amount)}` : li.amount > 0 ? fmt(li.amount) : 'Included'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total — pre-deposit emphasis is on the total; post-deposit
                  the balance gets the big number below. */}
              <div className="flex items-baseline justify-between mt-4 pt-4 border-t-2 border-hampton-navy">
                <span className={`font-serif font-bold ${depositPaid ? 'text-sm text-hampton-navy/70' : 'text-lg text-hampton-navy'}`}>Estimated Total</span>
                <span className={`font-serif font-bold ${depositPaid ? 'text-base text-hampton-navy/70' : 'text-2xl text-hampton-navy'}`}>{fmt(total)}</span>
              </div>

              {/* Deposit callout — pre-deposit only.
                  After deposit, the payment-history block below shows the
                  authoritative paid + live remaining. */}
              {!depositPaid && (
                <div className="mt-4 bg-hampton-pink/10 border border-hampton-pink/20 rounded-xl p-4 text-center">
                  <p className="text-sm text-hampton-navy font-medium">
                    <span className="font-bold">{fmt(depositCents)} deposit</span> to reserve your date — fully applied toward your balance
                  </p>
                  <p className="text-xs text-hampton-navy/50 mt-1">
                    Remaining balance of <span className="font-bold">{fmt(Math.max(0, total - depositCents))}</span> due before event
                  </p>
                </div>
              )}

              {/* Payment history (post-deposit) */}
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
                  <div className="mt-3 pt-3 border-t border-hampton-mauve/15 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-hampton-navy/60">Total paid</span>
                      <span className="font-semibold text-green-700">{fmt(totalPaid)}</span>
                    </div>
                    <div className="flex items-baseline justify-between pt-2 border-t-2 border-hampton-navy/15">
                      <span className="font-serif font-bold text-xl text-hampton-navy">Balance Remaining</span>
                      <span className="font-serif font-black text-3xl text-hampton-navy">{fmt(balanceRemaining)}</span>
                    </div>
                    {loadedBooking && balanceRemaining !== loadedBooking.balance_due_cents && (
                      <p className="text-[11px] text-hampton-navy/40 italic mt-1">
                        Reflects your current selections — save to update the booking record.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ 13. Pay Deposit ══ */}
        <div id="sec-book" className="scroll-mt-20" />

        {hasSelections && !depositPaid && (!loadedBooking || loadedBooking.status === 'awaiting_deposit') && (
          <div ref={payRef} className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-gradient-to-r from-hampton-pink to-hampton-mauve px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">REQUEST YOUR PARTY</h2>
              <p className="text-white/70 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                We Confirm Availability Within 24 Hours
              </p>
            </div>

            <div className="p-6 sm:p-8">
              {paymentSuccess ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-600" />
                  </div>
                  <h3 className="font-serif text-xl font-bold text-hampton-navy mb-2">You&apos;re Booked!</h3>
                  <p className="text-sm text-hampton-navy/60">Your deposit has been received. We&apos;ll confirm your booking within 24 hours.</p>
                  <p className="text-sm text-hampton-navy/60 mt-1">Check your email for your portal link to manage your party.</p>
                </div>
              ) : depositPledgeSuccess ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Check size={32} className="text-green-600" />
                  </div>
                  <h3 className="font-serif text-xl font-bold text-hampton-navy mb-2">Your Date Is Locked!</h3>
                  <p className="text-sm text-hampton-navy/70 max-w-md mx-auto">{depositPledgeSuccess}</p>
                </div>
              ) : checkoutReady ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-lg text-hampton-navy font-bold">Enter Card Details</h3>
                    <button onClick={() => {
                      if (paymentElementRef.current) { paymentElementRef.current.unmount(); paymentElementRef.current = null }
                      elementsRef.current = null
                      paymentIntentIdRef.current = null
                      setCheckoutReady(false)
                    }} className="text-xs text-gray-400 hover:text-gray-600" disabled={confirming}>Cancel</button>
                  </div>
                  <div ref={checkoutRef} className="mb-5" />
                  {payError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">{payError}</div>
                  )}
                  <button
                    onClick={confirmDepositPayment}
                    disabled={confirming}
                    className="w-full bg-hampton-navy text-white font-bold py-4 px-6 rounded-full text-sm hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {confirming ? (
                      <><Loader2 size={16} className="animate-spin" /> Processing...</>
                    ) : (
                      <><CreditCard size={16} /> Pay {formatMoney(depositCents + calculateCardFee(depositCents))} Now</>
                    )}
                  </button>
                  <p className="text-[11px] text-hampton-navy/40 text-center mt-2">
                    Secured by Stripe · Your card details never touch our servers
                  </p>
                </>
              ) : (
                <>
                  {/* Condensed summary */}
                  <div className="bg-hampton-ivory/40 border border-hampton-mauve/15 rounded-xl p-4 mb-5 space-y-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-hampton-navy/50 mb-1">Party Summary</p>
                    {themeItem && (
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-hampton-navy/70">Theme</span>
                        <span className="font-semibold text-hampton-navy truncate ml-2">{themeItem.name}{isMiniParty && ' (Mini)'}</span>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-hampton-navy/70">Guests</span>
                      <span className="font-semibold text-hampton-navy">{effectiveGuestCount}{extraGuests > 0 && ` (+${extraGuests} extra)`}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-hampton-navy/70">Location</span>
                      <span className="font-semibold text-hampton-navy text-right truncate ml-2">
                        {locationType === 'mobile' ? (mobileAddress || 'Mobile · TBD') : 'Host Hampton, Speonk NY'}
                      </span>
                    </div>
                    {calendarSelection?.date && (
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-hampton-navy/70">Date</span>
                        <span className="font-semibold text-hampton-navy text-right ml-2">
                          {new Date(calendarSelection.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {calendarSelection.timeSlot && <span className="ml-1 text-hampton-navy/60 font-normal">at {calendarSelection.timeSlot.start.replace(/^(\d{1,2}):(\d{2})$/, (_, h, m) => {
                            const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                          })}</span>}
                        </span>
                      </div>
                    )}
                    {addOnCount > 0 && (
                      <div className="pt-2 mt-2 border-t border-hampton-mauve/15">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-hampton-navy/50 mb-1.5">Add-Ons ({addOnCount})</p>
                        <p className="text-xs text-hampton-navy/70 leading-relaxed">
                          {summaryLineItems
                            .filter(li => li.key !== 'theme' && li.key !== 'extra-guests' && !li.isDiscount)
                            .map(li => li.label + (li.qty && li.qty > 1 ? ` ×${li.qty}` : ''))
                            .join(' · ')}
                        </p>
                      </div>
                    )}
                    <div className="pt-2 mt-1 border-t-2 border-hampton-navy/15 flex items-baseline justify-between">
                      <span className="font-bold text-hampton-navy">Party Total</span>
                      <span className="font-serif font-black text-xl text-hampton-navy">{fmt(total)}</span>
                    </div>
                  </div>

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

                  {/* Deposit preview — shown for transparency; no charge now */}
                  <div className="bg-hampton-ivory/50 rounded-xl p-4 mb-5">
                    <div className="flex justify-between text-sm text-hampton-navy/70">
                      <span>Party total</span>
                      <span>{fmt(total)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-hampton-navy/70">
                      <span>Deposit to reserve</span>
                      <span>{formatMoney(depositCents)}</span>
                    </div>
                    <p className="text-xs text-hampton-navy/50 mt-2">
                      No payment today. Once we confirm your date is available, we&apos;ll email you a secure link to pay your deposit and lock it in.
                    </p>
                  </div>

                  {payError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">{payError}</div>}

                  <button
                    onClick={handlePayDeposit}
                    disabled={payProcessing || !contactComplete || !selectedTheme || !dateTimeSelected}
                    className="w-full bg-hampton-navy text-white font-bold py-4 px-6 rounded-full text-sm hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {payProcessing ? (
                      <><Loader2 size={16} className="animate-spin" /> Sending...</>
                    ) : (
                      <><Check size={16} /> Request This Party</>
                    )}
                  </button>

                  <p className="text-xs text-hampton-navy/40 text-center mt-3">
                    Submitting a request doesn&apos;t charge you — we&apos;ll confirm availability and email you within 24 hours.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ══ 14. Make a Payment (post-deposit) ══ */}
        {balanceRemaining > 0 && (depositPaid || (loadedBooking && ['approved', 'deposit_paid', 'paid_in_full'].includes(loadedBooking.status))) && (
          <div data-section="make-payment" className="scroll-mt-24 bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-gradient-to-r from-hampton-navy to-hampton-navy/90 px-8 py-5 text-center">
              <h2 className="font-serif text-2xl font-black text-white tracking-tight">MAKE A PAYMENT</h2>
              <p className="text-hampton-ivory/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                Balance Remaining: {fmt(balanceRemaining)}
              </p>
            </div>
            <div className="p-6 sm:p-8 space-y-4">
              {addPayCheckoutReady ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif text-lg text-hampton-navy font-bold">Enter Card Details</h3>
                    <button onClick={() => {
                      if (addPayElementRef.current) { addPayElementRef.current.unmount(); addPayElementRef.current = null }
                      addPayElementsRef.current = null
                      addPayIntentIdRef.current = null
                      setAddPayCheckoutReady(false)
                    }} className="text-xs text-gray-400 hover:text-gray-600" disabled={addPayConfirming}>Cancel</button>
                  </div>
                  <div ref={addPayCheckoutRef} className="mb-4" />
                  {addPayError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-3">{addPayError}</div>
                  )}
                  <button
                    onClick={confirmAdditionalPayment}
                    disabled={addPayConfirming}
                    className="w-full bg-hampton-navy text-white font-bold py-3.5 px-6 rounded-full text-sm hover:bg-opacity-90 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {addPayConfirming
                      ? <><Loader2 size={16} className="animate-spin" /> Processing...</>
                      : <><CreditCard size={16} /> Confirm & Pay</>
                    }
                  </button>
                  <p className="text-[11px] text-hampton-navy/40 text-center mt-2">
                    Secured by Stripe · Your card details never touch our servers
                  </p>
                </>
              ) : addPaySuccess ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
                  <Check size={28} className="text-green-600 mx-auto mb-2" />
                  <p className="text-sm text-green-800">{addPaySuccess}</p>
                  <button onClick={() => setAddPaySuccess('')} className="mt-3 text-xs underline text-green-700">Make another payment</button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-hampton-navy/60 uppercase tracking-wider">Amount</label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-2xl font-bold text-hampton-navy">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        placeholder="0.00"
                        value={addPayAmount}
                        onChange={e => setAddPayAmount(e.target.value)}
                        className="flex-1 text-2xl font-bold text-hampton-navy bg-transparent border-b-2 border-hampton-mauve/30 focus:border-hampton-navy outline-none py-2"
                      />
                    </div>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button type="button" onClick={() => setAddPayAmount((balanceRemaining / 100).toFixed(2))}
                        className="px-3 py-1.5 rounded-full bg-hampton-navy/10 text-hampton-navy text-xs font-semibold hover:bg-hampton-navy/15">
                        Pay full balance ({fmt(balanceRemaining)})
                      </button>
                      <button type="button" onClick={() => setAddPayAmount((Math.round(balanceRemaining / 2) / 100).toFixed(2))}
                        className="px-3 py-1.5 rounded-full bg-hampton-navy/5 text-hampton-navy/70 text-xs font-semibold hover:bg-hampton-navy/10">
                        50% ({fmt(Math.round(balanceRemaining / 2))})
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-hampton-navy/60 uppercase tracking-wider">Payment Method</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                      {([
                        { value: 'card' as const, label: 'Card', sub: '+3% fee' },
                        { value: 'venmo' as const, label: 'Venmo', sub: 'no fee' },
                        { value: 'zelle' as const, label: 'Zelle', sub: 'no fee' },
                        { value: 'cash' as const, label: 'Cash', sub: 'no fee' },
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setAddPayMethod(opt.value)}
                          className={`px-3 py-3 rounded-xl border-2 text-left transition-all ${
                            addPayMethod === opt.value
                              ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
                              : 'border-hampton-mauve/25 hover:border-hampton-blue'
                          }`}
                        >
                          <p className="font-bold text-sm text-hampton-navy">{opt.label}</p>
                          <p className="text-[10px] text-hampton-navy/50 mt-0.5">{opt.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tip jar — shows on card payments when paying full balance
                      or within a week of the party. Customer can adjust or
                      zero out. Tip lifts the Stripe charge but doesn't count
                      toward the booking balance. */}
                  {showTipModule && (
                    <div className="bg-hampton-pink/10 border border-hampton-pink/25 rounded-xl p-4 space-y-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-hampton-navy/70">Tip for the party helpers</p>
                        <p className="text-[11px] text-hampton-navy/60 mt-0.5">Optional gratuity for the team running your party. Default is 10% of the party total — adjust as you like.</p>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[0, 10, 15, 20].map(pct => {
                          const presetCents = Math.round(total * pct / 100 / 100) * 100
                          const active = tipCents === presetCents
                          return (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => { setTipCents(presetCents); setTipTouched(true) }}
                              className={`py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                active
                                  ? 'bg-hampton-navy text-white border-hampton-navy'
                                  : 'bg-white text-hampton-navy border-hampton-mauve/30 hover:border-hampton-navy'
                              }`}
                            >
                              {pct === 0 ? 'None' : `${pct}%`}
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-hampton-navy/60">$</span>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={tipCents > 0 ? (tipCents / 100).toFixed(0) : ''}
                          onChange={e => {
                            const dollars = parseFloat(e.target.value)
                            setTipCents(isNaN(dollars) || dollars < 0 ? 0 : Math.round(dollars) * 100)
                            setTipTouched(true)
                          }}
                          placeholder={`${(recommendedTipCents / 100).toFixed(0)}`}
                          className="flex-1 text-sm font-semibold text-hampton-navy bg-white/60 border border-hampton-mauve/30 rounded-lg px-3 py-1.5 focus:outline-none focus:border-hampton-navy"
                        />
                        <span className="text-[11px] text-hampton-navy/40">custom</span>
                      </div>
                    </div>
                  )}

                  {addPayMethod === 'card' && addPayAmount && (
                    <div className="bg-hampton-ivory/50 rounded-xl p-3 text-xs space-y-1">
                      <div className="flex justify-between text-hampton-navy/70">
                        <span>Payment</span>
                        <span>{fmt(Math.round(parseFloat(addPayAmount || '0') * 100))}</span>
                      </div>
                      {showTipModule && tipCents > 0 && (
                        <div className="flex justify-between text-hampton-navy/70">
                          <span>Tip</span>
                          <span>{fmt(tipCents)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-hampton-navy/50">
                        <span>Card fee (3%)</span>
                        <span>{fmt(calculateCardFee(Math.round(parseFloat(addPayAmount || '0') * 100) + (showTipModule ? tipCents : 0)))}</span>
                      </div>
                      <div className="flex justify-between font-bold text-hampton-navy pt-1 border-t border-hampton-mauve/20">
                        <span>Total charge</span>
                        <span>{fmt(Math.round(parseFloat(addPayAmount || '0') * 100) + (showTipModule ? tipCents : 0) + calculateCardFee(Math.round(parseFloat(addPayAmount || '0') * 100) + (showTipModule ? tipCents : 0)))}</span>
                      </div>
                    </div>
                  )}

                  {addPayMethod !== 'card' && addPayAmount && (
                    <div className="bg-hampton-blue/10 border border-hampton-blue/20 rounded-xl p-3 text-xs text-hampton-navy/70 leading-relaxed">
                      {addPayMethod === 'venmo' && <>Send {fmt(Math.round(parseFloat(addPayAmount || '0') * 100))} on Venmo to <strong><a href={`https://venmo.com/?txn=pay&recipients=hosthampton&amount=${(Math.round(parseFloat(addPayAmount || '0') * 100) / 100).toFixed(2)}&note=${encodeURIComponent(loadedBooking?.booking_ref ? `Host Hampton ${loadedBooking.booking_ref}` : 'Host Hampton party')}`} target="_blank" rel="noopener noreferrer" className="underline">@HostHampton</a></strong> (Venmo phone <strong>631-599-2469</strong>). Put your booking ref{loadedBooking?.booking_ref ? <> <strong>{loadedBooking.booking_ref}</strong></> : null} in the note, then confirm below and we&apos;ll match it up.</>}
                      {addPayMethod === 'zelle' && <>Send {fmt(Math.round(parseFloat(addPayAmount || '0') * 100))} via Zelle to <strong>631-599-2469</strong> (Host Hampton). Put your booking ref{loadedBooking?.booking_ref ? <> <strong>{loadedBooking.booking_ref}</strong></> : null} in the memo, then confirm below and we&apos;ll match it up.</>}
                      {addPayMethod === 'cash' && <>Bring {fmt(Math.round(parseFloat(addPayAmount || '0') * 100))} in cash to your party or the studio. Confirm below.</>}
                    </div>
                  )}

                  {addPayError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{addPayError}</div>}

                  <button
                    onClick={handleAdditionalPayment}
                    disabled={addPayProcessing || !addPayAmount || parseFloat(addPayAmount) <= 0}
                    className="w-full bg-hampton-navy text-white font-bold py-3.5 px-6 rounded-full text-sm hover:bg-opacity-90 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {addPayProcessing
                      ? <><Loader2 size={16} className="animate-spin" /> Processing...</>
                      : addPayMethod === 'card'
                        ? <><CreditCard size={16} /> Pay with Card</>
                        : <><Wallet size={16} /> Confirm I&apos;ll Send {addPayMethod.charAt(0).toUpperCase() + addPayMethod.slice(1)}</>
                    }
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Expandable Bottom Bar ── */}
      <div className={`fixed left-0 right-0 bottom-0 z-50 transition-all duration-300 ${barExpanded ? 'top-0' : ''}`}>
        {barExpanded && (
          <div className="absolute inset-0 bg-black/40" onClick={() => setBarExpanded(false)} />
        )}
        <div className={`relative bg-white border-t-2 border-hampton-mauve/20 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] ${
          barExpanded ? 'h-full flex flex-col rounded-t-3xl' : ''
        }`}>
          {/* Expand handle */}
          <button
            type="button"
            onClick={() => setBarExpanded(e => !e)}
            className="absolute -top-3 left-1/2 -translate-x-1/2 bg-hampton-navy text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg hover:bg-hampton-navy/90 transition-all z-10"
            title={barExpanded ? 'Collapse' : 'Expand'}
          >
            {barExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>

          {/* Expanded content */}
          {barExpanded && (
            <div className="flex-1 overflow-y-auto pt-12 pb-4">
              <div className="max-w-3xl mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                  <h2 className="font-serif text-2xl font-black text-hampton-navy">Your Party Plan</h2>
                  {isAdmin && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-hampton-pink/15 text-hampton-pink px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                        <ShieldCheck size={12} /> Admin Mode
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm('Clear the currently loaded plan and start a new blank party plan?')) return
                          try { await fetch('/api/portal/clear', { method: 'POST' }) } catch { /* ignore */ }
                          window.location.assign('/party-planner?new=true')
                        }}
                        className="text-xs font-semibold text-hampton-navy/70 hover:text-hampton-navy border border-hampton-navy/25 hover:border-hampton-navy rounded-full px-3 py-1 transition-colors"
                        title="Discard the loaded booking and start fresh"
                      >
                        Start New Plan
                      </button>
                    </div>
                  )}
                </div>

                {summaryLineItems.length === 0 ? (
                  <p className="text-hampton-navy/40 text-center py-12">No items selected yet. Choose a theme to begin.</p>
                ) : (
                  <div className="space-y-2">
                    {summaryLineItems.map(li => (
                      <div
                        key={li.key}
                        className={`flex items-center gap-3 py-3 px-4 rounded-xl border ${
                          li.isDiscount ? 'bg-green-50 border-green-200' : 'bg-white border-hampton-mauve/15'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold ${li.isDiscount ? 'text-green-800' : 'text-hampton-navy'}`}>
                            {li.label}
                          </p>
                          {li.detail && <p className="text-[11px] text-hampton-navy/40">{li.detail}</p>}
                        </div>
                        {li.qtyKind || li.isCustom ? (
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => changeLineItemQty(li, -1)}
                              className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue">
                              <Minus size={12} />
                            </button>
                            <span className="w-8 text-center text-sm font-bold text-hampton-navy">{li.qty ?? 1}</span>
                            <button type="button" onClick={() => changeLineItemQty(li, 1)}
                              className="w-7 h-7 rounded-lg border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy hover:border-hampton-blue">
                              <Plus size={12} />
                            </button>
                          </div>
                        ) : null}
                        <span className={`text-sm font-bold whitespace-nowrap ${li.isDiscount ? 'text-green-700' : 'text-hampton-navy'}`}>
                          {li.amount < 0 ? `-${fmt(-li.amount)}` : fmt(li.amount)}
                        </span>
                        <button type="button" onClick={() => removeLineItem(li)}
                          className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"
                          title="Remove">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals block */}
                <div className="mt-6 bg-hampton-ivory/40 rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-hampton-navy/60">Subtotal</span>
                    <span className="font-semibold text-hampton-navy">{fmt(total)}</span>
                  </div>
                  {totalPaid > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-green-700">Paid</span>
                      <span className="font-semibold text-green-700">−{fmt(totalPaid)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-hampton-navy/10">
                    <span className="font-bold text-hampton-navy">{depositPaid ? 'Balance Due' : 'Deposit to Reserve'}</span>
                    <span className="font-serif font-black text-2xl text-hampton-navy">
                      {depositPaid ? fmt(balanceRemaining) : fmt(depositCents)}
                    </span>
                  </div>
                  {!depositPaid && total > depositCents && (
                    <p className="text-xs text-hampton-navy/50 text-right">
                      Remaining {fmt(total - depositCents)} due before event
                    </p>
                  )}
                </div>

                {/* Admin controls */}
                {isAdmin && (
                  <div className="mt-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={14} className="text-hampton-pink" />
                      <p className="text-xs font-bold uppercase tracking-wider text-hampton-navy/60">Admin Tools</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button type="button" onClick={() => { setShowCustomItemForm(s => !s); setCustomItemDraft(d => ({ ...d, is_discount: false })) }}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-hampton-navy text-white text-xs font-semibold hover:bg-hampton-navy/90">
                        <Plus size={14} /> Add Custom Item
                      </button>
                      <button type="button" onClick={() => { setShowCustomItemForm(s => !s); setCustomItemDraft(d => ({ ...d, is_discount: true })) }}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-green-700 text-white text-xs font-semibold hover:bg-green-800">
                        <Tag size={14} /> Add Discount
                      </button>
                      <button type="button" onClick={() => setShowRecordPayForm(s => !s)}
                        disabled={!loadedBooking}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-hampton-pink text-white text-xs font-semibold hover:bg-hampton-pink/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={loadedBooking ? '' : 'Save the plan first'}>
                        <Wallet size={14} /> Record Payment
                      </button>
                    </div>

                    {showCustomItemForm && (
                      <div className="bg-white border border-hampton-mauve/30 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" placeholder="Item name" value={customItemDraft.name}
                            onChange={e => setCustomItemDraft({ ...customItemDraft, name: e.target.value })}
                            className="px-3 py-2 border rounded-lg text-sm col-span-2" />
                          <input type="number" placeholder="Price ($)" value={customItemDraft.price} step="0.01"
                            onChange={e => setCustomItemDraft({ ...customItemDraft, price: e.target.value })}
                            className="px-3 py-2 border rounded-lg text-sm" />
                          <input type="number" placeholder="Qty" value={customItemDraft.quantity} min="1"
                            onChange={e => setCustomItemDraft({ ...customItemDraft, quantity: e.target.value })}
                            className="px-3 py-2 border rounded-lg text-sm" />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-hampton-navy/70">
                          <input type="checkbox" checked={customItemDraft.guest_multiplied}
                            onChange={e => setCustomItemDraft({ ...customItemDraft, guest_multiplied: e.target.checked })} />
                          Multiply by guest count
                        </label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setShowCustomItemForm(false)} className="flex-1 px-3 py-2 border rounded-lg text-sm">Cancel</button>
                          <button type="button" onClick={addCustomItemFromForm}
                            className="flex-1 px-3 py-2 bg-hampton-navy text-white rounded-lg text-sm font-semibold">
                            {customItemDraft.is_discount ? 'Add Discount' : 'Add Item'}
                          </button>
                        </div>
                      </div>
                    )}

                    {showRecordPayForm && (
                      <div className="bg-white border border-hampton-mauve/30 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" placeholder="Amount ($)" value={recordPayDraft.amount} step="0.01"
                            onChange={e => setRecordPayDraft({ ...recordPayDraft, amount: e.target.value })}
                            className="px-3 py-2 border rounded-lg text-sm" />
                          <select value={recordPayDraft.method}
                            onChange={e => setRecordPayDraft({ ...recordPayDraft, method: e.target.value as typeof recordPayDraft.method })}
                            className="px-3 py-2 border rounded-lg text-sm">
                            <option value="cash">Cash</option>
                            <option value="venmo">Venmo</option>
                            <option value="zelle">Zelle</option>
                            <option value="check">Check</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <input type="text" placeholder="Notes (optional)" value={recordPayDraft.notes}
                          onChange={e => setRecordPayDraft({ ...recordPayDraft, notes: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setShowRecordPayForm(false)} className="flex-1 px-3 py-2 border rounded-lg text-sm">Cancel</button>
                          <button type="button" onClick={recordPayment} disabled={adminBusy === 'pay'}
                            className="flex-1 px-3 py-2 bg-hampton-pink text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                            {adminBusy === 'pay' ? 'Saving...' : 'Record Payment'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Minimized bar — simplified: just "$X to reserve" + guest counter + Book */}
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {depositPaid ? (
                <>
                  <p className="text-[10px] text-green-700 font-semibold uppercase tracking-widest">Balance Due</p>
                  <p className="text-2xl font-bold text-hampton-navy leading-tight">{fmt(balanceRemaining)}</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-hampton-navy leading-tight">
                    {total > 0 ? fmt(depositCents) : '—'}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-hampton-navy/60">
                    {total > 0 ? 'to reserve your date' : 'Choose a theme'}
                  </p>
                </>
              )}
            </div>
            {/* Post-deposit bottom bar — Cancel · Msg · Pay · Save (L→R) */}
            {depositPaid ? (
              <div className="shrink-0 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={revertChanges}
                  className="border border-hampton-navy/25 text-hampton-navy px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm hover:bg-hampton-navy/5 transition-all flex items-center gap-1 sm:gap-1.5"
                  title="Discard unsaved changes"
                >
                  <Undo2 size={13} />
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSendMsgOpen(true)}
                  className="border border-hampton-navy/25 text-hampton-navy px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm hover:bg-hampton-navy/5 transition-all flex items-center gap-1 sm:gap-1.5"
                  title="Message Host Hampton"
                >
                  <MessageCircle size={13} />
                  <span>Msg</span>
                </button>
                {balanceRemaining > 0 && (
                  <button
                    type="button"
                    onClick={() => { setBarExpanded(false); const el = document.querySelector('[data-section="make-payment"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className="bg-hampton-pink text-hampton-navy font-bold px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm hover:bg-opacity-90 transition-all flex items-center gap-1 sm:gap-1.5"
                    title="Make a payment"
                  >
                    <CreditCard size={13} />
                    <span>Pay</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openSaveChangesModal}
                  className="bg-hampton-navy text-white font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm hover:bg-opacity-90 transition-all flex items-center gap-1 sm:gap-1.5"
                  title="Save changes"
                >
                  <Save size={13} />
                  <span>Save</span>
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { setBarExpanded(false); scrollToForm() }}
                className="shrink-0 bg-hampton-navy text-white font-bold px-3 sm:px-5 py-3 rounded-full text-sm hover:bg-opacity-90 transition-all flex items-center gap-1.5">
                <CreditCard size={14} />
                <span className="hidden sm:inline">Book Now</span>
                <span className="sm:hidden">Book</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <ChangesModal
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        onConfirm={confirmSaveChanges}
        onConfirmSilent={confirmSaveChangesSilent}
        isAdmin={isAdmin}
        changes={currentChanges}
        oldTotalFormatted={fmt(oldTotalAtModalOpen)}
        newTotalFormatted={fmt(total)}
        saving={saving}
        error={error}
      />
      <SendMessageModal
        open={sendMsgOpen}
        onClose={() => setSendMsgOpen(false)}
        bookingRef={loadedBooking?.booking_ref}
      />
    </div>
  )
}
