export interface BookingLineItem {
  id?: string
  booking_id?: string
  pricing_item_id?: string | null
  name: string
  category: string
  quantity: number
  unit_price_cents: number
  price_type: 'flat' | 'per_person'
  guest_multiplied: boolean
  sort_order?: number
}

export interface BookingPayment {
  id: string
  booking_id: string
  payment_type: 'deposit' | 'partial' | 'final' | 'refund'
  payment_method: PaymentMethod
  amount_cents: number
  card_fee_cents: number
  total_charged_cents: number
  stripe_payment_intent_id?: string | null
  stripe_session_id?: string | null
  recorded_by: 'system' | 'admin'
  notes?: string | null
  paid_at: string
  created_at: string
}

export interface BookingModification {
  id: string
  booking_id: string
  modified_by: 'customer' | 'admin' | 'system'
  change_summary: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

export type PaymentMethod = 'card' | 'cash' | 'venmo' | 'zelle'

export type PartyBookingStatus =
  | 'awaiting_deposit'
  | 'pending_review'
  | 'approved'
  | 'modifications_locked'
  | 'paid_in_full'
  | 'completed'
  | 'cancelled'

export interface PartyQuote {
  themeName: string
  themeId?: string
  guestCount: number
  isMiniParty: boolean
  lineItems: BookingLineItem[]
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  childName?: string
  childAge?: string
  preferredDate?: string
  preferredTime?: string
  notes?: string
  paymentMethod?: PaymentMethod
}

export interface PartySummary {
  lineItems: BookingLineItem[]
  guestCount: number
  subtotalCents: number
  depositCents: number
  balanceDueCents: number
  cardFeeCents: number
  totalWithFeeCents: number
}

export interface PartyBooking {
  id: string
  booking_ref: string
  status: PartyBookingStatus
  event_type: string
  party_date: string
  party_time: string
  package_type: string
  guest_count_approx: number
  child_name?: string | null
  child_age?: number | null
  contact_name: string
  contact_email: string
  contact_phone?: string | null
  /** Deposit in CENTS (25000 = $250), despite the column name lacking a _cents suffix. */
  deposit_amount: number
  total_cents: number
  balance_due_cents: number
  card_fee_rate: number
  payment_method_preference: PaymentMethod
  approved_at?: string | null
  approved_by?: string | null
  paid_in_full_at?: string | null
  modification_cutoff?: string | null
  guest_count_cutoff?: string | null
  quote_snapshot: Record<string, unknown> | null
  admin_notes?: string | null
  notes?: string | null
  party_tags?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  line_items?: BookingLineItem[]
  payments?: BookingPayment[]
  modifications?: BookingModification[]
}

export interface PaymentMethodOption {
  value: PaymentMethod
  label: string
  description: string
  feeLabel?: string
}

export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { value: 'card', label: 'Credit / Debit Card', description: 'Pay securely online via Stripe', feeLabel: '+3% processing fee' },
  { value: 'venmo', label: 'Venmo', description: 'Send payment via Venmo', },
  { value: 'zelle', label: 'Zelle', description: 'Send payment via Zelle', },
  { value: 'cash', label: 'Cash', description: 'Pay in person', },
]
