import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { type Locale, localeUrl, parseLocaleSlug } from '@/lib/content/slug'
import {
  loadPublishedIndex,
  loadPublishedRow,
  localesForSlug,
  type ContentRow,
} from '@/lib/content/published'
import { ContentRenderBody } from '@/components/content/ContentRenderBody'
import { htmlToPlainText, safeImageUrl } from '@/lib/content/contentSafety'
import { BUSINESS_ID, ORGANIZATION_ID, OG_DEFAULTS, carriesPublishedPrice } from '@/lib/seo'

/**
 * DB-driven content renderer for PUBLISHED website_content rows.
 *
 * This is a catch-all ([...slug]) so it only ever runs for paths that don't
 * match a real static route — Next.js gives static segments precedence over a
 * dynamic catch-all, so existing pages (/book, /permanent-jewelry, …) are
 * never shadowed. That precedence is also why `lib/content/slugSafety.ts`
 * refuses to publish a row whose slug collides with one of those pages: the row
 * would be `published` in the graph, listed in the sitemap, and rendered
 * nowhere.
 *
 * A reserved-slug blocklist is defence-in-depth on top of that.
 *
 * Bilingual: an `/es/<slug>` path prefix selects the Spanish (locale='es') row;
 * everything else is English. English keeps its bare slug (/party-room-rental);
 * Spanish lives at /es/party-room-rental. hreflang alternates link the two.
 *
 * Only status='published' rows render; drafts / pending / archived 404. The
 * consent hard gate lives at the DB layer, so a child-media row can't reach
 * 'published' without signed releases in the first place.
 */

/**
 * The ROUTE stays dynamic; the CACHING is in `lib/content/published.ts`.
 *
 * Phase 3C's checklist item says "ISR", and caching is right — two Supabase
 * round-trips per visitor on a landing page that changes a few times a year is
 * the wrong shape. But route-level `revalidate` is the wrong mechanism here,
 * for two reasons, and the first was MEASURED rather than assumed:
 *
 *  1. **It does not work on this route.** Swapping this line for
 *     `export const revalidate = 60` and rebuilding leaves `[...slug]` marked
 *     `ƒ (Dynamic)` in the build output, not `●`. `lib/supabase.ts` sets
 *     `cache: 'no-store'` on every Supabase fetch, and a no-store fetch opts
 *     its route out of static rendering entirely. The `revalidate` export would
 *     have been a comment.
 *  2. Even if it did work, this is a CATCH-ALL: the last route Next tries, so
 *     it answers every scanner probing `/wp-login.php`, `/.env`, `/vendor/…`.
 *     Each distinct URL would become its own on-disk ISR entry — a cache keyed
 *     by a string an attacker chooses.
 *
 * So the cache is at the data layer, where the key space is bounded by the
 * published index rather than by the request path, and it is flushed by TAG
 * when an admin publishes, so an edit is live at once instead of up to an hour
 * later. See the header comment in published.ts for the whole argument.
 */
export const dynamic = 'force-dynamic'

interface StructuredContent {
  /** `unknown[]` on purpose — this comes off a jsonb column, not a type. */
  faq?: unknown
  jsonLd?: unknown
}

/** `structured` is `unknown` off the DB; read the two shapes we render. */
function structuredOf(row: ContentRow): StructuredContent {
  const s = row.structured
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as StructuredContent) : {}
}

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const rawSlug = (params.slug || []).join('/')
  const { locale, slug, reserved } = parseLocaleSlug(rawSlug)
  if (reserved || !slug) return {}

  const found = await loadPublishedRow(slug, locale)
  // `unavailable` returns empty metadata rather than throwing a second time —
  // the page component below throws, which is what makes the response a 500.
  // Metadata on an error page is not read by anyone.
  if (found.state !== 'found') return {}
  const row = found.value

  const url = localeUrl(slug, locale)

  // hreflang alternates: one entry per locale actually published for this slug.
  // Taken from the cached index, which we have already loaded — the old code
  // issued a second Supabase query per request for exactly this.
  const index = await loadPublishedIndex()
  const locales = index.state === 'found' ? localesForSlug(index.value, slug) : new Set<Locale>()
  const languages: Record<string, string> = {}
  if (locales.has('en')) languages['en'] = localeUrl(slug, 'en')
  if (locales.has('es')) languages['es'] = localeUrl(slug, 'es')
  if (locales.has('en')) languages['x-default'] = localeUrl(slug, 'en')

  const ogImage = safeImageUrl(row.featured_image)

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
      //
      // Screened with the SAME helper the <img> uses, because it is the same
      // DB-authored value: a probe row with `featured_image` set to
      // `javascript:…` was refused by the component and published verbatim as
      // `og:image` three lines of code away. Inert in a meta tag, but a value
      // screened in one reader and not the other is a screen nobody is
      // actually applying (rule 11).
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
      locale: locale === 'es' ? 'es_US' : 'en_US',
    },
  }
}

/** Build the JSON-LD graph: explicit structured.jsonLd wins; else derive. */
function buildJsonLd(url: string, row: ContentRow): unknown[] {
  const graph: unknown[] = []
  const structured = structuredOf(row)

  const explicit = structured.jsonLd
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

  // The FAQ has TWO readers — this graph and `ContentRenderBody` — and only
  // one of them used to screen it. A hostile row inserted straight into
  // Postgres proved it: the page showed a clean "Question?" while the
  // `FAQPage` node published `<script>window…</script>` as
  // the question TEXT. Escaped, so inert, and never a way out of the script
  // tag — but it is agent-written data going to Google under our name, and a
  // field screened in one reader and not the other is rule 11's failure shape.
  // Same `htmlToPlainText` the visible page uses, so the two cannot drift.
  const faq: unknown[] = Array.isArray(structured.faq) ? structured.faq : []
  const faqNodes = faq
    .filter((f): f is { q: string; a: string } => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return false
      const item = f as { q?: unknown; a?: unknown }
      return typeof item.q === 'string' && typeof item.a === 'string'
    })
    .map(f => ({ q: htmlToPlainText(f.q), a: htmlToPlainText(f.a) }))
    // A Question with an empty acceptedAnswer is invalid structured data —
    // drop it rather than publish an empty one (rule 15).
    .filter(f => f.q && f.a)

  if (faqNodes.length > 0) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqNodes.map(f => ({
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
  const { locale, slug, reserved } = parseLocaleSlug(rawSlug)
  if (reserved || !slug) notFound()

  const found = await loadPublishedRow(slug, locale)

  // Rule 12 — three outcomes, not two. `absent` is a 404 (this URL is gone, and
  // telling Google so is correct). `unavailable` must NOT be: a Supabase blip
  // that 404s every published page tells Google the content was deleted, and
  // the previous `catch { return null }` did exactly that. Throwing makes it a
  // 500, which Google retries.
  if (found.state === 'unavailable') {
    throw new Error(`website_content read failed for ${locale}:${slug} — ${found.reason}`)
  }
  if (found.state === 'absent') notFound()

  const row = found.value
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
