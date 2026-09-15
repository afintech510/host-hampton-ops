'use client'

import FundraiserOrdersDashboard, { type FundraiserDashboardTheme } from '@/components/FundraiserOrdersDashboard'

/**
 * The ESM Sharks order book — the same screen as CM Cheer's, filtered to
 * `team = 'esm-sharks'` and dressed in navy and silver.
 *
 * Both dashboards sign in with the same `CM_CHEER_PASSWORD`, so `teamSlug` is
 * what actually separates the two fundraisers' customer lists, CSV exports and
 * "total raised" figures — not the password.
 */
const ESM_SHARKS_THEME: FundraiserDashboardTheme = {
  teamSlug: 'esm-sharks',
  title: 'ESM Sharks Orders',
  subtitle: 'Fundraiser Management',
  logoSrc: '/images/esm-sharks-logo.svg',
  logoAlt: 'ESM Sharks',
  tokenKey: 'esm_sharks_token',
  csvPrefix: 'esm-sharks',
  headerBar: 'bg-esmInk',
  headerBorder: 'border-esmSilver',
  accentText: 'text-esmNavy',
  accentBorder: 'border-esmSilver',
  accentSolid: 'bg-esmNavy hover:bg-esmInk',
  focusRing: 'focus:ring-1 focus:ring-esmSilver focus:border-esmNavy',
  darkButton: 'bg-esmInk hover:bg-esmNavy',
}

export default function ESMSharksOrdersPage() {
  return <FundraiserOrdersDashboard theme={ESM_SHARKS_THEME} />
}
