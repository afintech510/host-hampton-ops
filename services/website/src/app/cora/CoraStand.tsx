'use client'

import React, { useState } from 'react'
import { Heart, Calendar, MapPin, PartyPopper } from 'lucide-react'

// Custom SVG for the Kawaii Sun (matching the logo)
const KawaiiSun = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Rays */}
    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
      <line key={angle} x1="50" y1="12" x2="50" y2="4" transform={`rotate(${angle} 50 50)`} stroke="#FAD058" strokeWidth="4" strokeLinecap="round" />
    ))}
    {/* Sun Body */}
    <circle cx="50" cy="50" r="28" fill="#FAD058" />
    {/* Eyes */}
    <circle cx="40" cy="48" r="3" fill="#4A3F35" />
    <circle cx="60" cy="48" r="3" fill="#4A3F35" />
    {/* Cheeks */}
    <circle cx="32" cy="52" r="4.5" fill="#F4A7B9" opacity="0.9" />
    <circle cx="68" cy="52" r="4.5" fill="#F4A7B9" opacity="0.9" />
    {/* Smile */}
    <path d="M 43 55 Q 50 63 57 55" stroke="#4A3F35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </svg>
)

// Custom SVG for the Lemons and Leaves (matching the logo)
const LemonGraphic = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
    {/* Leaves */}
    <path d="M20,60 Q10,35 35,30 Q45,55 20,60" fill="#88C08A" />
    <path d="M35,30 Q55,10 70,35 Q45,55 35,30" fill="#88C08A" />
    <path d="M10,85 Q-5,100 20,105 Q35,85 10,85" fill="#88C08A" />
    {/* Whole Lemon */}
    <ellipse cx="40" cy="70" rx="22" ry="28" fill="#FAD058" transform="rotate(-30 40 70)" />
    {/* Slice Lemon */}
    <circle cx="68" cy="78" r="20" fill="#FAD058" />
    <circle cx="68" cy="78" r="17" fill="#FFFDF9" />
    <circle cx="68" cy="78" r="14" fill="#FAD058" />
    {/* Slice Lines */}
    <line x1="68" y1="64" x2="68" y2="92" stroke="#FFFDF9" strokeWidth="2" />
    <line x1="54" y1="78" x2="82" y2="78" stroke="#FFFDF9" strokeWidth="2" />
    <line x1="58" y1="68" x2="78" y2="88" stroke="#FFFDF9" strokeWidth="2" />
    <line x1="58" y1="88" x2="78" y2="68" stroke="#FFFDF9" strokeWidth="2" />
    {/* Flower */}
    <circle cx="35" cy="48" r="4" fill="#FFFDF9" />
    <circle cx="43" cy="48" r="4" fill="#FFFDF9" />
    <circle cx="39" cy="44" r="4" fill="#FFFDF9" />
    <circle cx="39" cy="52" r="4" fill="#FFFDF9" />
    <circle cx="39" cy="48" r="2" fill="#FAD058" />
  </svg>
)

type ItemId = 'lemonade' | 'bracelets' | 'cookies' | 'keychains'

export default function CoraStand() {
  const [likes, setLikes] = useState<Record<ItemId, number>>({
    lemonade: 0,
    bracelets: 0,
    cookies: 0,
    keychains: 0,
  })
  const [rsvpStatus, setRsvpStatus] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)

  const handleLike = (id: ItemId) => {
    setLikes((prev) => ({ ...prev, [id]: prev[id] + 1 }))
  }

  const handleRsvp = () => {
    setRsvpStatus(true)
    setShowConfetti(true)
    setTimeout(() => setShowConfetti(false), 3000)
  }

  // Color palette derived directly from the logo
  const colors = {
    pink: '#DE6B82',
    yellow: '#FAD058',
    orange: '#F2A668',
    mint: '#84C6B9',
    text: '#4A3F35',
    bg: '#FCFAF5',
    ribbon: '#FADAE0',
  }

  const items: {
    id: ItemId
    name: string
    desc: string
    emoji: string
    bg: string
    text: string
    btn: string
  }[] = [
    {
      id: 'lemonade', name: 'Fresh Lemonade', desc: 'Ice cold, sweet, sour, and squeezed with lots of love!',
      emoji: '🍋', bg: 'bg-[#FFF8E1]', text: 'text-[#D4A017]', btn: 'bg-[#FAD058] hover:bg-[#E5BE4A]',
    },
    {
      id: 'bracelets', name: 'Rubberband Bracelets', desc: 'Colorful and custom made! Pick your favorite colors.',
      emoji: '🌈', bg: 'bg-[#FCECF0]', text: 'text-[#C5536A]', btn: 'bg-[#DE6B82] hover:bg-[#C95C72]',
    },
    {
      id: 'cookies', name: "Momma's Cookies", desc: 'The absolute best chocolate chip cookies baked fresh.',
      emoji: '🍪', bg: 'bg-[#FDF3EB]', text: 'text-[#D07F43]', btn: 'bg-[#F2A668] hover:bg-[#DC935A]',
    },
    {
      id: 'keychains', name: 'Pony Bead Keychains', desc: 'Fun shapes and bright beads to decorate your backpack!',
      emoji: '🦄', bg: 'bg-[#EDF7F5]', text: 'text-[#5B9C8F]', btn: 'bg-[#84C6B9] hover:bg-[#72B0A4]',
    },
  ]

  return (
    <div className="min-h-screen font-sans selection:bg-[#FAD058] selection:text-[#4A3F35]" style={{ backgroundColor: colors.bg }}>
      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@600&display=swap');` }} />

      {/* HEADER SECTION - Recreating the Logo Badge */}
      <header className="pt-12 pb-16 px-4 flex flex-col items-center text-center overflow-hidden">

        <div className="relative w-full max-w-2xl mx-auto flex flex-col items-center justify-center p-8 md:p-12">

          {/* Decorative Pink Circle Border (mimicking the logo frame) */}
          <div className="absolute inset-0 border-[6px] rounded-full opacity-30 scale-95 md:scale-100 hidden md:block" style={{ borderColor: colors.pink }}></div>
          <div className="absolute inset-4 border-[4px] rounded-[3rem] opacity-30 md:hidden" style={{ borderColor: colors.pink }}></div>

          {/* Top Sun Graphic */}
          <div className="relative z-10 w-32 h-32 md:w-40 md:h-40 -mt-6 mb-2 ml-16 md:ml-24 animate-[bounce_4s_infinite]">
            <KawaiiSun className="w-full h-full drop-shadow-sm" />
          </div>

          {/* "Cora's" */}
          <h1 className="relative z-10 text-7xl md:text-9xl pb-4 -mt-2 -rotate-3 transform" style={{ color: colors.pink, fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}>
            Cora&apos;s
          </h1>

          {/* "SUNSHINE" */}
          <div className="relative z-10 flex space-x-1 md:space-x-2 text-4xl md:text-6xl font-black tracking-wide mb-3">
            <span style={{ color: colors.yellow }}>S</span>
            <span style={{ color: colors.orange }}>U</span>
            <span style={{ color: colors.mint }}>N</span>
            <span style={{ color: colors.pink }}>S</span>
            <span style={{ color: colors.yellow }}>H</span>
            <span style={{ color: colors.mint }}>I</span>
            <span style={{ color: colors.yellow }}>N</span>
            <span style={{ color: colors.mint }}>E</span>
          </div>

          {/* "STAND" */}
          <div className="relative z-10 flex items-center gap-3 text-2xl md:text-4xl font-bold tracking-widest mb-8" style={{ color: colors.pink }}>
            <Heart fill={colors.pink} className="w-5 md:w-6 h-5 md:h-6" />
            STAND
            <Heart fill={colors.pink} className="w-5 md:w-6 h-5 md:h-6" />
          </div>

          {/* Ribbon Banner */}
          <div className="relative z-10 px-8 py-3 rounded-full shadow-sm" style={{ backgroundColor: colors.ribbon }}>
            <p className="text-sm md:text-base font-bold tracking-widest uppercase" style={{ color: colors.text }}>
              Lemonade &bull; Cookies <br className="md:hidden" />
              <span className="hidden md:inline"> &bull; </span>
              Bracelets &bull; Key Chains
            </p>
          </div>

          {/* Bottom Left Lemons */}
          <div className="absolute bottom-0 left-0 w-32 h-32 md:w-48 md:h-48 -ml-4 md:-ml-8 mb-4 md:-mb-8 hidden sm:block">
            <LemonGraphic className="w-full h-full drop-shadow-md" />
          </div>

        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-16 relative z-20">

        {/* EVENT DETAILS CARD */}
        <section className="bg-white rounded-[2rem] shadow-sm p-6 md:p-8 mb-16 border-2 transform hover:scale-[1.01] transition-transform duration-300 mx-auto max-w-3xl" style={{ borderColor: colors.ribbon }}>
          <div className="flex flex-col md:flex-row items-center justify-around gap-6 text-center md:text-left">
            <div>
              <h2 className="text-2xl font-bold mb-1 flex items-center justify-center md:justify-start gap-2" style={{ color: colors.text }}>
                <Calendar style={{ color: colors.pink }} /> Save the Date!
              </h2>
              <p className="text-2xl font-black" style={{ color: colors.pink }}>August 16th</p>
            </div>

            <div className="hidden md:block w-1 h-16 rounded-full" style={{ backgroundColor: colors.ribbon }}></div>

            <div>
              <h2 className="text-2xl font-bold mb-1 flex items-center justify-center md:justify-start gap-2" style={{ color: colors.text }}>
                <MapPin style={{ color: colors.mint }} /> Location
              </h2>
              <p className="text-xl font-black" style={{ color: colors.mint }}>Our Driveway</p>
            </div>
          </div>
        </section>

        {/* MENU SHOWCASE */}
        <section className="mb-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black mb-2" style={{ color: colors.text }}>
              What&apos;s For Sale?
            </h2>
            <p className="text-lg font-medium opacity-70" style={{ color: colors.text }}>
              Take a sneak peek at what Cora is getting ready for you!
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {items.map((item) => (
              <div
                key={item.id}
                className={`${item.bg} rounded-[2rem] p-6 md:p-8 flex flex-col items-center text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1`}
              >
                <div className="text-6xl mb-4 transform hover:scale-110 transition-transform duration-200 cursor-default">
                  {item.emoji}
                </div>
                <h3 className={`text-2xl font-black ${item.text} mb-3`}>
                  {item.name}
                </h3>
                <p className={`${item.text} opacity-80 font-semibold mb-6 flex-grow`}>
                  {item.desc}
                </p>

                {/* Interactive "Like" Button */}
                <button
                  onClick={() => handleLike(item.id)}
                  className={`${item.btn} text-white font-bold py-3 px-6 rounded-full flex items-center gap-2 transform active:scale-95 transition-all w-full justify-center group`}
                >
                  <Heart size={20} className={`group-active:text-white ${likes[item.id] > 0 ? 'fill-current' : ''}`} />
                  {likes[item.id] === 0 ? 'I want this!' : `${likes[item.id]} people love this!`}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* INTERACTIVE RSVP SECTION */}
        <section className="rounded-[2.5rem] p-8 md:p-12 text-center max-w-3xl mx-auto relative overflow-hidden" style={{ backgroundColor: colors.ribbon }}>
          {showConfetti && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-5xl">
              🎉🎊✨🎈🎉🎊✨
            </div>
          )}

          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black mb-3" style={{ color: colors.pink }}>
              Are you coming?
            </h2>
            <p className="text-lg font-semibold mb-8 max-w-md mx-auto" style={{ color: colors.text }}>
              Let Cora know you&apos;re excited! Click the button below so she can get ready for a fun day.
            </p>

            {!rsvpStatus ? (
              <button
                onClick={handleRsvp}
                className="text-white text-xl font-bold py-4 px-10 rounded-full shadow-md hover:shadow-lg transform hover:-translate-y-1 active:scale-95 transition-all flex items-center gap-3 mx-auto"
                style={{ backgroundColor: colors.mint }}
              >
                <PartyPopper /> Count me in!
              </button>
            ) : (
              <div className="bg-white/80 rounded-2xl p-6 animate-pulse">
                <h3 className="text-2xl font-black mb-1" style={{ color: colors.pink }}>Yay! Thank you! 💖</h3>
                <p className="font-bold" style={{ color: colors.text }}>Cora can&apos;t wait to see you on August 16th!</p>
              </div>
            )}
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="py-6 text-center opacity-60">
        <p className="font-bold flex items-center justify-center gap-2 text-sm" style={{ color: colors.text }}>
          Made with <Heart size={14} fill={colors.pink} stroke={colors.pink} /> for Cora
        </p>
      </footer>
    </div>
  )
}
