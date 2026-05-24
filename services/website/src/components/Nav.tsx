'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Menu, X, Phone, MessageCircle } from 'lucide-react'
import CartButton from '@/components/CartButton'

const navLinks = [
  { href: '/party-packages',    label: 'Party Packages' },
  { href: '/party-room-rental', label: 'Room Rental' },
  { href: '/mobile-party',      label: 'Mobile Party' },
  { href: '/events',            label: 'Events' },
]

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  // Hide on party planner routes — they have their own section nav
  if (pathname === '/party-planner' || pathname === '/party-builder') return null

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <header
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        open
          ? 'bg-white py-2'
          : scrolled
            ? 'bg-white/60 backdrop-blur-xl border-b border-white/30 shadow-sm py-2'
            : 'bg-transparent py-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0">
          <Image
            src="/images/host-hampton-logo_300.png"
            alt="Host Hampton"
            width={140}
            height={48}
            className="object-contain"
            priority
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map(l => {
            const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
            return (
              <Link
                key={l.href}
                href={l.href}
                className="relative text-sm font-bold tracking-wide text-hampton-navy hover:text-hampton-navy/70 transition-colors group py-1"
              >
                {l.label}
                <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-[3px] rounded-full bg-hampton-mauve transition-all duration-300 ${isActive ? 'w-full opacity-100' : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-40'}`} />
              </Link>
            )
          })}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-4">
          <CartButton />
          <div className="flex items-center gap-1.5 text-sm font-bold text-hampton-navy/70">
            <a
              href="tel:6319989325"
              className="flex items-center gap-1 hover:text-hampton-navy transition-colors"
            >
              <Phone size={14} />
              <span>Call</span>
            </a>
            <span className="text-hampton-navy/30">|</span>
            <a
              href="sms:6319989325"
              className="flex items-center gap-1 hover:text-hampton-navy transition-colors"
            >
              <MessageCircle size={14} />
              <span>Text</span>
            </a>
          </div>
          <Link
            href="/book"
            className="bg-hampton-navy text-white px-6 py-2.5 rounded-full text-sm font-bold tracking-wide hover:bg-hampton-navy/90 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5"
          >
            Book Now
          </Link>
        </div>

        {/* Mobile: cart + hamburger */}
        <div className="md:hidden flex items-center gap-2">
          <CartButton />
          <button
            className="text-hampton-navy p-2"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile full-screen menu */}
      <div
        className={`fixed inset-0 z-[60] bg-white backdrop-blur-xl transition-all duration-300 ease-in-out md:hidden flex flex-col justify-center items-center ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          className="absolute top-5 right-5 text-hampton-navy p-2"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X size={28} />
        </button>

        <div className="flex flex-col items-center space-y-8 text-center px-4 w-full max-w-sm">
          {navLinks.map(l => {
            const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="relative text-2xl font-serif text-hampton-navy hover:text-hampton-navy/70 transition-colors w-full pb-4 border-b border-hampton-mauve/30"
              >
                {l.label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-12 rounded-full bg-hampton-mauve" />
                )}
              </Link>
            )
          })}

          <div className="pt-8 flex flex-col items-center gap-6 w-full">
            <div className="flex items-center gap-3 text-xl text-hampton-navy/70">
              <a href="tel:6319989325" className="flex items-center gap-1.5 hover:text-hampton-navy transition-colors">
                <Phone size={20} />
                Call
              </a>
              <span className="text-hampton-navy/30">|</span>
              <a href="sms:6319989325" className="flex items-center gap-1.5 hover:text-hampton-navy transition-colors">
                <MessageCircle size={20} />
                Text
              </a>
            </div>
            <Link
              href="/book"
              onClick={() => setOpen(false)}
              className="w-full bg-hampton-navy text-white px-8 py-4 rounded-full text-lg font-bold tracking-wide shadow-lg text-center"
            >
              Book Now
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
