'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export interface CartItem {
  cartId: string          // unique key for this cart entry
  eventId: string
  eventTitle: string
  eventSlug: string
  sessionId: string | null
  sessionIds: string[] | null  // for multi-session
  quantity: number
  variantLabel: string | null
  unitPriceCents: number
  imageUrl: string | null
  dateDisplay: string
  timeDisplay: string
}

interface CartContextValue {
  items: CartItem[]
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  addItem: (item: Omit<CartItem, 'cartId'>) => void
  removeItem: (cartId: string) => void
  updateQuantity: (cartId: string, quantity: number) => void
  clearCart: () => void
  itemCount: number
  subtotalCents: number
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = 'hh_cart'

function generateCartId(): string {
  return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setItems(JSON.parse(saved))
    } catch { /* ignore */ }
    setLoaded(true)
  }, [])

  // Persist to localStorage on change
  useEffect(() => {
    if (!loaded) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items, loaded])

  const addItem = useCallback((item: Omit<CartItem, 'cartId'>) => {
    // Check for duplicate (same event + session + variant)
    setItems(prev => {
      const existing = prev.find(
        i => i.eventId === item.eventId
          && i.sessionId === item.sessionId
          && i.variantLabel === item.variantLabel
          && JSON.stringify(i.sessionIds) === JSON.stringify(item.sessionIds)
      )
      if (existing) {
        // Update quantity instead of duplicating
        return prev.map(i =>
          i.cartId === existing.cartId
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        )
      }
      return [...prev, { ...item, cartId: generateCartId() }]
    })
    setIsOpen(true)
  }, [])

  const removeItem = useCallback((cartId: string) => {
    setItems(prev => prev.filter(i => i.cartId !== cartId))
  }, [])

  const updateQuantity = useCallback((cartId: string, quantity: number) => {
    if (quantity < 1) return
    setItems(prev => prev.map(i => i.cartId === cartId ? { ...i, quantity } : i))
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
    setIsOpen(false)
  }, [])

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0)

  const subtotalCents = items.reduce((sum, i) => {
    if (i.sessionIds && i.sessionIds.length > 0) {
      return sum + i.unitPriceCents * i.sessionIds.length * i.quantity
    }
    return sum + i.unitPriceCents * i.quantity
  }, 0)

  return (
    <CartContext.Provider value={{
      items, isOpen, setIsOpen,
      addItem, removeItem, updateQuantity, clearCart,
      itemCount, subtotalCents,
    }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
