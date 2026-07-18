import type { Metadata } from 'next'
import CoraStand from './CoraStand'

export const metadata: Metadata = {
  title: "Cora's Sunshine Stand — Lemonade, Cookies, Bracelets & Keychains",
  description:
    "Cora's Sunshine Stand! Fresh lemonade, homemade cookies, rubberband bracelets, and pony bead keychains. Save the date — August 16th in our driveway. Come say hi!",
  openGraph: {
    title: "Cora's Sunshine Stand",
    description: 'Lemonade · Cookies · Bracelets · Keychains — August 16th. Are you coming?',
  },
}

export default function CoraPage() {
  return <CoraStand />
}
