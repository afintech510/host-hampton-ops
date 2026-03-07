'use client'

import { ShoppingCart } from 'lucide-react'
import { useCart } from '@/context/CartContext'

export default function CartButton() {
  const { itemCount, setIsOpen } = useCart()

  if (itemCount === 0) return null

  return (
    <button
      onClick={() => setIsOpen(true)}
      className="relative text-hampton-navy hover:text-hampton-navy/70 transition-colors p-1"
      aria-label={`Cart (${itemCount} items)`}
    >
      <ShoppingCart className="w-5 h-5" />
      <span className="absolute -top-1 -right-1 bg-hampton-pink text-hampton-navy text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
        {itemCount}
      </span>
    </button>
  )
}
