'use client'

import FundraiserOrdersDashboard, { type FundraiserDashboardTheme } from '@/components/FundraiserOrdersDashboard'
import { FUNDRAISER_TEAMS } from '@/lib/fundraiserTeams'

/**
 * The RSE merch order book — the same screen as CM Cheer's and the Sharks',
 * filtered to `team = 'rse'` and dressed in royal blue and yellow.
 *
 * All three dashboards sign in with the same `CM_CHEER_PASSWORD`, so `teamSlug`
 * is what separates the fundraisers' customer lists, CSVs and totals.
 */
const RSE_THEME: FundraiserDashboardTheme = {
  teamSlug: 'rse',
  title: 'RSE Merch Orders',
  subtitle: 'Fundraiser Management',
  logoSrc: '/images/rse-logo-rooster.webp',
  logoAlt: 'RSE',
  tokenKey: 'rse_merch_token',
  csvPrefix: 'rse-merch',
  personLabel: FUNDRAISER_TEAMS['rse'].personLabel,
  collectsTeacher: FUNDRAISER_TEAMS['rse'].collectsTeacher,
  organizerShort: 'PTO',
  // Paper entry is wired to the ESM catalogue only (`/api/cm-cheer-orders` POST).
  paperEntry: false,
  headerBar: 'bg-rseBlue',
  headerBorder: 'border-rseYellow',
  accentText: 'text-rseBlue',
  accentBorder: 'border-rseYellow',
  accentSolid: 'bg-rseBlue hover:bg-rseInk',
  focusRing: 'focus:ring-1 focus:ring-rseYellow focus:border-rseBlue',
  darkButton: 'bg-rseInk hover:bg-rseBlue',
}

export default function RSEMerchOrdersPage() {
  return <FundraiserOrdersDashboard theme={RSE_THEME} />
}
