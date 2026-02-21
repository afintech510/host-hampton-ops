import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: {
    default: 'Host Hampton | Birthday Party Venue in Speonk, NY',
    template: '%s | Host Hampton',
  },
  description:
    'Host Hampton is a boutique celebration studio in Speonk, NY offering themed birthday parties, permanent jewelry, room rentals, and workshops. Reserve your date with a $250 deposit.',
  keywords: ['birthday party venue', 'kids party Hamptons', 'permanent jewelry Long Island', 'party room rental Speonk'],
  openGraph: {
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
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
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
