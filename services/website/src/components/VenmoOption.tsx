'use client'

/**
 * Venmo "save your spot" payment option.
 *
 * Shows the static Host Hampton Venmo profile QR (@hosthampton) plus a
 * deep-link button. The amount is the SUBTOTAL only — no sales tax and no
 * 3% card fee — because Venmo is the no-fee way to hold a spot. Callers must
 * pass the pre-tax / pre-fee subtotal in cents.
 */

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

export default function VenmoOption({
  amountCents,
  note,
  compact = false,
}: {
  amountCents: number
  note: string
  compact?: boolean
}) {
  if (!amountCents || amountCents <= 0) return null

  const amount = (amountCents / 100).toFixed(2)
  // Use the shareable "recipients" payment-link form on the root host.
  // The profile-path form (venmo.com/<user>) 302-redirects to
  // account.venmo.com and drops the txn/amount/note params, so the payment
  // never prefills. This form is a universal link: it opens the Venmo app
  // (prefilled) on mobile and the web pay flow on desktop.
  const deepLink = `https://venmo.com/?txn=pay&recipients=hosthampton&amount=${amount}&note=${encodeURIComponent(note)}`
  const priceLabel = formatPrice(amountCents)

  return (
    <div className={`border-t border-hampton-pink/20 ${compact ? 'mt-3 pt-3' : 'mt-5 pt-5'}`}>
      <p className={`text-hampton-navy font-medium ${compact ? 'text-xs mb-2' : 'text-sm mb-3'}`}>
        Prefer Venmo? Send <span className="font-bold">{priceLabel}</span> to{' '}
        <span className="font-semibold">@hosthampton</span> to save your spot.
      </p>

      <div className={`flex items-center gap-4 ${compact ? '' : 'mb-3'}`}>
        <img
          src="/images/venmo-qr.png"
          alt="Host Hampton Venmo QR code"
          className={`rounded-lg border border-hampton-pink/20 shrink-0 ${compact ? 'w-20 h-20' : 'w-28 h-28'}`}
        />
        <div className="min-w-0">
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#3D95CE] text-white font-semibold px-4 py-2.5 text-sm hover:bg-[#3486bd] transition-colors"
          >
            Pay {priceLabel} on Venmo
          </a>
          <p className={`text-hampton-navy/50 leading-snug ${compact ? 'text-[10px] mt-1.5' : 'text-[11px] mt-2'}`}>
            Add the child&rsquo;s name in the Venmo note — your spot is held once
            we receive it.
          </p>
        </div>
      </div>
    </div>
  )
}
