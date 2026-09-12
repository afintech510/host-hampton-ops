import type { Metadata } from 'next'
import { getCraftParty } from '@/lib/craftParties'
import { OG_DEFAULTS } from '@/lib/seo'

const BASE = 'https://www.hosthampton.com'

/** Build the Next Metadata for a craft landing page from its data entry. */
export function buildCraftMetadata(slug: string): Metadata {
  const data = getCraftParty(slug)
  if (!data) return {}
  const url = `${BASE}/${data.slug}`
  return {
    // `absolute` bypasses the root layout's '%s | Host Hampton' template —
    // metaTitle already carries the '| Host Hampton' suffix where wanted.
    title: { absolute: data.metaTitle },
    description: data.metaDescription,
    keywords: data.keywords,
    alternates: { canonical: url },
    openGraph: {
      ...OG_DEFAULTS,
      title: data.metaTitle,
      description: data.metaDescription,
      url,
      // The hero image if there is one, otherwise OG_DEFAULTS' card. The old
      // `images: undefined` cleared the key rather than falling back, so a
      // craft page with no hero shared as a blank card.
      ...(data.heroImages[0] ? { images: [{ url: data.heroImages[0] }] } : {}),
    },
  }
}
