import type { Metadata } from 'next'
import { OG_DEFAULTS } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Custom Canvas Bags | Iron-On Patches',
  description:
    'Personalized canvas tote and makeup bags with custom iron-on patches. Parties, gifts and group orders — Host Hampton, Speonk NY.',
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Custom Canvas Bags | Iron-On Patches — Host Hampton',
    description:
      'Classic tote bags and canvas makeup bags customized with iron-on patches. No minimum order. Pick up in-studio or local delivery.',
  },
}

export default function CanvasBagsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
