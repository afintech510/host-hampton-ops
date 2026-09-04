import type { Metadata } from 'next'
import { getCraftParty } from '@/lib/craftParties'

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
      title: data.metaTitle,
      description: data.metaDescription,
      url,
      type: 'website',
      images: data.heroImages[0] ? [{ url: data.heroImages[0] }] : undefined,
    },
  }
}
