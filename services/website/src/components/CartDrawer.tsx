'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Minus, Plus, Trash2, ShoppingCart, Loader2 } from 'lucide-react'
import { useCart } from '@/context/CartContext'

function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

export default function CartDrawer() {
  const { items, isOpen, setIsOpen, removeItem, updateQuantity, clearCart, itemCount, subtotalCents } = useCart()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const drawerRef = useRef<HTMLDivElement>(null)

  // Load saved customer info
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hh_cart_customer')
      if (saved) {
        const c = JSON.parse(saved)
        if (c.name) setName(c.name)
        if (c.email) setEmail(c.email)
        if (c.phone) setPhone(c.phone)
      }
    } catch { /* ignore */ }
  }, [])

  // Save customer info on change
  useEffect(() => {
    if (name || email || phone) {
      localStorage.setItem('hh_cart_customer', JSON.stringify({ name, email, phone }))
    }
  }, [name, email, phone])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, setIsOpen])

  const isFreeCart = subtotalCents === 0
  const TAX_RATE = 0.0875
  const CC_RATE = 0.03
  const taxCents = isFreeCart ? 0 : Math.round(subtotalCents * TAX_RATE)
  const ccFeeCents = isFreeCart ? 0 : Math.round((subtotalCents + taxCents) * CC_RATE)
  const grandTotal = subtotalCents + taxCents + ccFeeCents

  async function handleCheckout() {
    if (!name || !email || !phone) {
      setError('Please fill in your name, email, and phone.')
      return
    }
    if (items.length === 0) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/cart-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => ({
            eventId: i.eventId,
            sessionId: i.sessionId,
            sessionIds: i.sessionIds,
            quantity: i.quantity,
            variantLabel: i.variantLabel,
          })),
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      // Clear cart after successful checkout redirect
      clearCart()
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hampton-pink/20">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-hampton-navy" />
            <h2 className="font-serif text-lg text-hampton-navy">Your Cart</h2>
            {itemCount > 0 && (
              <span className="bg-hampton-pink text-hampton-navy text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-hampton-navy/40 hover:text-hampton-navy transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-hampton-navy/20 mx-auto mb-3" />
              <p className="text-hampton-navy/50 text-sm">Your cart is empty</p>
              <button
                onClick={() => setIsOpen(false)}
                className="mt-4 text-hampton-navy text-sm font-medium underline underline-offset-4 hover:text-hampton-navy/70"
              >
                Browse Events
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map(item => {
                const itemTotal = item.sessionIds && item.sessionIds.length > 0
                  ? item.unitPriceCents * item.sessionIds.length * item.quantity
                  : item.unitPriceCents * item.quantity
                return (
                  <div key={item.cartId} className="bg-hampton-ivory/50 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-hampton-navy text-sm truncate">
                          {item.eventTitle}
                        </h4>
                        {item.variantLabel && (
                          <p className="text-xs text-hampton-navy/60 mt-0.5">{item.variantLabel}</p>
                        )}
                        <p className="text-xs text-hampton-navy/50 mt-0.5">
                          {item.dateDisplay}{item.timeDisplay ? ` at ${item.timeDisplay}` : ''}
                        </p>
                        {item.sessionIds && item.sessionIds.length > 1 && (
                          <p className="text-xs text-hampton-navy/50">
                            {item.sessionIds.length} sessions
                          </p>
                        )}
                        <p className="text-sm font-semibold text-hampton-navy mt-1.5">
                          {formatPrice(itemTotal)}
                        </p>
                      </div>
                      <button
                        onClick={() => removeItem(item.cartId)}
                        className="text-hampton-navy/30 hover:text-red-500 transition-colors p-1"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => updateQuantity(item.cartId, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="w-7 h-7 rounded-md border border-hampton-pink/20 flex items-center justify-center hover:bg-hampton-pink/10 transition-colors disabled:opacity-30"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium text-hampton-navy w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.cartId, item.quantity + 1)}
                        className="w-7 h-7 rounded-md border border-hampton-pink/20 flex items-center justify-center hover:bg-hampton-pink/10 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-hampton-navy/40 ml-1">qty</span>
                    </div>
                  </div>
                )
              })}

              {/* Clear cart */}
              <button
                onClick={clearCart}
                className="text-xs text-hampton-navy/40 hover:text-red-500 transition-colors underline underline-offset-2"
              >
                Clear cart
              </button>
            </div>
          )}
        </div>

        {/* Footer — checkout form + totals */}
        {items.length > 0 && (
          <div className="border-t border-hampton-pink/20 px-5 py-4 space-y-3">
            {/* Customer info */}
            <div className="space-y-2">
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Full name *" className="form-input text-sm py-2"
              />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Email *" className="form-input text-sm py-2"
              />
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="Phone *" className="form-input text-sm py-2"
              />
            </div>

            {/* Totals */}
            {!isFreeCart && (
              <div className="bg-hampton-ivory rounded-xl px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm text-hampton-navy">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-xs text-hampton-mauve">
                  <span>Sales Tax (8.75%)</span>
                  <span>{formatPrice(taxCents)}</span>
                </div>
                <div className="flex justify-between text-xs text-hampton-mauve">
                  <span>Processing Fee (3%)</span>
                  <span>{formatPrice(ccFeeCents)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-hampton-navy pt-1 border-t border-hampton-navy/10">
                  <span>Total</span>
                  <span>{formatPrice(grandTotal)}</span>
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-600 text-xs bg-red-50 p-2 rounded-lg">{error}</p>
            )}

            <button
              onClick={handleCheckout}
              disabled={loading}
              className="btn-primary w-full py-3 text-center flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading
                ? 'Processing...'
                : isFreeCart
                  ? 'RSVP — Free'
                  : `Checkout — ${formatPrice(grandTotal)}`}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
