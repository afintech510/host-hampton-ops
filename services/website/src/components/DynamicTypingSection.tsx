'use client'

import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'

const DEFAULT_SERVICES = [
  "Child's Birthday Party",
  "Private Workshop",
  "Yoga Class",
  "Book Club",
  "Sweet Sixteen",
  "Girl Scouts Troop",
  "First Birthday Party",
  "Communion Celebration",
  "Baby Shower",
  "Bridal Shower",
  "Photography Shoot",
  "Glam Day",
  "Spray Tanning Session",
  "Christmas Party",

  // NEW ADDITIONS
  "Permanent Jewelry Party",
  "Trucker Hat Party Pop-Up",
  "Branding Photo Session",
  "Content Creation Day",
  "Lash Tech Pop-Up",
  "Botox & Beauty Event",
  "Moms Networking Mixer",
  "Pop-Up Boutique",
  "Vendor Market",
  "Dance Rehearsal",
  "Mommy & Me Class",
  "Toddler Playdate",
  "Teen Glow Dance Party",
  "Balloon Styling Workshop",
  "Charcuterie Class",
  "Girls Night Out",
  "Entrepreneur Mastermind",
  "Private Shopping Event",
  "Launch Party",
  "Client Appreciation Event"
]

interface DynamicTypingSectionProps {
  services?: string[]
  tagline?: string
  subtitle?: string
  ctaText?: string
  ctaHref?: string
  headingLevel?: 'h1' | 'h2'
}

export default function DynamicTypingSection({
  services = DEFAULT_SERVICES,
  tagline = 'More Than Just Birthdays',
  subtitle = "Our private Hamptons studio adapts to whatever you need. We set it up, run it, and clean it up \u2014 you just enjoy.",
  ctaText = 'INQUIRE ABOUT YOUR EVENT',
  ctaHref = '/contact-us',
  headingLevel = 'h2',
}: DynamicTypingSectionProps) {
  const Heading = headingLevel
  const [text, setText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [loopNum, setLoopNum] = useState(0)

  useEffect(() => {
    const currentService = services[loopNum % services.length]
    const typingSpeed = 80
    const deletingSpeed = 40
    const pauseTime = 2000

    let timer: ReturnType<typeof setTimeout>

    if (isDeleting) {
      timer = setTimeout(() => {
        setText(currentService.substring(0, text.length - 1))
        if (text.length === 0) {
          setIsDeleting(false)
          setLoopNum(loopNum + 1)
        }
      }, deletingSpeed)
    } else {
      timer = setTimeout(() => {
        setText(currentService.substring(0, text.length + 1))
        if (text.length === currentService.length) {
          timer = setTimeout(() => setIsDeleting(true), pauseTime)
        }
      }, typingSpeed)
    }

    return () => clearTimeout(timer)
  }, [text, isDeleting, loopNum, services])

  return (
    <section className="py-20 md:py-24 relative overflow-hidden flex justify-center items-center">
      {/* Soft glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-hampton-blue opacity-10 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Decorative header */}
        <div className="flex items-center justify-center gap-2 mb-6 text-hampton-blue font-bold tracking-widest text-sm uppercase">
          <Sparkles size={16} />
          <span>{tagline}</span>
          <Sparkles size={16} />
        </div>

        {/* Animated headline */}
        <Heading className="text-4xl md:text-5xl lg:text-7xl font-serif text-hampton-navy leading-tight">
          Let Us Host Your<br />
          <span className="inline-block min-h-[1.2em] text-transparent bg-clip-text bg-gradient-to-r from-hampton-blue to-hampton-blue/60 italic relative">
            {text || ' '}
            <span className="absolute -right-1 top-0 md:top-1 w-[2px] md:w-[3px] h-[80%] bg-hampton-blue animate-pulse" />
          </span>
        </Heading>

        {subtitle && (
          <p className="mt-8 text-lg text-hampton-navy/70 max-w-2xl mx-auto">
            {subtitle}
          </p>
        )}

        {ctaText && ctaHref && (
          <Link
            href={ctaHref}
            className="inline-block mt-10 border-2 border-[#c4975a] text-[#c4975a] px-8 py-3.5 rounded-full text-sm font-bold tracking-wide hover:bg-[#c4975a] hover:text-white transition-all shadow-sm hover:shadow-md"
          >
            {ctaText}
          </Link>
        )}
      </div>
    </section>
  )
}
