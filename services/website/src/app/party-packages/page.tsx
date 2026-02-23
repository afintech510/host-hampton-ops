import type { Metadata } from 'next'
import PartyPackagesContent from './PartyPackagesContent'

export const metadata: Metadata = {
  title: 'Party Packages & Pricing | Host Hampton',
  description: 'View all themed birthday party packages at Host Hampton. Glow, Swiftie, Spa, Slime, K-Pop, Barbie and more. Starting at $800. Book your party today!',
}

export default function PartyPackages() {
  return <PartyPackagesContent />
}
