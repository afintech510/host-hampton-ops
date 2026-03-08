import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Custom Canvas Bags | Iron-On Patches',
  description:
    'Personalized canvas tote bags and makeup bags with custom iron-on patch designs. Perfect for parties, gifts, and group orders. Order at Host Hampton in Speonk, NY.',
  openGraph: {
    title: 'Custom Canvas Bags | Iron-On Patches — Host Hampton',
    description:
      'Classic tote bags and canvas makeup bags customized with iron-on patches. No minimum order. Pick up in-studio or local delivery.',
  },
}

export default function CanvasBagsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
