'use client'

import FundraiserOrdersDashboard, { type FundraiserDashboardTheme } from '@/components/FundraiserOrdersDashboard'
import { FUNDRAISER_TEAMS } from '@/lib/fundraiserTeams'

/**
 * The CM Cheer order book.
 *
 * The screen itself is `components/FundraiserOrdersDashboard` — shared with the
 * ESM Sharks, because it is the same table behind the same password and keeping
 * two copies of it is how the credential check on this surface ended up wrong in
 * four places at once.
 *
 * `teamSlug` is the load-bearing field: it filters every read and scopes every
 * write to CM Cheer's own orders. Before migration 051 this page showed every
 * row in `cm_cheer_orders`, which was correct only while there was exactly one
 * fundraiser on it.
 */
const CM_CHEER_THEME: FundraiserDashboardTheme = {
  teamSlug: 'cm-cheer',
  title: 'CM Cheer Orders',
  subtitle: 'Fundraiser Management',
  logoSrc: 'https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/beace53a-cee5-46ab-88dd-8db7abc9d773/logo_CM-cheer.png',
  logoAlt: 'CM Cheer',
  tokenKey: 'cm_cheer_token',
  csvPrefix: 'cm-cheer',
  personLabel: FUNDRAISER_TEAMS['cm-cheer'].personLabel,
  organizerShort: 'Boosters',
  headerBar: 'bg-zinc-900',
  headerBorder: 'border-red-600',
  accentText: 'text-red-600',
  accentBorder: 'border-red-200',
  accentSolid: 'bg-red-600 hover:bg-red-700',
  focusRing: 'focus:ring-1 focus:ring-red-400 focus:border-red-500',
  darkButton: 'bg-zinc-900 hover:bg-zinc-700',
}

export default function CMCheerOrdersPage() {
  return <FundraiserOrdersDashboard theme={CM_CHEER_THEME} />
}
