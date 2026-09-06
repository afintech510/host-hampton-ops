import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import BenchworksAttribution from '@/components/BenchworksAttribution'
import CrispChat from '@/components/CrispChat'
import GoogleAnalytics from '@/components/GoogleAnalytics'
import { CartProvider } from '@/context/CartContext'
import CartDrawer from '@/components/CartDrawer'
import { RATING } from '@/lib/reviews'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  metadataBase: new URL('https://www.hosthampton.com'),
  alternates: { canonical: './' },
  title: {
    default: 'Host Hampton | Birthday Party Venue in Speonk, NY',
    template: '%s | Host Hampton',
  },
  description:
    'Host Hampton is a private celebration studio in Speonk, NY. Upscale themed birthday parties with hands-on hosts — fully customizable to fit any budget. Reserve your date with a 25% deposit.',
  keywords: ['birthday party venue', 'kids party Hamptons', 'permanent jewelry Long Island', 'party room rental Speonk'],
  icons: {
    icon: [
      { url: '/images/H_icon_hh_64.png',  sizes: '64x64',   type: 'image/png' },
      { url: '/images/H_icon_hh_96.png',  sizes: '96x96',   type: 'image/png' },
      { url: '/images/H_icon_hh_128.png', sizes: '128x128', type: 'image/png' },
    ],
    apple: [
      { url: '/images/H_icon_hh_255.png', sizes: '255x255', type: 'image/png' },
      { url: '/images/H_icon_hh_375.png', sizes: '375x375', type: 'image/png' },
    ],
  },
  openGraph: {
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
    images: [{ url: '/images/og-default.png', width: 1200, height: 630, alt: 'Host Hampton — Boutique Celebration Studio in Speonk, NY' }],
  },
}

// Google Business Profile, confirmed by the owner 2026-09-05. Used as a `sameAs`
// signal so Google reconciles the site and the GBP listing as one entity.
const GBP_URL = 'https://maps.app.goo.gl/LFAKi3WzCNmcDsNV9'

const localBusinessSchema = {
  '@context': 'https://schema.org',
  '@type': 'EventVenue',
  name: 'Host Hampton',
  description: 'Boutique celebration studio offering themed birthday parties, permanent jewelry, room rentals, and workshops.',
  url: 'https://www.hosthampton.com',
  telephone: '+16319989325',
  email: 'hosthampton295@gmail.com',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '295 Montauk Highway, Suite 7',
    addressLocality: 'Speonk',
    addressRegion: 'NY',
    postalCode: '11972',
    addressCountry: 'US',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: 40.8432,
    longitude: -72.6823,
  },
  openingHoursSpecification: [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday', 'Sunday'], opens: '10:00', closes: '20:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '12:00', closes: '19:00' },
  ],
  sameAs: [
    'https://www.instagram.com/hosthampton',
    'https://www.facebook.com/hosthampton',
    GBP_URL,
  ],
  priceRange: '$$',
  // Half the business is mobile (a service-area business), which EventVenue has
  // no semantics for — declare the travel radius explicitly.
  areaServed: {
    '@type': 'GeoCircle',
    geoMidpoint: { '@type': 'GeoCoordinates', latitude: 40.8432, longitude: -72.6823 },
    geoRadius: '32000', // ~20 miles, the no-travel-fee radius; we travel further on request
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: RATING.ratingValue,
    reviewCount: RATING.reviewCount,
    bestRating: RATING.bestRating,
    worstRating: RATING.worstRating,
  },
}

// A-6: Organization anchors the brand entity (knowledge-panel consolidation) and
// links the profiles Google uses to reconcile it. Deliberately no `WebSite` /
// `SearchAction` — the sitelinks searchbox it targeted was retired in 2023.
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Host Hampton',
  url: 'https://www.hosthampton.com',
  logo: 'https://www.hosthampton.com/images/host-hampton-logo_300.png',
  telephone: '+16319989325',
  email: 'hosthampton295@gmail.com',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '295 Montauk Highway, Suite 7',
    addressLocality: 'Speonk',
    addressRegion: 'NY',
    postalCode: '11972',
    addressCountry: 'US',
  },
  sameAs: [
    'https://www.instagram.com/hosthampton',
    'https://www.facebook.com/hosthampton',
    GBP_URL,
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <CartProvider>
          <Nav />
          <main className="flex-1 pt-20">{children}</main>
          <div className="h-40 bg-gradient-to-b from-transparent to-[#BCCDEB]" aria-hidden="true" />
          <Footer />
          <BenchworksAttribution />
          <CartDrawer />
        </CartProvider>
        <GoogleAnalytics />
        <CrispChat />
      </body>
    </html>
  )
}
