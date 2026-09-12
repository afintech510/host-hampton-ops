import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import { type Locale, localeUrl, parseLocaleSlug } from '@/lib/content/slug'
import { ContentRenderBody } from '@/components/content/ContentRenderBody'
import { BUSINESS_ID, ORGANIZATION_ID, OG_DEFAULTS, carriesPublishedPrice } from '@/lib/seo'

/**
 * DB-driven content renderer for PUBLISHED website_content rows.
 *
 * This is a catch-all ([...slug]) so it only ever runs for paths that don't
 * match a real static route — Next.js gives static segments precedence over a
 * dynamic catch-all, so existing pages (/book, /permanent-jewelry, …) are
 * never shadowed. A reserved-slug blocklist is defence-in-depth on top of that.
 *
 * Bilingual: an `/es/<slug>` path prefix selects the Spanish (locale='es') row;
 * everything else is English. English keeps its bare slug (/party-room-rental);
 * Spanish lives at /es/party-room-rental. hreflang alternates link the two.
 *
 * Only status='published' rows render; drafts / pending / archived 404. The
 * consent hard gate lives at the DB layer, so a child-media row can't reach
 * 'published' without signed releases in the first place.
 */

export const dynamic = 'force-dynamic'

interface StructuredSection {
  heading?: string
  html?: string
  text?: string
}
interface FaqItem {
  q: string
  a: string
}
interface StructuredContent {
  sections?: StructuredSection[]
  faq?: FaqItem[]
  jsonLd?: unknown
}

interface ContentRow {
  slug: string
  title: string
  meta_description: string | null
  body_html: string | null
  featured_image: string | null
  keywords: string[] | null
  page_type: string
  structured: StructuredContent | null
  published_at: string | null
  updated_at: string
}

interface Published {
  row: ContentRow
  locale: Locale
  slug: string
}

async function fetchPublished(rawSlug: string): Promise<Published | null> {
  const { locale, slug, reserved } = parseLocaleSlug(rawSlug)
  if (reserved || !slug) return null

  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('website_content')
      .select('slug, title, meta_description, body_html, featured_image, keywords, page_type, structured, published_at, updated_at')
      .eq('slug', slug)
      .eq('locale', locale)
      .eq('status', 'published')
      .maybeSingle()
    if (!data) return null
    return { row: data as ContentRow, locale, slug }
  } catch {
    return null
  }
}

/** Which locales are published for a base slug — drives hreflang alternates. */
async function publishedLocales(slug: string): Promise<Set<Locale>> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('website_content')
      .select('locale')
      .eq('slug', slug)
      .eq('status', 'published')
    return new Set((data || []).map((r: { locale: Locale }) => r.locale))
  } catch {
    return new Set()
  }
}

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const rawSlug = (params.slug || []).join('/')
  const published = await fetchPublished(rawSlug)
  if (!published) return {}
  const { row, locale, slug } = published

  const url = localeUrl(slug, locale)

  // hreflang alternates: one entry per locale actually published for this slug.
  const locales = await publishedLocales(slug)
  const languages: Record<string, string> = {}
  if (locales.has('en')) languages['en'] = localeUrl(slug, 'en')
  if (locales.has('es')) languages['es'] = localeUrl(slug, 'es')
  if (locales.has('en')) languages['x-default'] = localeUrl(slug, 'en')

  return {
    // `absolute` bypasses the root layout's '%s | Host Hampton' template —
    // row.title already ends with '| Host Hampton' (the LLM prompt asks for
    // that suffix), so applying the template again would double it up.
    title: { absolute: row.title },
    description: row.meta_description || undefined,
    keywords: row.keywords || undefined,
    alternates: {
      canonical: url,
      languages: Object.keys(languages).length ? languages : undefined,
    },
    openGraph: {
      ...OG_DEFAULTS,
      title: row.title,
      description: row.meta_description || undefined,
      url,
      // Spread order matters: only override OG_DEFAULTS' card when the row
      // really has a featured image. `images: undefined` would clear it.
      ...(row.featured_image ? { images: [{ url: row.featured_image }] } : {}),
      locale: locale === 'es' ? 'es_US' : 'en_US',
    },
  }
}

/** Build the JSON-LD graph: explicit structured.jsonLd wins; else derive. */
function buildJsonLd(url: string, row: ContentRow): unknown[] {
  const graph: unknown[] = []

  const explicit = row.structured?.jsonLd
  if (explicit) {
    // `structured` is written by the COPY agent and the weekly town-drafts
    // cron, and this block is rendered verbatim into the page. A price in it is
    // a price we PUBLISH to Google with no human in the path — and on a town
    // page it would be a mobile price, which is Adam's alone (plan §15). Drop
    // it and fall through to the derived graph, which prices nothing, and say
    // so: rule 10, a guardrail that stops something must report that it did.
    if (carriesPublishedPrice(explicit)) {
      console.warn(
        `[seo] dropped DB-authored JSON-LD for /${row.slug}: it carries a price ` +
        `(offers/price/priceCurrency). Structured-data prices must come from code, ` +
        `not from website_content. Falling back to the derived graph.`,
      )
    } else {
      return Array.isArray(explicit) ? explicit : [explicit]
    }
  }

  // Anchor to the business node the root layout already publishes, by @id,
  // instead of describing a second business at the same address (rule 11).
  graph.push({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url,
    name: row.title,
    isPartOf: { '@id': ORGANIZATION_ID },
    about: { '@id': BUSINESS_ID },
    ...(row.published_at ? { datePublished: row.published_at } : {}),
    dateModified: row.updated_at,
  })

  const faq = row.structured?.faq
  if (faq && faq.length > 0) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }

  return graph
}

export default async function DynamicContentPage({ params }: { params: { slug: string[] } }) {
  const rawSlug = (params.slug || []).join('/')
  const published = await fetchPublished(rawSlug)
  if (!published) notFound()
  const { row, locale, slug } = published

  const jsonLd = buildJsonLd(localeUrl(slug, locale), row)

  return (
    // `lang` on the content wrapper, because the root layout hardcodes
    // <html lang="en"> and App Router gives a page no way to change it. The
    // Spanish rows were shipping Spanish prose declared as English while their
    // own hreflang alternates said `es` — the page contradicted its own
    // metadata. This is not the <html> attribute, but it is the one a crawler
    // and a screen reader read for the text that actually differs.
    <main className="mx-auto max-w-3xl px-5 py-12" lang={locale}>
      {jsonLd.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Escape < to keep the JSON from breaking out of the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }}
        />
      ))}

      <ContentRenderBody row={row} locale={locale} />
    </main>
  )
}
