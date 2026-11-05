import { notFound } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { loadPhotoSet } from '@/lib/photoSets'
import { TENANT } from '@/tenant'

export const dynamic = 'force-dynamic'

/**
 * `/p/<token>` — the photos an admin chose to send one family.
 *
 * Public by capability, like `/i/<slug>` and `/review/<token>`: the signed token
 * is the whole credential. A wrong, expired, tampered or emptied link is the
 * SAME 404 (a page that told "expired" from "never existed" would confirm a
 * guessed code was real). Read-only, and the photos are re-read through
 * `findPhotos` on every view, so a photo withdrawn after the link went out stops
 * being shown here too. The page is noindex via its layout.
 *
 * Plain `<img>`, not next/image: the photos live in our storage bucket and the
 * curated gallery, the sizes are already web-sized, and a set is at most twelve.
 */
export default async function PhotoSetPage({ params }: { params: { token: string } }) {
  const { token } = params
  const set = await loadPhotoSet(getSupabase(), token)
  if (set.kind === 'unavailable') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">We couldn&apos;t load these photos just now</h1>
        <p className="mt-2 text-sm opacity-70">Please try the link again in a minute.</p>
      </div>
    )
  }
  if (set.kind === 'gone') notFound()

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-center">Photos from {TENANT.business.name}</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {set.photos.map(p => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.id}
            src={p.url}
            alt={p.alt || 'Party photo'}
            width={p.w ?? undefined}
            height={p.h ?? undefined}
            loading="lazy"
            className="w-full h-auto rounded-xl border"
          />
        ))}
      </div>
    </div>
  )
}
