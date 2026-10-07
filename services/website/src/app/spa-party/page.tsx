import CraftPartyLanding from '@/components/CraftPartyLanding'
import { getCraftParty } from '@/lib/craftParties'
import { buildCraftMetadata } from '@/lib/craftMeta'

const SLUG = 'spa-party'

// Per-request: ThemePartyPriceBlock reads the live Spa Party price. Prerendered
// at build (no Supabase credentials there) the read fails into its try/catch,
// Next never sees the dynamic fetch, and the page was cached for a YEAR with
// no studio price card — x-nextjs-cache: HIT, s-maxage=31536000 (2026-10-06).
export const dynamic = 'force-dynamic'
export const metadata = buildCraftMetadata(SLUG)

export default function Page() {
  return <CraftPartyLanding data={getCraftParty(SLUG)!} />
}
