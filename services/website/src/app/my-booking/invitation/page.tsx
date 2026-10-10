import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { NOINDEX } from '@/lib/seo'
import { InviteCanvas } from '@/components/evites/InviteCanvas'
import HostInvitation from '@/components/evites/HostInvitation'
import { fontFaceCss } from '@/lib/evites/fontFaces'
import { computeSizes } from '@/lib/evites/layout'
import { composeHostView, readHostRows } from '@/lib/evites/hostView'
import { templateFor } from '@/lib/evites/templates'

/**
 * The host's page for their own invitation (spec §7.2): the invite, its state, the Share panel,
 * the Customize form and the RSVP list.
 *
 *   - Portal-gated. No valid `hh_portal` session sends the visitor through sign-in and BACK here
 *     (`/my-booking/login?next=/my-booking/invitation`; the allow-list is `lib/portalRedirect.ts`).
 *   - `force-dynamic`: it reads the cookie, and the state depends on the clock and the ledger.
 *   - The booking is the one the cookie names; there is no parameter to change that.
 *   - A page view never creates an evite and records nothing.
 *   - The canvas is drawn HERE, on the server, from the same facts the picture is drawn from
 *     (so the preview and the picture cannot disagree about a character), then handed to the
 *     client island, which owns polling, the form and sharing. A save calls `router.refresh()`
 *     to redraw it.
 *   - It carries no slug, so it keeps normal GA and the site chrome; the Meta Pixel is blocked on
 *     this path by `lib/evites/chrome.ts` (spec §7.1).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Your invitation | Host Hampton',
  robots: NOINDEX,
}

const FRAME_CSS = `
${fontFaceCss()}
.hh-hi-frame{position:relative;width:100%;aspect-ratio:1085/1530;overflow:hidden;border-radius:10px;container-type:inline-size;background:#1b0630}
.hh-hi-canvas{position:absolute;left:0;top:0;width:1085px;height:1530px;transform-origin:0 0;transform:scale(.27)}
@supports (width:1cqw) and (transform:scale(tan(atan2(1px,1px)))){.hh-hi-canvas{transform:scale(tan(atan2(100cqw,1085px)))}}
`

function Message({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-2xl text-[#1a2744]">{title}</h1>
        <p className="mt-3 text-sm text-gray-600">{body}</p>
        <p className="mt-6">
          <a href={action?.href ?? '/my-booking'} className="text-[#1a2744] underline">
            {action?.label ?? 'Back to my booking'}
          </a>
        </p>
      </div>
    </div>
  )
}

export default async function HostInvitationPage() {
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  const bookingRef = getPortalBookingRef(cookieHeader, portalSigningSecret())
  if (!bookingRef) redirect('/my-booking/login?next=/my-booking/invitation')

  const now = new Date()
  const read = await readHostRows(getSupabase(), bookingRef, now)

  if (read.kind === 'none') {
    return <Message title="Your invitation isn't available" body="If that looks wrong, get in touch and we'll sort it out." />
  }
  if (read.kind === 'unavailable') {
    // Not "you have no invitation" and not a guessed state: a read failed.
    console.error(`my-booking/invitation: ${read.reason}`)
    return <Message title="We couldn't load your invitation" body="Please try again in a moment." action={{ href: '/my-booking/invitation', label: 'Try again' }} />
  }

  const { payload, facts } = composeHostView(read.loaded, process.env.SUPABASE_URL, now)
  const template = templateFor(facts.templateSlug)
  const sizes = computeSizes(template, facts)

  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: FRAME_CSS }} />
      <HostInvitation
        initial={payload}
        preview={
          <div className="hh-hi-frame">
            <div className="hh-hi-canvas">
              <InviteCanvas template={template} facts={facts} sizes={sizes} mode="web" />
            </div>
          </div>
        }
      />
    </div>
  )
}
