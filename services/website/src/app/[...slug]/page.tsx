import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import { type Locale, localeUrl, parseLocaleSlug } from '@/lib/content/slug'

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
    title: row.title,
    description: row.meta_description || undefined,
    keywords: row.keywords || undefined,
    alternates: {
      canonical: url,
      languages: Object.keys(languages).length ? languages : undefined,
    },
    openGraph: {
      title: row.title,
      description: row.meta_description || undefined,
      url,
      images: row.featured_image ? [{ url: row.featured_image }] : undefined,
      type: 'website',
      locale: locale === 'es' ? 'es_US' : 'en_US',
    },
  }
}

/** Build the JSON-LD graph: explicit structured.jsonLd wins; else derive. */
function buildJsonLd(url: string, row: ContentRow): unknown[] {
  const graph: unknown[] = []

  const explicit = row.structured?.jsonLd
  if (explicit) {
    return Array.isArray(explicit) ? explicit : [explicit]
  }

  // LocalBusiness anchor (always useful for local SEO).
  graph.push({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Host Hampton',
    url,
    telephone: '+1-631-998-9325',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '295 Montauk Highway, Suite 7',
      addressLocality: 'Speonk',
      addressRegion: 'NY',
      postalCode: '11972',
      addressCountry: 'US',
    },
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
  const sections = row.structured?.sections || []
  const faqHeading = locale === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions'

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      {jsonLd.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Escape < to keep the JSON from breaking out of the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }}
        />
      ))}

      <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-6">{row.title}</h1>

      {row.featured_image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.featured_image} alt={row.title} className="w-full rounded-2xl mb-8" />
      )}

      {sections.length > 0 ? (
        <div className="prose prose-lg max-w-none">
          {sections.map((s, i) => (
            <section key={i} className="mb-8">
              {s.heading && <h2 className="font-serif text-2xl text-hampton-navy mb-3">{s.heading}</h2>}
              {s.html ? (
                <div dangerouslySetInnerHTML={{ __html: s.html }} />
              ) : s.text ? (
                <p className="text-gray-700 leading-relaxed whitespace-pre-line">{s.text}</p>
              ) : null}
            </section>
          ))}
        </div>
      ) : row.body_html ? (
        <div className="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: row.body_html }} />
      ) : null}

      {row.structured?.faq && row.structured.faq.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-hampton-navy mb-4">{faqHeading}</h2>
          <dl className="space-y-4">
            {row.structured.faq.map((f, i) => (
              <div key={i}>
                <dt className="font-semibold text-hampton-navy">{f.q}</dt>
                <dd className="text-gray-700 mt-1">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </main>
  )
}
