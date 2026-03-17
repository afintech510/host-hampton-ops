import type { Metadata } from 'next'
import GiftCardForm from './GiftCardForm'

export const metadata: Metadata = {
  title: 'Gift Cards | Host Hampton',
  description: 'Give the gift of celebration! Host Hampton gift cards are redeemable toward any party, event, or experience.',
}

export default function GiftCardsPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative py-20 text-center px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#E8C7CB]/40 via-[#A1B5C8]/30 to-[#F6F1EB]/50" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <p className="text-xs tracking-[3px] uppercase text-hampton-navy/50 mb-3">Host Hampton · Speonk, NY</p>
          <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4">Gift Cards</h1>
          <p className="text-hampton-navy/70 text-lg leading-relaxed max-w-lg mx-auto">
            Give the gift of celebration. Our gift cards can be used toward any party, event, or experience at Host Hampton.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="max-w-xl mx-auto px-4 pb-20 -mt-4">
        <GiftCardForm />
      </section>
    </div>
  )
}
