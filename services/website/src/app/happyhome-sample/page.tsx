'use client'

import React, { useState } from 'react'
import { Phone, Mail, Sparkles, Home, Key, ShieldCheck, ChevronRight, Menu, X } from 'lucide-react'

const Logo = ({ className = "w-16 h-16" }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={`stroke-current ${className}`} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,45 50,15 80,45" />
    <line x1="32" y1="40" x2="32" y2="55" />
    <line x1="44" y1="30" x2="44" y2="75" />
    <line x1="56" y1="30" x2="56" y2="75" />
    <line x1="68" y1="40" x2="68" y2="55" />
  </svg>
)

export default function HappyHomeSample() {
  const [formStatus, setFormStatus] = useState('idle')
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormStatus('submitting')
    setTimeout(() => {
      setFormStatus('success')
    }, 1000)
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-800 font-sans selection:bg-slate-200">

      {/* Top Bar */}
      <div className="bg-slate-900 text-slate-200 py-2 px-4 md:px-6 text-xs md:text-sm flex justify-center md:justify-between items-center z-50 relative">
        <div className="hidden md:flex items-center space-x-4 tracking-wider text-xs uppercase">
          <span>Luxury Home Care</span>
          <span>&bull;</span>
          <span>Property Management</span>
        </div>
        <div className="flex items-center space-x-6 w-full md:w-auto justify-center md:justify-end px-2 md:px-0">
          <a href="tel:6318710686" className="flex items-center hover:text-white transition-colors">
            <Phone className="w-3 h-3 md:w-4 md:h-4 mr-1.5 md:mr-2" />
            631-871-0686
          </a>
          <a href="mailto:info@happyhomepw.com" className="flex items-center hover:text-white transition-colors">
            <Mail className="w-3 h-3 md:w-4 md:h-4 mr-1.5 md:mr-2" />
            <span className="hidden sm:inline">info@happyhomepw.com</span>
            <span className="sm:hidden">Email Us</span>
          </a>
        </div>
      </div>

      {/* Navigation */}
      <nav className="bg-white/95 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
          <div className="flex flex-col items-center cursor-pointer">
            <Logo className="w-10 h-10 md:w-12 md:h-12 text-slate-800" />
            <div className="mt-1 text-center">
              <h1 className="font-serif text-lg md:text-xl tracking-[0.2em] font-medium leading-none">HAPPY HOME</h1>
              <p className="text-[0.5rem] md:text-[0.55rem] tracking-[0.3em] text-slate-500 mt-1 uppercase">Beautify. Maintain.</p>
            </div>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex space-x-8 text-sm uppercase tracking-widest text-slate-600 font-medium">
            <a href="#services" className="hover:text-slate-900 transition-colors">Services</a>
            <a href="#about" className="hover:text-slate-900 transition-colors">About</a>
            <a href="#contact" className="hover:text-slate-900 transition-colors">Contact</a>
          </div>
          <a href="#contact" className="hidden md:inline-flex bg-slate-800 text-white px-6 py-2.5 text-sm uppercase tracking-wider hover:bg-slate-700 transition-colors">
            Request Consultation
          </a>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 text-slate-600 hover:text-slate-900"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav Dropdown */}
        {isMenuOpen && (
          <div className="md:hidden absolute top-full left-0 w-full bg-white border-b border-slate-200 shadow-lg py-4 px-6 flex flex-col space-y-4 text-center">
            <a href="#services" onClick={() => setIsMenuOpen(false)} className="text-sm uppercase tracking-widest text-slate-600 font-medium py-2 border-b border-slate-50">Services</a>
            <a href="#about" onClick={() => setIsMenuOpen(false)} className="text-sm uppercase tracking-widest text-slate-600 font-medium py-2 border-b border-slate-50">About</a>
            <a href="#contact" onClick={() => setIsMenuOpen(false)} className="text-sm uppercase tracking-widest text-slate-600 font-medium py-2 border-b border-slate-50">Contact</a>
            <a href="#contact" onClick={() => setIsMenuOpen(false)} className="bg-slate-800 text-white px-6 py-3 text-sm uppercase tracking-wider mt-2 inline-block">
              Request Consultation
            </a>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative h-[85vh] min-h-[500px] md:min-h-[600px] flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://st.hzcdn.com/simgs/647116b60d151dcd_14-4381/home-design.jpg"
          alt="Luxury Hamptons Home"
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement
            target.onerror = null
            target.src = "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80"
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-slate-900/40 to-slate-900/80"></div>

        <div className="relative z-10 text-center text-white px-4 md:px-6 max-w-4xl mx-auto flex flex-col items-center w-full">
          <div className="border-y border-white/40 py-8 px-4 md:px-16 backdrop-blur-sm bg-black/20 w-full sm:w-auto">
            <h2 className="font-serif text-3xl sm:text-4xl md:text-6xl font-light leading-tight mb-4">
              Elevated Care for <br className="hidden sm:block"/> Exceptional Homes.
            </h2>
            <p className="text-base sm:text-lg md:text-xl font-light tracking-wide text-slate-100 max-w-2xl mx-auto mb-6 md:mb-8">
              Premium house cleaning, bespoke concierge services, and comprehensive property management tailored to your lifestyle.
            </p>
            <a href="#contact" className="inline-flex items-center bg-white text-slate-900 px-6 md:px-8 py-3 md:py-4 text-xs md:text-sm uppercase tracking-widest font-medium hover:bg-slate-100 transition-all">
              Schedule Your Service
              <ChevronRight className="w-4 h-4 ml-2" />
            </a>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h3 className="text-sm font-bold tracking-[0.2em] text-slate-400 uppercase mb-4">What We Do</h3>
            <h2 className="font-serif text-4xl text-slate-800">Our Signature Services</h2>
            <div className="w-16 h-px bg-slate-300 mx-auto mt-6"></div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12">
            {[
              {
                icon: <Sparkles className="w-8 h-8 stroke-[1.5]" />,
                title: "Luxury House Cleaning",
                desc: "Meticulous, detailed cleaning using premium products to maintain your home's pristine condition."
              },
              {
                icon: <ShieldCheck className="w-8 h-8 stroke-[1.5]" />,
                title: "Property Management",
                desc: "Comprehensive oversight, routine maintenance, and seasonal prep so you can enjoy your home worry-free."
              },
              {
                icon: <Home className="w-8 h-8 stroke-[1.5]" />,
                title: "Home Care",
                desc: "Specialized care for high-end materials, custom finishes, and unique architectural details."
              },
              {
                icon: <Key className="w-8 h-8 stroke-[1.5]" />,
                title: "Concierge Services",
                desc: "From pre-arrival fridge stocking to managing contractors, we handle the details of luxury living."
              }
            ].map((service, idx) => (
              <div key={idx} className="group flex flex-col items-center text-center p-6 border border-transparent hover:border-slate-100 hover:bg-slate-50 transition-all duration-300">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 mb-6 group-hover:bg-slate-800 group-hover:text-white transition-colors duration-300">
                  {service.icon}
                </div>
                <h4 className="font-serif text-xl mb-3">{service.title}</h4>
                <p className="text-slate-500 text-sm leading-relaxed">{service.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lead Capture Section */}
      <section id="contact" className="py-24 bg-slate-50 border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="font-serif text-4xl mb-6">Experience the <br/> Happy Home Difference.</h2>
            <p className="text-slate-600 mb-8 leading-relaxed">
              Whether you need routine luxury cleaning, seasonal property management, or bespoke concierge assistance, our team is ready to elevate your home experience. Request a consultation today.
            </p>

            <div className="space-y-4">
              <div className="flex items-center text-slate-700">
                <Phone className="w-5 h-5 mr-4 text-slate-400" />
                <span className="text-lg">631-871-0686</span>
              </div>
              <div className="flex items-center text-slate-700">
                <Mail className="w-5 h-5 mr-4 text-slate-400" />
                <span className="text-lg">info@happyhomepw.com</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 md:p-10 shadow-xl shadow-slate-200/50">
            <h3 className="font-serif text-2xl mb-6">Request a Consultation</h3>

            {formStatus === 'success' ? (
              <div className="bg-green-50 border border-green-200 text-green-800 p-6 flex flex-col items-center text-center space-y-3">
                <Sparkles className="w-8 h-8 text-green-500" />
                <h4 className="font-medium text-lg">Message Received</h4>
                <p className="text-sm">Thank you for reaching out. A member of our concierge team will contact you shortly.</p>
                <button
                  onClick={() => setFormStatus('idle')}
                  className="mt-4 text-sm font-medium underline text-green-700 hover:text-green-900"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">First Name</label>
                    <input required type="text" className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition-all" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Last Name</label>
                    <input required type="text" className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition-all" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                  <input required type="email" className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition-all" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Service of Interest</label>
                  <select className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition-all text-slate-700">
                    <option>Luxury House Cleaning</option>
                    <option>Property Management</option>
                    <option>Concierge Services</option>
                    <option>General Inquiry</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Message</label>
                  <textarea rows={4} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition-all resize-none"></textarea>
                </div>

                <button
                  type="submit"
                  disabled={formStatus === 'submitting'}
                  className="w-full bg-slate-800 text-white font-medium tracking-widest uppercase text-sm py-4 hover:bg-slate-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {formStatus === 'submitting' ? 'Sending...' : 'Submit Request'}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-8 items-center">
          <div className="flex flex-col items-start">
            <Logo className="w-10 h-10 text-white mb-4" />
            <h4 className="font-serif text-white text-lg tracking-widest mb-1">HAPPY HOME</h4>
            <p className="text-[0.6rem] tracking-[0.2em] uppercase">Beautify. Maintain.</p>
          </div>

          <div className="text-sm space-y-2 md:text-center">
            <p>Providing exceptional care for luxury properties.</p>
            <p>&copy; {new Date().getFullYear()} Happy Home. All rights reserved.</p>
          </div>

          <div className="text-sm space-y-2 md:text-right">
            <p>Call us: <a href="tel:6318710686" className="text-white hover:underline">631-871-0686</a></p>
            <p>Visit us: <a href="https://happyhomepw.com" className="text-white hover:underline">happyhomepw.com</a></p>
          </div>
        </div>
      </footer>
    </div>
  )
}
