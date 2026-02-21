'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Menu, X, Phone } from 'lucide-react'

const navLinks = [
  { href: '/party-packages',    label: 'Party Packages' },
  { href: '/party-room-rental', label: 'Room Rental' },
  { href: '/permanent-jewelry', label: 'Jewelry' },
  { href: '/party-add-ons',     label: 'Add-Ons' },
  { href: '/events',            label: 'Events' },
  { href: '/contact-us',        label: 'Contact' },
]

export default function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-hampton-ivory/95 backdrop-blur border-b border-hampton-pink/30 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <Image
            src="/images/host-hampton-logo.png"
            alt="Host Hampton"
            width={40}
            height={40}
            className="object-contain"
          />
          <span className="font-serif text-hampton-navy text-lg font-bold hidden sm:block">
            Host Hampton
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-hampton-navy hover:text-hampton-mauve transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="tel:6319989325"
            className="flex items-center gap-1 text-sm text-hampton-mauve hover:text-hampton-navy transition-colors"
          >
            <Phone size={14} />
            <span>(631) 998-9325</span>
          </a>
          <Link href="/book" className="btn-primary text-xs px-5 py-2">
            Reserve Your Date
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-hampton-navy p-2"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-hampton-ivory border-t border-hampton-pink/30 px-4 py-4 space-y-3">
          {navLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block text-sm font-medium text-hampton-navy py-2 border-b border-hampton-pink/20"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/book"
            onClick={() => setOpen(false)}
            className="btn-primary block text-center mt-4"
          >
            Reserve Your Date — $250 Deposit
          </Link>
        </div>
      )}
    </header>
  )
}
