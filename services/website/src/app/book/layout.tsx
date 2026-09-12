import type { Metadata } from 'next'
import { OG_DEFAULTS, SITE_URL } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Book Your Party — Reserve Your Date',
  description:
    'Reserve your date at Host Hampton in Speonk, NY. Build a customizable birthday party, shower or celebration and hold it with a $250 deposit.',
  keywords: [
    'book birthday party Speonk',
    'reserve party venue Long Island',
    'party booking Hamptons',
    'kids party venue East End',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Book Your Party at Host Hampton',
    description:
      'Build your party and reserve your date online. Fully customizable packages, secured with a $250 deposit.',
    url: `${SITE_URL}/book`,
  },
}

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children
}
