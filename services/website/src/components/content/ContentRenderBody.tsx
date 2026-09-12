import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { htmlToPlainText, containsMarkup, safeImageUrl } from '@/lib/content/contentSafety'

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPONENT RENDERS NO DB-AUTHORED HTML. It used to: `sections[].html`
 * and `body_html` went to `dangerouslySetInnerHTML`. `website_content` is
 * written by the COPY agent — `createTownServiceDraft` parses a model's JSON
 * reply and stored `sections` wholesale — and this component renders inside the
 * ADMIN PREVIEW MODAL, where the reader is holding an authenticated `hh_admin`
 * session. A model that answered with `"html"` instead of `"text"` therefore
 * had a path to script execution in a reviewer's session, and then on a public
 * page. Rule 5: a field is hostile because of who can WRITE it.
 *
 * Both fields are now reduced to text by `lib/content/contentSafety.ts`, and
 * image URLs go through `safeImageUrl`. No live row uses either field, and the
 * COPY prompt asks for plain text, so nothing visible changes — which is the
 * point: the hole was open and empty.
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
  /** `unknown` because this comes off a jsonb column; read defensively below. */
  structured?: unknown
}

interface Structured {
  sections: StructuredSection[]
  faq: FaqItem[]
  gallery: string[]
}

/** Read the three shapes we render out of an arbitrary jsonb value (rule 15). */
function readStructured(raw: unknown): Structured {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const sections = Array.isArray(obj.sections)
    ? obj.sections.filter((s): s is StructuredSection => !!s && typeof s === 'object' && !Array.isArray(s))
    : []
  const faq = Array.isArray(obj.faq)
    ? obj.faq.filter(
        (f): f is FaqItem =>
          !!f && typeof f === 'object' && !Array.isArray(f) &&
          typeof (f as FaqItem).q === 'string' && typeof (f as FaqItem).a === 'string',
      )
    : []
  const gallery = Array.isArray(obj.gallery) ? obj.gallery.filter((g): g is string => typeof g === 'string') : []
  return { sections, faq, gallery }
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

/** Section body: `text` if present, otherwise the prose inside a legacy `html`. */
function sectionText(s: StructuredSection): string {
  if (typeof s.text === 'string' && s.text.trim()) return s.text
  if (typeof s.html === 'string' && s.html.trim()) {
    // Rule 10: dropping markup is a thing that happened, so say it happened.
    console.warn('[content] section carried an "html" field; rendering its text only.')
    return htmlToPlainText(s.html)
  }
  return ''
}

export function ContentRenderBody({ row, locale = 'en' }: { row: ContentRenderRow; locale?: 'en' | 'es' }) {
  const { sections, faq, gallery } = readStructured(row.structured)
  const faqHeading = locale === 'es' ? 'Preguntas Frecuentes' : 'Frequently Asked Questions'
  const ctaText = locale === 'es' ? 'Consultar Disponibilidad' : 'Check Availability'
  // /book is the only booking flow with no locale variant — always point there.
  const ctaHref = '/book'

  const featured = safeImageUrl(row.featured_image)
  const galleryImages = gallery.map(safeImageUrl).filter((u): u is string => !!u)

  // Rule 10: a guardrail that stops something must say that it stopped it.
  // `safeImageUrl` returning null is INVISIBLE — the image simply is not there,
  // which looks exactly like a row that never had one. Measured in production:
  // a probe row with three hostile image URLs was correctly refused on all
  // three and the container log said nothing at all about any of them.
  //
  // It matters more now that the screen is a host ALLOWLIST and not just a
  // scheme check: the likeliest refusal is no longer an attack, it is a
  // reviewer pasting a real image URL from a host we do not serve from, and
  // then watching it quietly not appear.
  if (row.featured_image && !featured) {
    console.warn(
      `[content] featured_image refused by safeImageUrl and not rendered: ${JSON.stringify(row.featured_image)}. ` +
      `Images must be site-relative or on an allowed host (see ALLOWED_IMAGE_HOSTS).`,
    )
  }
  if (galleryImages.length < gallery.length) {
    console.warn(
      `[content] ${gallery.length - galleryImages.length} of ${gallery.length} gallery image(s) refused by ` +
      `safeImageUrl and not rendered.`,
    )
  }

  // `body_html` is only reached when there are no sections. Its name promises
  // HTML; this renderer promises text, and the column has never been populated.
  const bodyText = sections.length === 0 && row.body_html ? htmlToPlainText(row.body_html) : ''
  if (sections.length === 0 && containsMarkup(row.body_html)) {
    console.warn('[content] body_html carried markup; rendering its text only.')
  }

  return (
    <>
      <div className="text-center mb-12">
        <h1 className="section-heading">{displayTitle(row.title)}</h1>
      </div>

      {featured && (
        <div className="mb-10 rounded-2xl overflow-hidden shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={featured} alt={displayTitle(row.title)} className="w-full object-cover" />
        </div>
      )}

      {galleryImages.length > 0 && (
        <div className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          {galleryImages.map((src, i) => (
            <div key={i} className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={displayTitle(row.title)} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {sections.length > 0 ? (
        <div className="space-y-8">
          {sections.map((s, i) => {
            const text = sectionText(s)
            return (
              <section key={i} className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sm:p-8">
                {s.heading && (
                  <h2 className="font-serif text-xl font-bold text-hampton-navy mb-3">{htmlToPlainText(s.heading)}</h2>
                )}
                {text && <p className="text-hampton-navy/80 leading-relaxed whitespace-pre-line">{text}</p>}
              </section>
            )
          })}
        </div>
      ) : bodyText ? (
        <p className="text-hampton-navy/80 leading-relaxed whitespace-pre-line max-w-none">{bodyText}</p>
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
                  {htmlToPlainText(f.q)}
                  <ChevronDown size={16} className="shrink-0 text-hampton-mauve group-open:rotate-180 transition-transform" />
                </summary>
                <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{htmlToPlainText(f.a)}</p>
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
