import CraftPartyLanding from '@/components/CraftPartyLanding'
import { getCraftParty } from '@/lib/craftParties'
import { buildCraftMetadata } from '@/lib/craftMeta'

// Evergreen URL — reused every year. Refresh the copy/dates each season rather
// than minting a new year-stamped slug (which would reset its accumulated authority).
const SLUG = 'halloween-craft-party'
export const metadata = buildCraftMetadata(SLUG)

export default function Page() {
  return <CraftPartyLanding data={getCraftParty(SLUG)!} />
}
