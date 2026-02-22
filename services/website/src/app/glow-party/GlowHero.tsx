'use client'

import Link from 'next/link'
import { Calendar, ArrowRight, PartyPopper, Music, Zap, Star } from 'lucide-react'

export default function GlowHero() {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-[#05090d]">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 5px currentColor) drop-shadow(0 0 10px currentColor); }
          50% { filter: drop-shadow(0 0 15px currentColor) drop-shadow(0 0 25px currentColor); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }
        @keyframes neon-flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: 0.8; }
        }
        .gp-animate-glow-pulse { animation: glow-pulse 3s infinite ease-in-out; }
        .gp-animate-float { animation: float-slow 6s infinite ease-in-out; }
        .gp-animate-flicker { animation: neon-flicker 4s infinite; }
        .gp-text-glow-blue { text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff; }
        .gp-text-glow-green { text-shadow: 0 0 10px #39ff14, 0 0 20px #39ff14; }
        .gp-glass-dark {
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}} />

      {/* Perspective grid */}
      <div className="absolute inset-0 z-0 opacity-20" style={{
        backgroundImage: 'linear-gradient(#39ff14 1px, transparent 1px), linear-gradient(90deg, #39ff14 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(2)',
      }} />

      {/* Glow spheres */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-pink-600/30 blur-[100px] rounded-full animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-cyan-600/20 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />

      {/* Floating icons */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-[10%] gp-animate-float text-pink-500 opacity-40">
          <Zap size={48} className="gp-animate-glow-pulse" />
        </div>
        <div className="absolute bottom-40 right-[15%] gp-animate-float text-green-400 opacity-40" style={{ animationDelay: '2s' }}>
          <Music size={56} className="gp-animate-glow-pulse" />
        </div>
        <div className="absolute top-1/2 right-[10%] gp-animate-float text-blue-400 opacity-40" style={{ animationDelay: '4s' }}>
          <Star size={40} className="gp-animate-glow-pulse" />
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-6 py-2 rounded-full gp-glass-dark mb-8 animate-bounce">
          <PartyPopper size={18} className="text-pink-500" />
          <span className="text-pink-300 text-sm font-black uppercase tracking-widest">Ultimate Glow Bash</span>
        </div>

        {/* Headline */}
        <h1 className="text-6xl md:text-9xl font-black mb-6 tracking-tighter leading-none italic uppercase">
          <span className="block text-white gp-text-glow-blue gp-animate-flicker">LET&apos;S</span>
          <span className="block bg-gradient-to-r from-pink-500 via-purple-500 to-green-400 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(255,20,147,0.5)]">GLOW!</span>
        </h1>

        <p className="text-xl md:text-3xl text-white mb-4 font-bold tracking-tight uppercase">
          The Brightest Birthday <span className="text-green-400 gp-text-glow-green">Ever.</span>
        </p>

        <p className="text-md md:text-lg text-gray-300 mb-10 max-w-xl mx-auto font-medium leading-relaxed">
          Neon face paint, glowing dance floor, and high-energy music in our private studio in Speonk, NY. We provide everything — you just bring the birthday kid.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
          <Link
            href="/book?theme=glow"
            className="group w-full sm:w-auto px-10 py-5 rounded-2xl bg-white text-black font-black text-xl uppercase tracking-tighter transition-all duration-300 hover:scale-105 hover:bg-green-400 hover:shadow-[0_0_40px_rgba(57,255,20,0.6)] flex items-center justify-center gap-3"
          >
            <Calendar size={24} />
            Book the Glow
          </Link>
          <Link
            href="#packages"
            className="w-full sm:w-auto px-10 py-5 rounded-2xl border-2 border-pink-500 text-pink-500 font-black text-xl uppercase tracking-tighter transition-all duration-300 hover:bg-pink-500 hover:text-white hover:shadow-[0_0_30px_rgba(255,0,255,0.4)] flex items-center justify-center gap-3"
          >
            See Packages
            <ArrowRight size={24} />
          </Link>
        </div>

        {/* Feature pills */}
        <div className="mt-12 flex items-center justify-center gap-8 text-white/50 hover:text-white/90 transition-all">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Music size={16} /> DJ INCLUDED
          </div>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap size={16} /> NEON DECOR
          </div>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Star size={16} /> PRIVATE STUDIO
          </div>
        </div>
      </div>
    </section>
  )
}
