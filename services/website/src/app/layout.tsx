import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import BenchworksAttribution from '@/components/BenchworksAttribution'
import CrispChat from '@/components/CrispChat'
import GoogleAnalytics from '@/components/GoogleAnalytics'
import MetaPixel from '@/components/MetaPixel'
import AttributionCapture from '@/components/AttributionCapture'
import { CartProvider } from '@/context/CartContext'
import CartDrawer from '@/components/CartDrawer'
import ChristmasMarketBanner from '@/components/ChristmasMarketBanner'
// Mounted PERMANENTLY, which is the fix for `SpecialEventBanner` — it had a
// kill switch and no start date, so it had to be added and then deleted by hand
// and then sat imported-by-nothing for three months. This one's whole life is
// the promo window in lib/appointmentEvents.ts.
import AppointmentBanner from '@/components/AppointmentBanner'
import { RATING } from '@/lib/reviews'
import { OG_DEFAULTS, OG_DEFAULT_IMAGE, SITE_URL, BUSINESS_ID, ORGANIZATION_ID, TITLE_SUFFIX } from '@/lib/seo'
import { TENANT } from '@/tenant'

// Every business fact below comes from the tenant config; the marketing COPY
// (title, description, knowsAbout, areaServed) is Host Hampton's own wording.
const POSTAL_ADDRESS = {
  '@type': 'PostalAddress',
  streetAddress: TENANT.location.street,
  addressLocality: TENANT.location.town,
  addressRegion: TENANT.location.region,
  postalCode: TENANT.location.postalCode,
  addressCountry: TENANT.location.country,
}
const SAME_AS = [TENANT.social.instagram, TENANT.social.facebook, TENANT.social.googleBusiness]

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: './' },
  title: {
    default: 'Host Hampton | Birthday Party Venue in Speonk, NY',
    template: `%s${TITLE_SUFFIX}`,
  },
  description:
    'Private party studio in Speonk, NY. Fully hosted themed kids birthday parties at our Hamptons studio, or mobile craft parties at your home across Long Island.',
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
  openGraph: OG_DEFAULTS,
  // Declared here rather than per page: nothing under this layout sets its own
  // `twitter` block, so the root value is what every page gets. Without it Next
  // emits a bare `twitter:card=summary` — the small square card — and no image,
  // which is what every X/Slack/LinkedIn unfurl of this site looked like.
  twitter: {
    card: 'summary_large_image',
    title: 'Host Hampton | Birthday Party Venue in Speonk, NY',
    description:
      'Upscale themed birthday parties at our private Hamptons studio in Speonk, NY — or mobile at your home across Long Island.',
    images: [OG_DEFAULT_IMAGE.url],
  },
}

// The Google Business Profile (TENANT.social.googleBusiness, confirmed by the
// owner 2026-09-05) is a `sameAs` signal so Google reconciles the site and the
// GBP listing as one entity.

const localBusinessSchema = {
  '@context': 'https://schema.org',
  // Multi-typed on purpose. It IS an event venue and it IS a local business,
  // and every page-level `Service.provider` refers to it as a LocalBusiness by
  // @id — so the node has to answer to both names or the reference dangles.
  //
  // ORDER MATTERS, and it is not cosmetic. Google reports a multi-typed node
  // under its FIRST @type: with 'EventVenue' first, Search Console read the
  // whole node as an EventVenue and failed `aggregateRating` with
  // "Invalid object type for field <parent_node>" — EventVenue descends from
  // Place, not from LocalBusiness, and review snippets are only supported on
  // the latter. That killed the star rating on EVERY page, because this schema
  // is in the root layout, and it had been failing since at least the 2026-09-08
  // crawl. LocalBusiness goes first so the rating attaches to a type Google
  // accepts; EventVenue stays in the array so the semantic claim and the @id
  // references both survive.
  '@type': ['LocalBusiness', 'EventVenue'],
  '@id': BUSINESS_ID,
  name: TENANT.business.name,
  // The one-sentence identity an answer engine repeats. It used to omit mobile
  // parties — the page most ChatGPT referrals land on — and say "workshops".
  description:
    'Private, fully hosted kids and teen party studio in Speonk, NY. Themed and craft birthday parties at our Hamptons studio, mobile craft parties at your home across Long Island, studio rental for showers and events, and adult activations like a trucker hat bar and permanent jewelry.',
  knowsAbout: [
    'Kids birthday parties', 'Mobile craft parties', 'Slime parties', 'Spa parties', 'Glow parties',
    'Arts and crafts parties', 'Toddler and first birthday parties', 'Sweet 16 parties',
    'Baby and bridal showers', 'Trucker hat bar', 'Permanent jewelry', 'Party room rental',
    'Fantasy football draft parties',
  ],
  url: SITE_URL,
  telephone: TENANT.contact.phoneE164,
  email: TENANT.contact.email,
  address: POSTAL_ADDRESS,
  geo: {
    '@type': 'GeoCoordinates',
    latitude: TENANT.location.latitude,
    longitude: TENANT.location.longitude,
  },
  openingHoursSpecification: [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday', 'Sunday'], opens: '10:00', closes: '20:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '12:00', closes: '19:00' },
  ],
  sameAs: SAME_AS,
  priceRange: '$$',
  image: `${SITE_URL}/images/og-default.png`,
  parentOrganization: { '@id': ORGANIZATION_ID },
  // Half the business is mobile (a service-area business), which EventVenue has
  // no semantics for — so declare the served areas explicitly.
  //
  // This was a 20-mile GeoCircle, which badly understated reality: the owner
  // confirmed (2026-09-05) there is NO travel fee anywhere and that parties and
  // events have run from Manhattan to Montauk. A named-area list is both accurate
  // and better for local SEO than a radius that stops at Riverhead.
  areaServed: [
    { '@type': 'AdministrativeArea', name: 'Suffolk County, NY' },
    { '@type': 'AdministrativeArea', name: 'Nassau County, NY' },
    { '@type': 'AdministrativeArea', name: 'Long Island, NY' },
    { '@type': 'City', name: 'New York City, NY' },
  ],
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
  '@id': ORGANIZATION_ID,
  name: TENANT.business.name,
  url: SITE_URL,
  logo: `${SITE_URL}${TENANT.brand.logo}`,
  telephone: TENANT.contact.phoneE164,
  email: TENANT.contact.email,
  address: POSTAL_ADDRESS,
  sameAs: SAME_AS,
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
          {/*
            INSIDE main, not before it. `Nav` is `fixed top-0` and therefore out
            of flow, so the first in-flow element starts at y=0 — underneath the
            nav. `main`'s `pt-20` is what clears it, which means anything that
            needs to be visible has to live after that padding, not ahead of it.
            The banner then sticks at `top-20` as the page scrolls.
            Turns itself off after the market; nothing to unwind in January.
          */}
          <main className="flex-1 pt-20">
            <ChristmasMarketBanner />
            <AppointmentBanner />
            {children}
          </main>
          {/* The fade-out spacer above the footer lives INSIDE <Footer />, so it goes with it on /i/. */}
          <Footer />
          <BenchworksAttribution />
          <CartDrawer />
        </CartProvider>
        <GoogleAnalytics />
        <MetaPixel />
        <AttributionCapture />
        <CrispChat />
      </body>
    </html>
  )
}
