export interface PricingItem {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  price_type: 'flat' | 'per_person' | 'per_hour'
  is_popular: boolean
  sort_order: number
  emoji: string | null
}

export interface QuoteData {
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

export interface QuoteBuilderProps {
  themes: PricingItem[]
  activities: PricingItem[]
  food: PricingItem[]
  desserts: PricingItem[]
  decor: PricingItem[]
  entertainment: PricingItem[]
  beverages: PricingItem[]
  extras: PricingItem[]
  savedQuote?: string | null
}
