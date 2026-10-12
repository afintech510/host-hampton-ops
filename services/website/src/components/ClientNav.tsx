/**
 * The strip that lets a customer move between their own management pages —
 * My Booking, the invoice, the invitation — without hunting for the text
 * message that got them there.
 *
 * Plain anchors, on purpose. The invoice link in particular must never be
 * prefetched: opening `/plan/<ref>/summary` ISSUES an invoice number on first
 * render (lib/invoiceNumber.ts), so a `<Link>` that prefetches would burn one
 * for every visitor who only glanced at the strip.
 *
 * `ref_` is optional: without it there is no invoice entry, which is how a page
 * that does not know the booking reference yet (the pay page, before its fetch
 * lands) avoids offering a link it cannot build.
 */
export type ClientNavPage = 'booking' | 'invoice' | 'invitation' | 'pay' | 'planner'

const ITEM =
  'inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors'
const IDLE = 'border-[#1a2744]/20 bg-white text-[#1a2744] hover:bg-[#1a2744]/5'
const CURRENT = 'border-[#1a2744] bg-[#1a2744] text-white'

export default function ClientNav({
  current,
  ref_,
  showInvoice = true,
  showInvitation = false,
  className = '',
}: {
  current: ClientNavPage
  ref_?: string | null
  /** False for a booking with no quote on it: an unpriced lead's invoice is an empty page. */
  showInvoice?: boolean
  /** Only when the host has an invitation they may see: the page says "isn't available" without one. */
  showInvitation?: boolean
  className?: string
}) {
  const items: { page: ClientNavPage; label: string; href: string }[] = [
    { page: 'booking', label: 'My Booking', href: '/my-booking' },
  ]
  if (ref_ && showInvoice) {
    items.push({ page: 'invoice', label: 'Invoice', href: `/plan/${encodeURIComponent(ref_)}/summary` })
  }
  // The planner edits the plan the invoice prices, so it is only a destination from the
  // pages that are not already it; /party-planner reads the booking from the portal cookie.
  if (current === 'planner') {
    items.push({ page: 'planner', label: 'Party Planner', href: '/party-planner' })
  }
  if (showInvitation || current === 'invitation') {
    items.push({ page: 'invitation', label: 'Invitation', href: '/my-booking/invitation' })
  }

  return (
    <nav aria-label="Your booking pages" className={`no-print flex flex-wrap items-center justify-center gap-2 ${className}`}>
      {items.map(i =>
        i.page === current ? (
          <span key={i.page} aria-current="page" className={`${ITEM} ${CURRENT}`}>{i.label}</span>
        ) : (
          <a key={i.page} href={i.href} className={`${ITEM} ${IDLE}`}>{i.label}</a>
        ),
      )}
    </nav>
  )
}
