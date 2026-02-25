export interface PricingItem {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  is_popular: boolean
  sort_order: number
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
}
