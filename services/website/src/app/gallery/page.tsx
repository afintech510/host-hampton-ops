import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Instagram } from 'lucide-react'
import GalleryGrid from '@/components/GalleryGrid'
import { GALLERY_PHOTOS } from '@/lib/gallery'
import { OG_DEFAULTS } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Party Photo Gallery — Real Kids Parties on Long Island',
  description:
    'Photos from real Host Hampton parties: themed birthday parties in our Speonk studio, at-home and backyard parties, spa parties, crafts and events across Long Island and the Hamptons.',
  keywords: [
    'kids party photos Long Island',
    'birthday party ideas Hamptons',
    'spa party setup',
    'backyard party setup Long Island',
    'party venue Speonk photos',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Host Hampton — Party Photo Gallery',
    description:
      'Real parties, real setups: studio birthday parties, at-home parties, spa parties and craft activities from Host Hampton.',
    url: 'https://www.hosthampton.com/gallery',
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
  },
}

const INSTAGRAM_URL = 'https://instagram.com/hosthampton'

// The "follow us" strip is our own photos, not a live feed: no third-party
// script, no Meta token to keep alive. Six square tiles, all linking out.
const IG_TILES = [
  'mobile-spa-glam-vanity',
  'gallery-activity-sand-art-station',
  'kpop-setup',
  'mobile-party-jelly-bag-craft',
  'gallery-studio-luau-table',
  'gallery-event-painted-pumpkins',
].map(f => GALLERY_PHOTOS.find(p => p.src === `/images/gallery/${f}.webp`)!)

export default function GalleryPage() {
  return (
    <div>
      <section className="pt-16 pb-10 text-center px-4">
        <p className="section-subheading">Real Parties</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4">Party Gallery</h1>
        <p className="text-hampton-navy text-base max-w-2xl mx-auto leading-relaxed">
          A look at parties we&apos;ve hosted: themed birthdays in our private studio in Speonk, backyard
          and at-home parties across Long Island and the Hamptons, spa parties, crafts and community
          events. Every setup here was styled by our team.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
        <GalleryGrid photos={GALLERY_PHOTOS} />
      </section>

      {/* ── Follow on Instagram ── */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <p className="section-subheading">See More</p>
          <h2 className="section-heading">Follow @hosthampton</h2>
          <p className="text-hampton-navy max-w-xl mx-auto mb-8">
            New setups, themes and behind-the-scenes from every weekend&apos;s parties.
          </p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-8">
            {IG_TILES.map(p => (
              <a
                key={p.src}
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="relative aspect-square overflow-hidden rounded-lg group"
                aria-label="Host Hampton on Instagram"
              >
                <Image src={p.src} alt={p.alt} fill sizes="(max-width: 768px) 33vw, 16vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
                <span className="absolute inset-0 bg-hampton-navy/0 group-hover:bg-hampton-navy/30 transition-colors flex items-center justify-center">
                  <Instagram size={26} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </a>
            ))}
          </div>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-hampton-navy text-white font-bold px-7 py-3.5 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-lg"
          >
            <Instagram size={18} /> Follow us on Instagram
          </a>
        </div>
      </section>

      <section className="py-16 text-center px-4">
        <h2 className="section-heading">Want a Party Like These?</h2>
        <p className="text-hampton-navy max-w-xl mx-auto mb-6">
          Pick a theme and a date, in our studio or at your home. We handle the setup, hosting and cleanup.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/book" className="bg-hampton-navy text-white font-bold px-7 py-3.5 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-lg">
            Reserve Your Date
          </Link>
          <Link href="/party-packages" className="border-2 border-hampton-navy/20 text-hampton-navy font-semibold px-7 py-3.5 rounded-full text-sm hover:border-hampton-mauve transition-all">
            Browse Party Themes
          </Link>
        </div>
      </section>
    </div>
  )
}
