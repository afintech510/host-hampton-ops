'use client'

import Image from 'next/image'
import { useState } from 'react'
import { CheckCircle, Loader2 } from 'lucide-react'
import { trackContact } from '@/lib/gtag'

// ─── Data ─────────────────────────────────────────────────────────────────────

interface ProductColor { name: string; hex: string }
interface Product {
  name: string
  itemNo: string
  description: string
  colors: ProductColor[]
  totalColors: number
  priceHint: string
}

const products: Product[] = [
  {
    name: 'Classic Tote Bag',
    itemNo: 'Item #5023C · CB Station',
    description:
      'Spacious canvas tote with zip closure and 18" canvas handles. Made from natural cotton canvas — biodegradable and renewable. Rated 4.9/5 with over 1,600 reviews.',
    colors: [
      { name: 'Navy', hex: '#1a2744' },
      { name: 'Natural', hex: '#E8D8B0' },
      { name: 'Powder Pink', hex: '#F4A7B9' },
      { name: 'Teal', hex: '#006D6D' },
      { name: 'Mustard', hex: '#C9920A' },
    ],
    totalColors: 22,
    priceHint: 'Contact us for pricing',
  },
  {
    name: 'Canvas Makeup Bag',
    itemNo: 'Item #6047C · CB Station',
    description:
      'Compact canvas zip pouch with easy-grip finger loop. Natural cotton canvas, perfect for a personalized party favor or thoughtful gift. Rated 4.9/5 with over 1,600 reviews.',
    colors: [
      { name: 'Navy', hex: '#1a2744' },
      { name: 'Natural', hex: '#E8D8B0' },
      { name: 'Hot Pink', hex: '#E8416A' },
      { name: 'Teal', hex: '#006D6D' },
      { name: 'Emerald', hex: '#2D6A4F' },
    ],
    totalColors: 19,
    priceHint: 'Contact us for pricing',
  },
]

const steps = [
  {
    n: '01',
    title: 'Choose Your Bag + Color',
    desc: 'Pick the Classic Tote or Canvas Makeup Bag. Tell us your preferred color from our palette of 19–22 options.',
  },
  {
    n: '02',
    title: 'Describe Your Patch Design',
    desc: 'Share your idea — a name, quote, logo, or artwork. We send a digital proof before production so you can approve it.',
  },
  {
    n: '03',
    title: 'Pick Up or Local Delivery',
    desc: 'Collect your finished bags in-studio at 295 Montauk Hwy, Suite 7, Speonk — or arrange local delivery.',
  },
]

const galleryImages = [
  { src: '/images/gallery/product-pouches-1.webp', alt: 'Custom personalized canvas pouches with patch designs' },
  { src: '/images/gallery/product-pouches-2.webp', alt: 'Canvas bags arranged as party favors' },
  { src: null, alt: 'Custom canvas bag with iron-on patch — photo coming soon' },
]

const faqs = [
  {
    q: 'How long does it take to receive my bags?',
    a: 'Typical turnaround is 5–7 business days after you approve your design proof. Rush orders may be available — just ask when you inquire.',
  },
  {
    q: 'Is there a minimum order quantity?',
    a: 'No minimum! We happily take single-bag orders as well as large group orders. Pricing scales with quantity.',
  },
  {
    q: 'What kinds of patch designs can I request?',
    a: "Almost anything — custom names, quotes, monograms, logos, or themed artwork. We'll send you a digital proof before production so you can approve the design before we apply it.",
  },
  {
    q: 'How do I care for my canvas bag?',
    a: 'Hand wash or gentle machine cycle in cold water. Lay flat to dry. Avoid ironing directly over the patch — iron around it or use a pressing cloth to protect the design.',
  },
]

// ─── Form default state ────────────────────────────────────────────────────────

const defaultForm = {
  name: '',
  email: '',
  phone: '',
  product: '',
  colorPreference: '',
  quantity: '1',
  patchIdea: '',
  occasion: '',
  marketingConsent: false,
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CanvasBagsPage() {
  const [form, setForm] = useState(defaultForm)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/canvas-bag-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      trackContact('canvas_bag_inquiry')
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="font-sans text-hampton-navy">

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="py-24 md:py-32 bg-hampton-ivory text-center px-4">
        <p className="section-subheading">Custom Merchandise · Iron-On Patches · CB Station</p>
        <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl leading-tight mb-6">
          Canvas Totes &amp;<br className="hidden sm:block" /> Makeup Bags
        </h1>
        <p className="text-hampton-navy/70 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
          Personalized with custom iron-on patch designs. Perfect for bachelorette parties,
          birthday gifts, school groups, and more. No minimum order.
        </p>
        <a
          href="#order-form"
          className="inline-block bg-hampton-navy text-white font-bold px-10 py-4 rounded-full
                     text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:-translate-y-0.5"
        >
          Design Your Bag
        </a>
      </section>

      {/* ── Product Cards ─────────────────────────────────────────────────────── */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Our Products</p>
          <h2 className="section-heading">Two Styles, Endless Colors</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {products.map(p => (
            <div key={p.name} className="card flex flex-col">
              <div className="relative aspect-[4/3] bg-hampton-mauve/10 flex items-center justify-center">
                <span className="text-hampton-navy/30 text-sm font-sans">Photo coming soon</span>
              </div>
              <div className="p-6 flex flex-col flex-1">
                <p className="text-hampton-mauve text-xs font-semibold uppercase tracking-widest mb-1">{p.itemNo}</p>
                <h3 className="font-serif text-2xl text-hampton-navy mb-3">{p.name}</h3>
                <p className="text-hampton-navy/65 text-sm leading-relaxed mb-5">{p.description}</p>
                <div className="flex flex-wrap items-center gap-1.5 mb-5">
                  {p.colors.map(c => (
                    <span
                      key={c.hex}
                      title={c.name}
                      style={{ background: c.hex }}
                      className="w-5 h-5 rounded-full border border-white shadow-sm inline-block"
                    />
                  ))}
                  <span className="text-hampton-navy/40 text-xs ml-1">+{p.totalColors - p.colors.length} more</span>
                </div>
                <p className="text-hampton-pink text-sm font-semibold mb-5">{p.priceHint}</p>
                <a href="#order-form" className="btn-secondary text-sm text-center mt-auto">
                  Order This Bag →
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────────────────────────── */}
      <section className="py-16 bg-hampton-pink/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Simple Process</p>
            <h2 className="section-heading">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-10">
            {steps.map(s => (
              <div key={s.n} className="text-center">
                <div className="font-serif text-5xl text-hampton-pink/50 mb-3">{s.n}</div>
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{s.title}</h3>
                <p className="text-hampton-navy/60 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Gallery ───────────────────────────────────────────────────────────── */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Inspiration</p>
          <h2 className="section-heading">See What&apos;s Possible</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {galleryImages.map((g, i) => (
            <div key={i} className="relative aspect-square rounded-2xl overflow-hidden bg-hampton-mauve/10">
              {g.src ? (
                <Image
                  src={g.src}
                  alt={g.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-hampton-navy/30 text-sm text-center px-4">Photo coming soon</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Order Form ────────────────────────────────────────────────────────── */}
      <section id="order-form" className="py-20 bg-hampton-ivory px-4 scroll-mt-24">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <p className="section-subheading">Place Your Order</p>
            <h2 className="section-heading">Ready to Design Yours?</h2>
            <p className="text-hampton-navy/65 text-base max-w-lg mx-auto">
              Tell us what you&apos;re envisioning and we&apos;ll be in touch within 24 hours.
            </p>
          </div>

          {submitted ? (
            <div className="bg-white rounded-2xl border border-hampton-mauve/25 p-10 text-center shadow-sm">
              <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
              <h3 className="font-serif text-2xl text-hampton-navy mb-2">We Got It!</h3>
              <p className="text-hampton-navy/65 text-base mb-4">
                Thanks for your inquiry. We&apos;ll be in touch within 24 hours to confirm details and pricing.
              </p>
              <p className="text-hampton-navy/50 text-sm">
                Questions? Call or text{' '}
                <a href="tel:6319989325" className="text-hampton-navy font-semibold hover:underline">
                  (631) 998-9325
                </a>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-hampton-mauve/25 p-8 shadow-sm space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="form-label">Name <span className="text-red-400">*</span></label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="Your full name"
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Email <span className="text-red-400">*</span></label>
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    placeholder="you@example.com"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="form-label">Phone</label>
                  <input
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="(631) 555-0100"
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Product <span className="text-red-400">*</span></label>
                  <select name="product" value={form.product} onChange={handleChange} required className="form-input">
                    <option value="">Select a product…</option>
                    <option value="Classic Tote Bag">Classic Tote Bag</option>
                    <option value="Canvas Makeup Bag">Canvas Makeup Bag</option>
                    <option value="Both / Mixed Order">Both / Mixed Order</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">Preferred Color(s)</label>
                <input
                  name="colorPreference"
                  value={form.colorPreference}
                  onChange={handleChange}
                  placeholder="e.g. Navy, Natural, Powder Pink…"
                  className="form-input"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="form-label">Quantity <span className="text-red-400">*</span></label>
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={handleChange}
                    required
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Occasion</label>
                  <input
                    name="occasion"
                    value={form.occasion}
                    onChange={handleChange}
                    placeholder="e.g. bachelorette, birthday, school"
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Patch Design Idea <span className="text-red-400">*</span></label>
                <textarea
                  name="patchIdea"
                  value={form.patchIdea}
                  onChange={handleChange}
                  required
                  rows={4}
                  placeholder="Describe your design — custom name, quote, logo, artwork, or theme. The more detail the better!"
                  className="form-input resize-none"
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="marketingConsent"
                  checked={form.marketingConsent}
                  onChange={handleChange}
                  className="mt-0.5 accent-hampton-navy"
                />
                <span className="text-hampton-navy/60 text-xs leading-relaxed">
                  I agree to receive occasional updates and promotions from Host Hampton via email or SMS.
                  You can unsubscribe at any time.
                </span>
              </label>

              {error && (
                <p className="text-red-500 text-sm font-medium">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send My Inquiry'
                )}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────────── */}
      <section className="py-16 bg-hampton-pink/10 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <p className="section-subheading">Questions</p>
            <h2 className="section-heading">Frequently Asked</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-hampton-mauve/25 overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-6 py-4 flex items-center justify-between
                             font-semibold text-hampton-navy text-sm hover:bg-hampton-ivory transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {f.q}
                  <span className="text-hampton-mauve text-xl ml-4 shrink-0 leading-none">
                    {openFaq === i ? '−' : '+'}
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-hampton-navy/65 text-sm leading-relaxed">
                    {f.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
