/**
 * The DB-driven renderer has more than one reader of the same agent-written
 * field, and a hostile row inserted straight into production Postgres found two
 * that were not screened while their neighbours were:
 *
 *   - `structured.faq` is read by `ContentRenderBody` (screened) AND by the
 *     JSON-LD graph builder (was not). The page showed "Question?" while the
 *     `FAQPage` node published a `<script>` tag as the question text.
 *   - `featured_image` is read by the `<img>` (screened with `safeImageUrl`)
 *     AND by `openGraph.images` (was not), three lines apart.
 *
 * Neither was exploitable — JSON-LD escapes `<` and `og:image` is never
 * executed — but rule 11's failure shape is a screen applied in one of two
 * places, and rule 8's is a guarantee nobody exercised. These tests are the
 * source-level tripwire; `docs/content-pipeline.md` §6 records the probe.
 */

import fs from 'fs'
import path from 'path'

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', '[...slug]', 'page.tsx'),
  'utf8',
)

describe('the catch-all renderer screens every DB-authored field it reads', () => {
  it('imports the shared screens rather than rolling its own', () => {
    expect(SRC).toMatch(/import \{[^}]*htmlToPlainText[^}]*\} from '@\/lib\/content\/contentSafety'/)
    expect(SRC).toMatch(/safeImageUrl/)
  })

  it('the FAQ reaching JSON-LD goes through htmlToPlainText', () => {
    // The two mapped fields must be the sanitised ones, not the raw row.
    expect(SRC).toMatch(/htmlToPlainText\(f\.q\)/)
    expect(SRC).toMatch(/htmlToPlainText\(f\.a\)/)
    // And the Question node must be built from the sanitised list, not from
    // `structured.faq` directly.
    expect(SRC).toMatch(/mainEntity: faqNodes\.map/)
    expect(SRC).not.toMatch(/mainEntity: faq\.map/)
  })

  it('og:image goes through safeImageUrl, not the raw column', () => {
    expect(SRC).toMatch(/const ogImage = safeImageUrl\(row\.featured_image\)/)
    expect(SRC).not.toMatch(/images: \[\{ url: row\.featured_image \}\]/)
  })

  it('the route is NOT given a route-level revalidate', () => {
    // Measured: `export const revalidate` on this catch-all leaves it
    // `ƒ (Dynamic)` anyway, because lib/supabase.ts sets cache: 'no-store'.
    // The caching is in lib/content/published.ts. If someone adds one later
    // they should read that comment first.
    expect(SRC).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(SRC).not.toMatch(/^export const revalidate/m)
  })

  it('the price screen is still applied to DB-authored JSON-LD', () => {
    expect(SRC).toMatch(/carriesPublishedPrice\(explicit\)/)
  })
})

describe('the renderer body screens its own fields', () => {
  const BODY = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'content', 'ContentRenderBody.tsx'),
    'utf8',
  )

  it('no DB-authored value reaches dangerouslySetInnerHTML', () => {
    // This component renders in the ADMIN PREVIEW MODAL as well as on the
    // public page, so a payload here executes in a reviewer's session. The
    // prop, not the word — the header comment explains why it is gone.
    expect(BODY).not.toMatch(/dangerouslySetInnerHTML\s*=/)
  })

  it('images go through safeImageUrl', () => {
    expect(BODY).toMatch(/safeImageUrl\(row\.featured_image\)/)
    expect(BODY).toMatch(/gallery\.map\(safeImageUrl\)/)
  })

  /**
   * Rule 10. A refused image is INVISIBLE — the picture is simply absent, which
   * looks exactly like a row that never had one. Measured in production: a
   * probe row whose `featured_image` and two `gallery` entries were all
   * correctly refused produced ZERO log lines about any of them, while the
   * section-html screen beside it reported itself normally.
   *
   * It matters more now that the screen is a host allowlist rather than a
   * scheme check: the likeliest refusal is a reviewer pasting a real image URL
   * from a host we do not serve from, then watching it quietly not appear.
   */
  it('a refused image is reported, not silently dropped', () => {
    expect(BODY).toMatch(/row\.featured_image && !featured/)
    expect(BODY).toMatch(/galleryImages\.length < gallery\.length/)
    // Both branches must actually say something.
    const warnings = BODY.match(/console\.warn\(/g) ?? []
    expect(warnings.length).toBeGreaterThanOrEqual(4)
  })
})
