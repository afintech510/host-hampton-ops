import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Book Your Party — Reserve Your Date',
  description:
    'Reserve your date at Host Hampton in Speonk, NY. Build a fully customizable themed birthday party, shower, or celebration and secure your booking with a $250 deposit. Serving the Hamptons & Long Island.',
  keywords: [
    'book birthday party Speonk',
    'reserve party venue Long Island',
    'party booking Hamptons',
    'kids party venue East End',
  ],
  openGraph: {
    title: 'Book Your Party at Host Hampton',
    description:
      'Build your party and reserve your date online. Fully customizable packages, secured with a $250 deposit.',
    url: 'https://www.hosthampton.com/book',
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
  },
}

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children
}
