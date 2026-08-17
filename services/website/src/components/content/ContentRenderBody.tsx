import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

/**
 * Shared render body for a website_content row — title, featured image,
 * sections/body_html, FAQ. Used by the public DB-driven renderer
 * (app/[...slug]/page.tsx, published-only) and the admin preview modal
 * (any status), so what you approve is exactly what goes live.
 *
 * Styled with the site's own design tokens (section-heading, hampton-*
 * colors, card + FAQ-accordion patterns) so LLM-drafted landing pages read
 * as native Host Hampton pages rather than generic prose — see the static
 * hand-built app/party-room-rental/page.tsx for the fuller version of this
 * visual language this intentionally stays lighter-weight than.
 */

interface StructuredSection {
  heading?: string
  html?: string
  text?: string
}
interface FaqItem {
  q: string
  a: string
}
export interface ContentRenderRow {
  title: string
  featured_image?: string | null
  body_html?: string | null
  structured?: { sections?: StructuredSection[]; faq?: FaqItem[]; gallery?: string[] } | null
}

/**
 * The `title` field doubles as the SEO <title> tag value, which the
 * generate-draft LLM prompt asks to end with "| Host Hampton" (see
 * lib/marketing/townDraft.ts). Strip that suffix for the on-page H1 — it
 * belongs in <title>, not in the visible heading.
 */
function displayTitle(title: string): string {
  return title.replace(/\s*\|\s*Host Hampton\s*$/i, '').trim()
}

export function ContentRenderBody({ row, locale = 'en' }: { row: ContentRenderRow; locale?: 'en' | 'es' }) {
  const sections = row.structured?.sections || []
  const faq = row.structured?.faq || []
  const gallery = row.structured?.gallery || []
  const faqHeading = locale === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions'
  const ctaText = locale === 'es' ? 'Consultar Disponibilidad' : 'Check Availability'
  // /book is the only booking flow with no locale variant — always point there.
  const ctaHref = '/book'

  return (
    <>
      <div className="text-center mb-12">
        <h1 className="section-heading">{displayTitle(row.title)}</h1>
      </div>

      {row.featured_image && (
        <div className="mb-10 rounded-2xl overflow-hidden shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.featured_image} alt={displayTitle(row.title)} className="w-full object-cover" />
        </div>
      )}

      {gallery.length > 0 && (
        <div className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          {gallery.map((src, i) => (
            <div key={i} className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={displayTitle(row.title)} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {sections.length > 0 ? (
        <div className="space-y-8">
          {sections.map((s, i) => (
            <section key={i} className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sm:p-8">
              {s.heading && (
                <h2 className="font-serif text-xl font-bold text-hampton-navy mb-3">{s.heading}</h2>
              )}
              {s.html ? (
                <div className="prose prose-lg max-w-none text-hampton-navy" dangerouslySetInnerHTML={{ __html: s.html }} />
              ) : s.text ? (
                <p className="text-hampton-navy/80 leading-relaxed whitespace-pre-line">{s.text}</p>
              ) : null}
            </section>
          ))}
        </div>
      ) : row.body_html ? (
        <div className="prose prose-lg max-w-none text-hampton-navy" dangerouslySetInnerHTML={{ __html: row.body_html }} />
      ) : null}

      {faq.length > 0 && (
        <section className="mt-14">
          <h2 className="section-heading text-center mb-8">{faqHeading}</h2>
          <div className="space-y-3">
            {faq.map((f, i) => (
              <details
                key={i}
                className="group rounded-xl border border-hampton-pink/20 bg-white open:border-hampton-pink/40 open:shadow-sm transition-all"
              >
                <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                  {f.q}
                  <ChevronDown size={16} className="shrink-0 text-hampton-mauve group-open:rotate-180 transition-transform" />
                </summary>
                <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <div className="mt-14 text-center">
        <Link href={ctaHref} className="btn-primary px-10 py-4 text-base inline-block">
          {ctaText}
        </Link>
      </div>
    </>
  )
}
