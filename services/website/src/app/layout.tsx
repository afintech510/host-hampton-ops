import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CrispChat from '@/components/CrispChat'

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
    'Host Hampton is a boutique celebration studio in Speonk, NY offering themed birthday parties, permanent jewelry, room rentals, and workshops. Reserve your date with a $99 deposit.',
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
  ],
  priceRange: '$$',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 pt-20">{children}</main>
        <div className="h-40 bg-gradient-to-b from-transparent to-[#BCCDEB]" aria-hidden="true" />
        <Footer />
        <CrispChat />
      </body>
    </html>
  )
}
