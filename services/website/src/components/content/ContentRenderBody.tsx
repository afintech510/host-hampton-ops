/**
 * Shared render body for a website_content row — title, featured image,
 * sections/body_html, FAQ. Used by the public DB-driven renderer
 * (app/[...slug]/page.tsx, published-only) and the admin preview modal
 * (any status), so what you approve is exactly what goes live.
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
  structured?: { sections?: StructuredSection[]; faq?: FaqItem[] } | null
}

export function ContentRenderBody({ row, locale = 'en' }: { row: ContentRenderRow; locale?: 'en' | 'es' }) {
  const sections = row.structured?.sections || []
  const faq = row.structured?.faq || []
  const faqHeading = locale === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions'

  return (
    <>
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

      {faq.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-hampton-navy mb-4">{faqHeading}</h2>
          <dl className="space-y-4">
            {faq.map((f, i) => (
              <div key={i}>
                <dt className="font-semibold text-hampton-navy">{f.q}</dt>
                <dd className="text-gray-700 mt-1">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  )
}
