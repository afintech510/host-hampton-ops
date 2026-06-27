import Image from 'next/image'
import { Calendar, Clock, Sparkles } from 'lucide-react'

const SERVICES = [
  { name: 'Hair Tinsel', price: '$15' },
  { name: 'Hair Wraps', price: '$35', note: 'add charms +$3' },
  { name: 'Hair Glitter', price: '$5' },
  { name: 'Glitter Freckles', price: '$10' },
]

const CAL_LINK = 'https://cal.com/hosthampton/summer-hair'

export default function SpecialEventBanner() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-2">
      <div className="relative overflow-hidden rounded-2xl border-2 border-[#1e3a5f]/20 bg-white shadow-md">
        {/* Decorative top stripe */}
        <div className="h-1.5 bg-gradient-to-r from-[#B22234] via-white to-[#3C3B6E]" />

        <div className="flex flex-col md:flex-row">
          {/* Flyer image */}
          <div className="relative w-full md:w-[340px] shrink-0">
            <Image
              src="/images/summer-hair-flyer.png"
              alt="Summer Hair Event — July 3rd at Host Hampton"
              width={340}
              height={440}
              className="w-full h-full object-cover"
              priority
            />
          </div>

          {/* Content */}
          <div className="flex-1 p-6 sm:p-8 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#B22234]" />
              <span className="text-xs font-semibold uppercase tracking-widest text-[#B22234]">
                Special Event
              </span>
            </div>

            <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3 tracking-tight">
              Summer Hair
            </h2>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-hampton-navy/80 mb-5">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                Friday, July 3
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                9:00 AM – 3:00 PM
              </span>
            </div>

            {/* Services grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6">
              {SERVICES.map((s) => (
                <div key={s.name} className="flex items-baseline justify-between border-b border-hampton-mauve/15 pb-1.5">
                  <span className="text-sm font-medium text-hampton-navy">{s.name}</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-[#3C3B6E]">{s.price}</span>
                    {s.note && (
                      <span className="block text-[10px] text-hampton-mauve">{s.note}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-hampton-mauve mb-5 italic">
              All services paid in person — by appointment only
            </p>

            <a
              href={CAL_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center justify-center gap-2 w-fit px-8 py-3.5"
            >
              Book Your Appointment
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
