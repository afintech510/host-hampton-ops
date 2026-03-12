import type { Metadata } from 'next'
import Image from 'next/image'
import { MapPin, PartyPopper, Sparkles, Heart, Truck, ChevronDown } from 'lucide-react'
import MobilePartyForm from '@/components/MobilePartyForm'

export const metadata: Metadata = {
  title: 'Mobile Party — We Bring the Party to You',
  description:
    'Host Hampton brings themed birthday parties, activities, and entertainment directly to your home, backyard, or venue. Full-service mobile party in the Hamptons & Long Island.',
  keywords: [
    'mobile party Long Island',
    'at home birthday party Hamptons',
    'mobile birthday party service NY',
    'backyard party entertainment Speonk',
    'traveling party company Long Island',
    'mobile kids party Hamptons',
  ],
  openGraph: {
    title: 'Mobile Party — We Bring the Party to You',
    description:
      'Themed birthday parties delivered to your door. Professional hosts, activities, decor & cleanup — all at your location.',
  },
}

const whyMobile = [
  { icon: Truck,       title: 'We Come to You',       desc: 'Your home, backyard, park, or venue — we set up wherever you want to celebrate.' },
  { icon: PartyPopper, title: 'Full-Service Fun',      desc: 'Activities, entertainment, and a dedicated party host. We run the show so you can relax.' },
  { icon: Sparkles,    title: 'Themed Decor Included', desc: 'We arrive with decorations, supplies, and everything needed to transform your space.' },
  { icon: Heart,       title: 'Zero Cleanup',          desc: 'When the party ends, we pack up everything. Your space goes back to normal.' },
]

const howItWorks = [
  { n: '01', title: 'Fill Out the Form',    desc: 'Tell us about your event — location, date, guest count, and which stations you love.' },
  { n: '02', title: 'Get a Custom Quote',   desc: 'We\'ll put together a tailored proposal within 24 hours. No pressure, no commitment.' },
  { n: '03', title: 'We Arrive & Set Up',   desc: 'Our team shows up early, sets everything up, and is ready to go when your guests arrive.' },
  { n: '04', title: 'Celebrate & Enjoy',    desc: 'Our host runs every station — you relax and enjoy the party. We clean up when it\'s over.' },
]

const menuItems = [
  { emoji: '✨', name: 'Hair Tinsel',              color: 'bg-yellow-50  border-yellow-200' },
  { emoji: '💫', name: 'Glitter Freckles',         color: 'bg-pink-50    border-pink-200' },
  { emoji: '👜', name: 'Canvas Bag Bar',            color: 'bg-amber-50   border-amber-200' },
  { emoji: '💅', name: 'Manicures',                 color: 'bg-rose-50    border-rose-200' },
  { emoji: '🦋', name: 'Glitter Tattoos',           color: 'bg-purple-50  border-purple-200' },
  { emoji: '🟢', name: 'Slime Station',             color: 'bg-green-50   border-green-200' },
  { emoji: '🧢', name: 'Trucker Hat Bar',           color: 'bg-sky-50     border-sky-200' },
  { emoji: '🏖️', name: 'Sand Art',                  color: 'bg-orange-50  border-orange-200' },
  { emoji: '🎨', name: 'Canvas Painting',           color: 'bg-violet-50  border-violet-200' },
  { emoji: '📸', name: 'Photobooth with Backdrop',  color: 'bg-fuchsia-50 border-fuchsia-200' },
  { emoji: '🩷', name: 'Life Size Barbie Box',      color: 'bg-pink-50    border-pink-200' },
  { emoji: '📿', name: 'Bracelet Making',           color: 'bg-teal-50    border-teal-200' },
  { emoji: '🐶', name: 'Adopt a Puppy',             color: 'bg-amber-50   border-amber-200' },
  { emoji: '🎤', name: 'KPop Backdrop',             color: 'bg-indigo-50  border-indigo-200' },
  { emoji: '🕶️', name: 'Sunglass Craft',            color: 'bg-yellow-50  border-yellow-200' },
  { emoji: '⛑️', name: 'Construction Hat Craft',    color: 'bg-orange-50  border-orange-200' },
  { emoji: '🎀', name: 'Decoden Crafts',            color: 'bg-rose-50    border-rose-200' },
  { emoji: '🐚', name: 'Seashell Decorating',       color: 'bg-cyan-50    border-cyan-200' },
]

const perfectFor = [
  '🏡 Backyard Birthday Parties',
  '🌳 Park & Outdoor Celebrations',
  '🏘 Community Center Events',
  '🏫 School & Classroom Parties',
  '🎄 Holiday Parties at Home',
  '👶 First Birthday Celebrations',
  '🏖 Beach House Gatherings',
  '🏢 Corporate Family Events',
]

const faqs = [
  {
    q: 'How far will you travel?',
    a: 'We travel throughout the Hamptons, Long Island, and surrounding areas. Parties within 20 miles of Speonk are included. Beyond that, a small travel fee may apply — just ask!',
  },
  {
    q: 'What space do I need at my location?',
    a: 'For most setups, a living room, garage, backyard, or patio works great. We need roughly 200–300 sq ft per station. We\'ll help you figure out the best layout during planning.',
  },
  {
    q: 'How many stations can we have?',
    a: 'As many as you like! Mix and match from our full menu. We\'ll suggest the right combination based on your guest count, age group, and event length.',
  },
  {
    q: 'What happens if it rains (for outdoor parties)?',
    a: 'We always have a backup plan. If your party is outdoors, we can move activities inside or set up under a covered area. We\'ll coordinate with you ahead of time.',
  },
  {
    q: 'How far in advance should I book?',
    a: 'We recommend booking 2–4 weeks in advance, especially for weekends. Reach out early and we\'ll lock in your date.',
  },
  {
    q: 'Can I mix and match stations?',
    a: 'Absolutely! That\'s the best part. Choose any combination from our menu. We\'ll bring all the supplies and staff to run every station professionally.',
  },
]

export default function MobilePartyPage() {
  return (
    <div>
      {/* ── Hero ── */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-[#c4975a] text-sm font-semibold tracking-widest uppercase mb-4">
              Mobile Party Service
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              We Bring the Party <br className="hidden sm:block" />
              <span className="italic text-hampton-blue">to You</span>
            </h1>
            <p className="text-hampton-navy/80 text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
              The same polished Host Hampton experience — delivered to your home, backyard, or any venue. Pick your stations, we handle everything else.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <a
                href="#book"
                className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl"
              >
                Get a Quote
              </a>
              <a
                href="#menu"
                className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-[#c4975a] transition-all"
              >
                View Menu
              </a>
            </div>
            <div className="flex items-center gap-2 mt-6 justify-center md:justify-start text-hampton-navy/60 text-sm">
              <MapPin size={14} />
              <span>Serving the Hamptons, Long Island & surrounding areas</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            {['/images/theme-glow.webp', '/images/gallery/outdoor-party-setup.webp', '/images/theme-spa.webp', '/images/theme-slime.webp'].map((src, i) => (
              <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 1 ? 'ring-2 ring-[#c4975a]' : ''}`}>
                <Image src={src} alt="Mobile party theme" fill className="object-cover" />
                {i === 1 && (
                  <div className="absolute inset-0 bg-hampton-navy/40 flex items-center justify-center">
                    <span className="text-white font-bold text-sm bg-[#c4975a] px-3 py-1 rounded-full">At Your Home</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Mobile ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Why Go Mobile?</p>
            <h2 className="section-heading">All the Fun — None of the Travel</h2>
            <p className="text-hampton-navy/70 max-w-xl mx-auto">
              Same Host Hampton quality. Same stress-free experience. Just at your location instead of ours.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyMobile.map(w => (
              <div key={w.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-4 text-hampton-navy">
                  <w.icon size={22} />
                </div>
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{w.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mobile Party Menu ── */}
      <section id="menu" className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="bg-hampton-navy px-8 py-6 text-center">
              <h2 className="font-serif text-3xl font-black text-white tracking-tight">MOBILE PARTY MENU</h2>
              <p className="text-hampton-ivory/60 text-sm font-semibold tracking-[0.2em] uppercase mt-1">Mix & Match Any Stations • We Bring Everything</p>
            </div>

            <div className="mx-8 mt-6 bg-hampton-blue/10 border-l-4 border-hampton-blue p-5 rounded-r-lg">
              <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1">Build Your Perfect Party</h3>
              <p className="text-xs text-hampton-navy/70 leading-relaxed font-medium">
                Choose any combination of stations from our menu below. Each station is fully staffed by our team — we bring all supplies, setup, and handle everything so you and your guests can just enjoy the fun.
              </p>
            </div>

            <div className="p-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                {menuItems.map(item => (
                  <div
                    key={item.name}
                    className={`${item.color} border rounded-2xl p-4 flex flex-col items-center text-center hover:shadow-sm transition-shadow`}
                  >
                    <span className="text-3xl mb-2" role="img" aria-label={item.name}>{item.emoji}</span>
                    <span className="font-semibold text-hampton-navy text-sm leading-tight">{item.name}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-center">
                <p className="text-[11px] font-bold text-hampton-pink bg-hampton-pink/10 inline-block px-4 py-1.5 rounded-full border border-hampton-pink/20">
                  Don't see your idea? Ask us — we love custom requests!
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Simple & Stress-Free</p>
            <h2 className="section-heading">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {howItWorks.map(s => (
              <div key={s.n} className="text-center">
                <div className="text-5xl font-serif text-[#c4975a]/30 mb-3">{s.n}</div>
                <h3 className="font-semibold text-hampton-navy text-lg mb-2">{s.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Perfect For ── */}
      <section className="py-20 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Endless Possibilities</p>
          <h2 className="section-heading">Perfect For</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {perfectFor.map(u => (
            <div key={u} className="bg-white border border-hampton-pink/20 rounded-xl px-4 py-3 text-sm text-hampton-navy font-medium text-center hover:border-[#c4975a]/40 transition-colors">
              {u}
            </div>
          ))}
        </div>
      </section>

      {/* ── Contact Form ── */}
      <section id="book" className="bg-gradient-to-r from-hampton-pink/20 to-hampton-ivory py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Let's Make It Happen</p>
            <h2 className="section-heading">Request a Mobile Party</h2>
            <p className="text-hampton-navy/70 max-w-lg mx-auto">
              Tell us about your event and we&apos;ll put together a custom quote — usually within 24 hours. No pressure, no commitment.
            </p>
          </div>
          <div className="max-w-2xl mx-auto">
            <MobilePartyForm />
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Questions?</p>
          <h2 className="section-heading">Mobile Party FAQ</h2>
        </div>
        <div className="space-y-3">
          {faqs.map(faq => (
            <details
              key={faq.q}
              className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all"
            >
              <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                {faq.q}
                <ChevronDown size={16} className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
            Ready to Party at Your Place?
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Fill out the form above or call us directly — we&apos;d love to help you plan something amazing.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#book"
              className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl"
            >
              Get Your Free Quote
            </a>
            <a
              href="tel:6319989325"
              className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-10 py-4 rounded-full text-base hover:border-[#c4975a] transition-all"
            >
              Call (631) 998-9325
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
