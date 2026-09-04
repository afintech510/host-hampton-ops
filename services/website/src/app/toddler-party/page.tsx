import CraftPartyLanding from '@/components/CraftPartyLanding'
import { getCraftParty } from '@/lib/craftParties'
import { buildCraftMetadata } from '@/lib/craftMeta'

const SLUG = 'toddler-party'
export const metadata = buildCraftMetadata(SLUG)

export default function Page() {
  return <CraftPartyLanding data={getCraftParty(SLUG)!} />
}
